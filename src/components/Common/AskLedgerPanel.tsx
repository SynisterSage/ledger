import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Copy as CopyIcon,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  Link2,
  ListChecks,
  LoaderCircle,
  Minimize2,
  Mic,
  Paperclip,
  Send,
  SlidersHorizontal,
  Square,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import {
  routeForCalendarEvent,
  routeForCalendarReminder,
  routeForInboxItem,
  routeForNote,
  routeForProject,
  routeForTask,
  usePlatform,
} from '../../platform';
import { ModalCloseButton } from './ModalCloseButton';
import { ModalOverlay } from './ModalOverlay';
import type { AskLedgerInitialContext } from '../../types/askLedgerContext';
import { deriveAskLedgerConversationState, type AskLedgerConversationState } from '../../types/askLedgerConversationState';
import type { AskLedgerAttachment } from '../../types/askLedgerAttachments';
import { ASK_LEDGER_SKILL_METADATA, type AskLedgerCustomSkill, type AskLedgerSkillRef, type AskLedgerSkillMetadata } from '../../types/askLedgerSkills';
import { routeAskLedgerMessage } from '../../types/askLedgerResponseMode';
import type { AskLedgerResponseMode } from '../../types/askLedgerResponseMode';
import type { AskLedgerAnswerDepth } from '../../types/askLedgerAnswerDepth';
import {
  proposeAskLedgerActions,
  type AskLedgerActionProposal,
  type AskLedgerActionType,
} from './askLedgerActions';

export type AskLedgerSourceType =
  | 'project'
  | 'task'
  | 'milestone'
  | 'note'
  | 'event'
  | 'reminder'
  | 'intake'
  | 'transcript'
  | 'person'
  | 'team'
  | 'external'
  | 'attachment'
  | 'activity'
  | 'notification'
  | 'linked_resource';

export interface AskLedgerRequest {
  question: string;
  workspaceId?: string | null;
  skillId?: AskLedgerSkillRef;
  explicitContext?: AskLedgerInitialContext;
  customSkill?: AskLedgerCustomSkill;
  attachmentIds?: string[];
  responseMode?: AskLedgerResponseMode;
  retrievalRequired?: boolean;
  answerDepth?: AskLedgerAnswerDepth;
}

export interface AskLedgerSource {
  id: string;
  title: string;
  type: AskLedgerSourceType;
  resourceId?: string;
  projectId?: string;
  parentResourceId?: string;
  route?: string | Record<string, unknown>;
  sourceLabel?: string;
  integrationProvider?: string;
  integrationResourceType?: string;
  externalId?: string;
  explicitIntegrationLink?: boolean;
  updatedAt?: string;
  attachmentSource?: { attachmentId: string; fileName: string; pageNumber?: number; section?: string; paragraph?: number; rowStart?: number; rowEnd?: number };
}

export interface AskLedgerResponse {
  answer: string;
  sources: AskLedgerSource[];
}

type AskLedgerMessageAttachment =
  | { kind: 'file'; attachment: AskLedgerAttachment }
  | { kind: 'resource'; resource: AskLedgerSource };
export interface AskLedgerMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: AskLedgerSource[];
  interrupted?: boolean;
  actions?: AskLedgerActionProposal[];
  attachments?: AskLedgerMessageAttachment[];
  structured?: { skillId: AskLedgerSkillRef; sections: Array<{ title: string; content: string }> };
  skillId?: AskLedgerSkillRef;
  activity?: { durationMs?: number; steps: Array<{ type: 'starting_runtime' | 'searching' | 'sources_found' | 'reading_context' | 'preparing_answer' | 'generating'; count?: number; sources?: Array<Record<string, unknown>> }> };
}

export interface AskLedgerSession {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AskLedgerMessage[];
  summary?: string;
  initialContext?: AskLedgerInitialContext;
  skillId?: AskLedgerSkillRef;
}

type AskLedgerConversationTurn = {
  question: string;
  answer: string;
  sources: AskLedgerSource[];
};

type AskLedgerConversationContext = {
  id?: string;
  previousQuestion: string;
  previousAnswer: string;
  previousSources: AskLedgerSource[];
  recentExchanges: AskLedgerConversationTurn[];
  initialContext?: AskLedgerInitialContext;
  state?: AskLedgerConversationState;
};

const conversationStateSources = (sources: AskLedgerSource[]) => sources.map((source) => ({
  resourceType: source.type,
  resourceId: source.resourceId ?? source.id,
  title: source.title,
  projectId: source.projectId,
  integrationProvider: source.integrationProvider,
  updatedAt: source.updatedAt,
}));

export type AskLedgerState =
  | { status: 'idle' | 'focused' }
  | { status: 'submitting'; request: AskLedgerRequest }
  | { status: 'streaming'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'answer'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'no-answer'; request: AskLedgerRequest }
  | { status: 'error'; request: AskLedgerRequest; message: string };

type LocalAISetupError = 'storage' | 'interrupted' | 'generic';
type GenerationTier = 'fast' | 'balanced' | 'powerful';
type GenerationModelState = 'not_installed' | 'unavailable' | 'downloading' | 'verifying' | 'installed' | 'failed';
type GenerationModelView = {
  id: string;
  tier: GenerationTier;
  displayName?: string;
  description?: string;
  expectedSize?: number;
  installed?: boolean;
  downloading?: boolean;
  verifying?: boolean;
  state?: GenerationModelState;
  bytesDownloaded?: number;
  totalBytes?: number | null;
  progressPercent?: number | null;
  installedBytes?: number;
  available?: boolean;
  error?: string | null;
};
type LocalAICapabilityView = {
  recommendedTier?: GenerationTier;
  warnings?: Partial<Record<GenerationTier, string>>;
  acknowledgedTiers?: GenerationTier[];
  recommendationReason?: string;
};

const generationTierLabels: Record<GenerationTier, string> = { fast: 'Fast', balanced: 'Balanced', powerful: 'Powerful' };
const generationTierDescriptions: Record<GenerationTier, string> = {
  fast: 'Quick responses with the lowest resource use.',
  balanced: 'Stronger answers for more complex work.',
  powerful: 'Highest local quality for demanding work.',
};
const generationTierOrder: GenerationTier[] = ['fast', 'balanced', 'powerful'];
const isGenerationTier = (value: unknown): value is GenerationTier => generationTierOrder.includes(value as GenerationTier);

const sourceType = (value: unknown): AskLedgerSourceType | null =>
  [
    'project',
    'task',
    'milestone',
    'note',
    'event',
    'reminder',
    'intake',
    'transcript',
    'person',
    'team',
    'external',
    'attachment',
    'activity',
    'notification',
    'linked_resource',
  ].includes(String(value))
    ? (value as AskLedgerSourceType)
    : null;

const sourceIconMap: Record<AskLedgerSourceType, typeof FileText> = {
  project: FolderKanban,
  task: ListChecks,
  milestone: ListChecks,
  note: FileText,
  event: CalendarDays,
  reminder: CalendarDays,
  intake: Inbox,
  transcript: Mic,
  person: UserRound,
  team: Users,
  external: ExternalLink,
  attachment: FileText,
  activity: ListChecks,
  notification: Bell,
  linked_resource: Link2,
};

const sourceTypeLabels: Record<AskLedgerSourceType, string> = {
  project: 'Project',
  task: 'Task',
  milestone: 'Milestone',
  note: 'Note',
  event: 'Event',
  reminder: 'Reminder',
  intake: 'Intake',
  transcript: 'Transcript',
  person: 'Person',
  team: 'Team',
  external: 'Resource',
  attachment: 'Attachment',
  activity: 'Activity',
  notification: 'Notification',
  linked_resource: 'Linked resource',
};

type AskLedgerStreamEvent = {
  type: 'start' | 'activity' | 'sources' | 'delta' | 'replace' | 'done' | 'error';
  requestId: string;
  activity?: { type: 'starting_runtime' | 'searching' | 'sources_found' | 'reading_context' | 'preparing_answer' | 'generating'; count?: number; sources?: Array<Record<string, unknown>> };
  text?: string;
  sources?: Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
  metrics?: { totalMs?: number; performance?: Record<string, unknown> };
  skillResult?: {
    skillId: string;
    sections?: Array<{ title: string; content: string }>;
    actionProposals?: Array<{ id: string; type: AskLedgerActionType; payload: Record<string, unknown>; sourceMessageId?: string }>;
  };
};

const askLedgerDocumentScope = (question: string) => {
  const value = question.toLowerCase().replace(/[’']/g, '').trim();
  // Notes are a first-class retrieval target. Keep the full document set for
  // note requests so the backend planner can resolve folders and expand only
  // directly related events/tasks afterward; an events-only scope would make
  // explicit note constraints impossible to satisfy.
  if (/\bnotes?\b/.test(value)) return undefined;
  if (/\bunread\s+(?:notifications?|alerts?)\b|\bnotifications?\b/.test(value)) return 'notifications';
  if (/\bwhat needs my attention\b/.test(value)) return 'attention';
  if (/\b(?:what changed|changes|activity|happening|teamspace alerts?)\b/.test(value)) return 'activity';
  if (/\b(my team|team members|members of (the )?team|who.*team)\b/.test(value)) return 'team_members';
  if (/\b(deadline|deadlines|deadliens|due date|due dates)\b/.test(value)) return 'deadlines';
  if (/\b(github|git hub|slack|figma|integration|integrations|intake|pull requests?|issues?)\b/.test(value)) return 'integration';
  if (/\b(projects?|portfolio)\b/.test(value) && !/\b(discuss|discussed|decide|decided|mention|mentioned|say|said)\b/.test(value)) return 'projects';
  if (/\b(reminders?|remind me)\b/.test(value)) return 'reminders';
  if (/\b(prepare|prep|get ready|brief|plan|planning|plan it out)\b/.test(value) && /\b(meeting|meetings|call|calls)\b/.test(value)) return 'meeting_prep';
  if (/\b(meetings?|events?)\b/.test(value) || /\b(calendar|schedule)\b.*\b(upcoming|today|this week|next week|event|meeting)\b/.test(value)) return 'events';
  if (/\b(open tasks?|todos?|to dos?|to-do|actions?|things to do|what do i need to do)\b/.test(value)) return 'open_actions';
  if (/\b(tasks?)\b/.test(value)) return 'tasks';
  if (/\b(milestones?|checkpoints?)\b/.test(value)) return 'milestones';
  if (/\b(follow[- ]?ups?|came from (a )?meeting|meeting actions?)\b/.test(value)) return 'followups';
  if (/\b(blocked|blocking|stuck|in the way|what is holding|whats holding)\b/.test(value)) return 'blockers';
  if (/\b(status|progress|current state)\b/.test(value)) return 'status_context';
  if (/\b(today|todays|tomorrow|upcoming|planned|plan|this week|next week)\b/.test(value)) return 'time_window';
  return undefined;
};

const askLedgerDateWindow = (question: string) => {
  const value = question.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const format = (date: Date) => date.toISOString().slice(0, 10);
  if (/\b(today)\b/.test(value)) return { from: format(today), to: format(today) };
  if (/\b(tomorrow)\b/.test(value)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { from: format(tomorrow), to: format(tomorrow) };
  }
  if (/\b(this week|next week)\b/.test(value)) {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() + (value.includes('next week') ? 7 : 0));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: format(start), to: format(end) };
  }
  return {};
};

const askLedgerProjectReference = (question: string) => {
  if (!/\bprojects?\b/i.test(question)) return undefined;
  const match = question.match(/\bproject\s+([^?.,]+?)(?:\?|$|\s+(?:and|where|that|with)\b)/i);
  const candidate = match?.[1]?.trim();
  if (!candidate || /^(this|next|last|the)?\s*(week|month|year|calendar|team|workspace)$/i.test(candidate)) return undefined;
  return candidate.length >= 2 && candidate.length <= 100 ? candidate : undefined;
};

const askLedgerTaskHorizon = (question: string) => {
  const value = question.toLowerCase();
  if (/\b(long[- ]term|long term)\b/.test(value)) return 'long_term';
  if (/\b(short[- ]term|short term|today|todays|today\s*task)\b/.test(value)) return 'today';
  return undefined;
};

const askLedgerAssignedToMe = (question: string, scope?: string) => {
  if (!scope || !['tasks', 'open_actions', 'deadlines', 'time_window', 'milestones'].includes(scope)) return false;
  return /\b(my|mine|assigned to me|for me|i have)\b/i.test(question);
};

const isAskLedgerStreamEvent = (value: unknown): value is AskLedgerStreamEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AskLedgerStreamEvent>;
  return typeof event.type === 'string' && typeof event.requestId === 'string';
};

const localAIErrorMessage = (code?: string, detail?: string) => {
  if (code === 'model_missing' || code === 'llama_unavailable')
    return 'Local AI is unavailable right now. Try again.';
  if (code === 'cancelled') return 'Generation cancelled.';
  if (code === 'runtime_start_failed' || code === 'runtime_exited') {
    return detail?.trim() ? `Local AI could not start: ${detail.trim()}` : 'Local AI could not start. Try again.';
  }
  if (code === 'request_timeout') return 'Local AI took too long to respond. Try again.';
  if (code === 'retrieval_failed') {
    const safeDetail = detail?.trim();
    return safeDetail ? `Ledger could not complete this request: ${safeDetail}` : "Couldn't search your workspace. Try again.";
  }
  if (detail?.trim()) return `Ledger could not answer right now: ${detail.trim()}`;
  return 'Ledger could not answer right now. Try again.';
};

const localAISetupErrorMessage = (
  error: unknown
): { title: string; detail?: string; kind: LocalAISetupError } => {
  const message = error instanceof Error ? error.message : '';
  if (/storage|disk space/i.test(message))
    return {
      title: "Local AI couldn't be installed.",
      detail: 'There is not enough space on this device.',
      kind: 'storage',
    };
  if (/abort|cancel/i.test(message))
    return {
      title: "Local AI couldn't be installed.",
      detail: 'The download was interrupted.',
      kind: 'interrupted',
    };
  return { title: "Local AI couldn't be installed.", kind: 'generic' };
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; error?: unknown; detail?: unknown };
    for (const candidate of [value.message, value.error, value.detail]) {
      const message = errorMessage(candidate);
      if (message) return message;
    }
  }
  return '';
};

const optionalModelDownloadMessage = (message?: unknown, state?: string) => {
  const detail = errorMessage(message);
  if (state === 'unavailable' || /metadata|unavailable/i.test(detail)) return 'This model is not available yet.';
  if (state === 'busy') return 'Another model download is already in progress.';
  if (/disk|space|storage/i.test(detail)) return 'There is not enough space on this device.';
  if (/checksum|sha-256|verification|expected-size/i.test(detail)) return 'The downloaded model could not be verified.';
  if (/cancel|abort/i.test(detail)) return 'The download was cancelled.';
  if (/runtime|llama|model.*load|start/i.test(detail)) return detail || 'The local AI runtime could not start this model.';
  return 'The download could not be completed. Try again.';
};

const formatLocalAIBytes = (bytes?: number, fallback = '~1.4 GB') => {
  if (!bytes || bytes <= 0) return fallback;
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) return `~${gigabytes.toFixed(1)} GB`;
  return `~${Math.round(bytes / 1024 ** 2)} MB`;
};

const formatDownloadedBytes = (bytes?: number) => {
  if (!bytes || bytes < 1024 ** 2) return '0 MB';
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const emptyStateExamples = [
  { title: 'Review my projects', description: 'See what is moving, blocked, or needs attention.', icon: FolderKanban, prompt: 'Review my projects. See what is moving, blocked, or needs attention.' },
  { title: 'What changed recently?', description: 'Find important updates across your workspace.', icon: CalendarDays, prompt: 'What changed recently? Find important updates across my workspace.' },
  { title: 'Prepare me for a meeting', description: 'Pull together relevant notes, tasks, and context.', icon: FileText, prompt: 'Prepare me for a meeting. Pull together relevant notes, tasks, and context.' },
];

const deriveSessionTitle = (question: string) => {
  const value = question.trim().replace(/[?!.]+$/, '');
  const lower = value.toLowerCase();
  if (lower.includes('local ai') && /block|stuck|problem|issue/.test(lower)) return 'Local AI blockers';
  if (lower.includes('calendar') && lower.includes('sync')) return 'Calendar sync';
  if (lower.includes('focus') && /week|today|next/.test(lower)) return "This week's focus";
  const words = value.split(/\s+/).slice(0, 5);
  if (!words.length) return 'Ask Ledger';
  const title = words.join(' ');
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
};

const renderInlineAnswer = (value: string, keyPrefix: string): ReactNode[] =>
  value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-bold-${index}`} className="font-semibold text-[var(--ledger-text-primary)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-code-${index}`} className="rounded bg-[var(--ledger-surface-muted)] px-1 py-0.5 text-[0.9em] text-[var(--ledger-text-primary)]">{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
  });

const renderAnswerContent = (content: string): ReactNode[] => content.trim().split(/\n{2,}/).filter(Boolean).map((block, blockIndex) => {
  const lines = block.split('\n');
  const isBulleted = lines.every((line) => /^\s*[-*]\s+/.test(line));
  const isNumbered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
  if (isBulleted || isNumbered) {
    const List = isBulleted ? 'ul' : 'ol';
    return <List key={`answer-block-${blockIndex}`} className={`${isBulleted ? 'list-disc' : 'list-decimal'} space-y-1 pl-5`}>{lines.map((line, lineIndex) => <li key={`answer-line-${lineIndex}`}>{renderInlineAnswer(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''), `answer-${blockIndex}-${lineIndex}`)}</li>)}</List>;
  }
  return <p key={`answer-block-${blockIndex}`}>{lines.map((line, lineIndex) => <span key={`answer-line-${lineIndex}`}>{lineIndex > 0 && <br />}{renderInlineAnswer(line, `answer-${blockIndex}-${lineIndex}`)}</span>)}</p>;
});

const askLedgerActivityLabel = (value?: AskLedgerStreamEvent['activity']) => {
  if (!value) return '';
  if (value.type === 'starting_runtime') return 'Starting Local AI…';
  if (value.type === 'searching') return 'Searching your workspace…';
  if (value.type === 'sources_found') return `Found ${value.count ?? 0} relevant sources`;
  if (value.type === 'reading_context') return `Reading ${value.count ?? 0} relevant sources…`;
  if (value.type === 'preparing_answer') return 'Preparing answer…';
  return 'Preparing answer…';
};

const GENERATION_PHRASES = [
  'Thinking through this…',
  'Reading your workspace…',
  'Connecting the relevant pieces…',
  'Checking project context…',
  'Looking for recent changes…',
  'Comparing what moved…',
  'Tracing open threads…',
  'Checking due dates…',
  'Reviewing next actions…',
  'Looking for blockers…',
  'Sorting the signal…',
  'Pulling together the context…',
  'Cross-checking details…',
  'Mapping what comes next…',
  'Looking for dependencies…',
  'Reviewing recent activity…',
  'Checking calendar context…',
  'Grouping related work…',
  'Identifying gaps…',
  'Weighing priorities…',
  'Building a grounded answer…',
  'Turning context into a plan…',
  'Writing the useful parts…',
  'Making the summary concise…',
  'Almost there…',
] as const;

const askLedgerActivityDescription = (value: AskLedgerStreamEvent['activity']) => {
  if (!value) return '';
  if (value.type === 'starting_runtime') return 'Getting Ledger ready on this device.';
  if (value.type === 'searching') return 'Searching your workspace for relevant context.';
  if (value.type === 'sources_found') return `Found ${value.count ?? 0} relevant sources.`;
  if (value.type === 'reading_context') return `Reviewed ${value.count ?? 0} sources relevant to this question.`;
  if (value.type === 'preparing_answer') return 'Organizing the selected context into an answer.';
  return 'Answering from the selected Ledger context.';
};

const formatAskLedgerDuration = (durationMs: number) => Math.max(0, Math.round(durationMs / 1000));

const AskLedgerActivityTrace = ({ steps, durationMs, active, expanded, onToggle, generationPhrase }: { steps: NonNullable<AskLedgerStreamEvent['activity']>[]; durationMs?: number | null; active?: boolean; expanded: boolean; onToggle: () => void; generationPhrase?: string }) => {
  const current = steps[steps.length - 1];
  const label = active ? generationPhrase ?? 'Working…' : `Worked for ${formatAskLedgerDuration(durationMs ?? 0)} seconds`;
  if (active && !steps.length) return <div className="ask-ledger-activity" aria-live="polite"><p className="px-1 text-xs text-[var(--ledger-text-muted)] ledger-ask-generating">{label}</p></div>;
  return <div className="ask-ledger-activity" aria-live={active ? 'polite' : undefined}>
    <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-secondary)]">
      <span className={active ? 'ledger-ask-generating' : undefined}>{label}</span><ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {active && current && !expanded ? <p className="mt-2 pl-1 text-xs text-[var(--ledger-text-secondary)]">{askLedgerActivityLabel(current)}</p> : null}
    {expanded && <div className="mt-2 space-y-3 pl-3">
      {steps.map((step, index) => <div key={`${step.type}-${index}`} className="relative border-l border-[color:var(--ledger-border-subtle)] pl-3">
        <p className="text-xs text-[var(--ledger-text-secondary)]">{askLedgerActivityLabel(step)}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">{askLedgerActivityDescription(step)}</p>
        {step.sources?.length ? <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--ledger-text-muted)]">{step.sources.slice(0, 3).map((source) => <span key={`${String(source.resourceType)}:${String(source.resourceId)}`} className="max-w-[190px] truncate">{String(source.title ?? 'Untitled')}</span>)}{(step.count ?? 0) > step.sources.length ? <span>+{(step.count ?? 0) - step.sources.length} more</span> : null}</div> : null}
      </div>)}
    </div>}
  </div>;
};

const skillIconMap = { ListChecks, FolderKanban, CalendarDays, FileText };
const skillPlaceholder = (skill?: AskLedgerSkillMetadata) => {
  if (!skill) return undefined;
  if (skill.id === 'project_health_check') return 'What would you like Ledger to review?';
  if (skill.id === 'meeting_follow_up') return 'Anything specific to focus on?';
  if (skill.id === 'plan_my_week') return 'Anything you want to prioritize?';
  return 'Anything else to add?';
};

const skillRequirementLabel = (skill: AskLedgerSkillMetadata) => {
  if (!skill.requiresContext) return null;
  if (skill.supportedContextTypes.includes('project')) return 'Choose a project';
  if (skill.supportedContextTypes.includes('note')) return 'Choose a note';
  return 'Choose a meeting';
};

const normalizeSkillMetadata = (value: unknown): AskLedgerSkillMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || typeof item.description !== 'string' || typeof item.icon !== 'string' || typeof item.requiresContext !== 'boolean' || !Array.isArray(item.supportedContextTypes) || !Array.isArray(item.allowedActions)) return null;
  return { id: item.id, name: item.name, description: item.description, icon: item.icon, requiresContext: item.requiresContext, supportedContextTypes: item.supportedContextTypes as AskLedgerSkillMetadata['supportedContextTypes'], allowedActions: item.allowedActions as AskLedgerSkillMetadata['allowedActions'], ...(item.isCustom === true ? { isCustom: true, instructions: typeof item.instructions === 'string' ? item.instructions : undefined } : {}) };
};

const newAskLedgerConversationId = () => `ask-ledger-${crypto.randomUUID()}`;
const newAskLedgerMessageId = () => `ask-${crypto.randomUUID()}`;

const attachmentKindLabel = (attachment: AskLedgerAttachment) => attachment.extension.toUpperCase();

const attachmentDisplayName = (name: string) => name.length > 28 ? `${name.slice(0, 24)}…${name.slice(name.lastIndexOf('.') || name.length)}` : name;

export const AskLedgerPanel = ({ workspaceId, resetKey, initialSession, initialContext, skillId, customSkills = [], onEditCustomSkill, onConversationChange, onSessionTitleChange, onSessionPersisted, onSessionIdChange, onQuestionChange, onQuestionSubmitted, onGenerationActiveChange, compact = false }: { workspaceId?: string | null; resetKey?: number; initialSession?: AskLedgerSession | null; initialContext?: AskLedgerInitialContext | null; skillId?: AskLedgerSkillRef; customSkills?: AskLedgerCustomSkill[]; onEditCustomSkill?: (skill: AskLedgerCustomSkill) => void; onConversationChange?: (active: boolean) => void; onSessionTitleChange?: (title: string) => void; onSessionPersisted?: () => void; onSessionIdChange?: (id: string | null) => void; onQuestionChange?: (question: string) => void; onQuestionSubmitted?: (question: string) => void; onGenerationActiveChange?: (active: boolean) => void; compact?: boolean }) => {
  const api = useApi();
  const platform = usePlatform();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestMessageRef = useRef<HTMLElement | null>(null);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskLedgerState>({ status: 'idle' });
  const [generationPhrase, setGenerationPhrase] = useState<string>(GENERATION_PHRASES[0]);
  const stateRef = useRef<AskLedgerState>({ status: 'idle' });
  const completedRequestIdRef = useRef<string | null>(null);
  const [activitySteps, setActivitySteps] = useState<NonNullable<AskLedgerStreamEvent['activity']>[]>([]);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [activityDurationMs, setActivityDurationMs] = useState<number | null>(null);
  const [requestWatchdogStatus, setRequestWatchdogStatus] = useState<'slow' | null>(null);
  const activityStartedAtRef = useRef<number | null>(null);
  const requestWatchdogTimerRef = useRef<number | null>(null);
  const activityStepsRef = useRef<NonNullable<AskLedgerStreamEvent['activity']>[]>([]);
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [messages, setMessages] = useState<AskLedgerMessage[]>([]);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeInitialContext, setActiveInitialContext] = useState<AskLedgerInitialContext | null>(initialContext ?? null);
  const [actionReview, setActionReview] = useState<{ actions: AskLedgerActionProposal[]; title: string } | null>(null);
  const [actionDraft, setActionDraft] = useState<AskLedgerActionProposal | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const actionBusyRef = useRef(false);
  const [localAIStatus, setLocalAIStatus] = useState<{
    generation?: {
      id?: string;
      tier?: GenerationTier;
      installed?: boolean;
      downloading?: boolean;
      bytesDownloaded?: number;
      expectedSize?: number;
      error?: string | null;
    };
    generationModels?: Record<string, GenerationModelView>;
    selectedGenerationTier?: GenerationTier;
    embedding?: {
      installed?: boolean;
      downloading?: boolean;
      bytesDownloaded?: number;
      expectedSize?: number;
      error?: string | null;
    };
    runtimeAvailable?: boolean;
  } | null>(null);
  const [setupStarted, setSetupStarted] = useState(false);
  const [setupError, setSetupError] = useState<{
    title: string;
    detail?: string;
    kind: LocalAISetupError;
  } | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [generationModels, setGenerationModels] = useState<GenerationModelView[]>([]);
  const [selectedGenerationTier, setSelectedGenerationTier] = useState<GenerationTier>('fast');
  const [generationRuntimeState, setGenerationRuntimeState] = useState<{ selectedTier?: GenerationTier; loadedTier?: GenerationTier | null; switching?: boolean; targetTier?: GenerationTier | null; ready?: boolean; failure?: unknown } | null>(null);
  const [localAICapability, setLocalAICapability] = useState<LocalAICapabilityView | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedView, setAdvancedView] = useState<'quality' | 'models'>('quality');
  const [tierSwitchError, setTierSwitchError] = useState<string | null>(null);
  const [switchingTier, setSwitchingTier] = useState<GenerationTier | null>(null);
  const [downloadTier, setDownloadTier] = useState<GenerationTier | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<'confirm' | 'downloading' | 'preparing' | 'error'>('confirm');
  const [downloadMinimized, setDownloadMinimized] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const qualityPointerInteractionRef = useRef(false);
  const qualityPointerIdRef = useRef<number | null>(null);
  const qualitySuppressClickRef = useRef(false);
  const [qualityDragTier, setQualityDragTier] = useState<GenerationTier | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [contextPickerSkill, setContextPickerSkill] = useState<AskLedgerSkillMetadata | null>(null);
  const [contextPickerOptions, setContextPickerOptions] = useState<AskLedgerInitialContext[]>([]);
  const [contextPickerLoading, setContextPickerLoading] = useState(false);
  const [contextPickerSearch, setContextPickerSearch] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<AskLedgerMessageAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [resourcePickerLoading, setResourcePickerLoading] = useState(false);
  const [resourcePickerOptions, setResourcePickerOptions] = useState<AskLedgerSource[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<AskLedgerSkillRef | null>(skillId ?? null);
  const [skillCatalog, setSkillCatalog] = useState<AskLedgerSkillMetadata[]>(ASK_LEDGER_SKILL_METADATA);
  const setupCancelRequestedRef = useRef(false);
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const skillButtonRef = useRef<HTMLButtonElement | null>(null);
  const skillPopupRef = useRef<HTMLDivElement | null>(null);
  const [skillPopupPosition, setSkillPopupPosition] = useState<{ left: number; top: number; maxHeight?: number; transform?: string } | null>(null);
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const advancedButtonRef = useRef<HTMLButtonElement | null>(null);
  const advancedPopoverRef = useRef<HTMLDivElement | null>(null);
  const downloadModalRef = useRef<HTMLDivElement | null>(null);
  const downloadPrimaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const performanceRequestIdRef = useRef<string | null>(null);
  const rendererFirstDeltaAtRef = useRef<number | null>(null);
  const sourceItemsRef = useRef<AskLedgerSource[]>([]);
  const conversationRef = useRef<AskLedgerConversationContext | null>(null);
  const recentTurnsRef = useRef<AskLedgerConversationTurn[]>([]);
  const requestInitializingRef = useRef(false);
  const messagesRef = useRef<AskLedgerMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef(initialSession?.id ?? newAskLedgerConversationId());
  const sessionTitleRef = useRef('Ask Ledger');
  const sessionSkillIdRef = useRef<AskLedgerSkillRef | undefined>(initialSession?.skillId ?? skillId);
  const pendingSkillIdRef = useRef<AskLedgerSkillRef | undefined>(skillId);
  const initialContextRef = useRef<AskLedgerInitialContext | null>(initialContext ?? null);
  const autoSubmittedContextRef = useRef<string | null>(null);
  const sessionSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const questionRef = useRef(question);
  const workspaceIdRef = useRef(workspaceId);
  stateRef.current = state;
  questionRef.current = question;
  workspaceIdRef.current = workspaceId;

  const clearRequestWatchdog = () => {
    if (requestWatchdogTimerRef.current !== null) window.clearTimeout(requestWatchdogTimerRef.current);
    requestWatchdogTimerRef.current = null;
  };

  const conversationActive = messages.length > 0;
  const selectedSkill = selectedSkillId ? skillCatalog.find((skill) => skill.id === selectedSkillId) : undefined;

  const selectSkill = (skill: AskLedgerSkillMetadata) => {
    const hasValidContext = Boolean(activeInitialContext && skill.supportedContextTypes.includes(activeInitialContext.resourceType));
    if (skill.requiresContext && !hasValidContext) {
      setContextPickerSkill(skill);
      setContextPickerSearch('');
      setContextPickerLoading(true);
      if (!workspaceId) {
        setContextPickerOptions([]);
        setContextPickerLoading(false);
      } else {
        void api.getAskLedgerDocuments(workspaceId).then((payload) => {
          const documents = Array.isArray((payload as { documents?: unknown[] })?.documents) ? (payload as { documents: unknown[] }).documents : [];
          setContextPickerOptions(documents.map((item) => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            const resourceType = String(record.resourceType ?? '') as AskLedgerInitialContext['resourceType'];
            const resourceId = String(record.resourceId ?? '');
            if (!skill.supportedContextTypes.includes(resourceType) || !resourceId) return null;
            return { resourceType, resourceId, title: String(record.title ?? 'Untitled') };
          }).filter((item): item is AskLedgerInitialContext => Boolean(item)));
        }).catch(() => setContextPickerOptions([])).finally(() => setContextPickerLoading(false));
      }
      return;
    }
    setSelectedSkillId(skill.id);
    pendingSkillIdRef.current = skill.id;
    sessionSkillIdRef.current = skill.id;
    setSkillPickerOpen(false);
    inputRef.current?.focus();
  };

  const selectSkillContext = (context: AskLedgerInitialContext) => {
    initialContextRef.current = context;
    setActiveInitialContext(context);
    if (contextPickerSkill) {
      setSelectedSkillId(contextPickerSkill.id);
      pendingSkillIdRef.current = contextPickerSkill.id;
      sessionSkillIdRef.current = contextPickerSkill.id;
    }
    setContextPickerSkill(null);
    setContextPickerOptions([]);
    setSkillPickerOpen(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!attachmentMenuOpen) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutside);
    return () => window.removeEventListener('pointerdown', closeOnOutside);
  }, [attachmentMenuOpen]);

  const uploadAttachments = async () => {
    if (!workspaceId || !window.askLedger?.selectAttachments) return;
    const files = composerAttachments.filter((item): item is Extract<AskLedgerMessageAttachment, { kind: 'file' }> => item.kind === 'file');
    const existingSizeBytes = files.reduce((total, item) => total + item.attachment.sizeBytes, 0);
    setAttachmentError(null);
    try {
      const result = await window.askLedger.selectAttachments({ workspaceId, conversationId: conversationIdRef.current, existingCount: files.length, existingSizeBytes }) as { attachments?: AskLedgerAttachment[] };
      const attachments = Array.isArray(result?.attachments) ? result.attachments.filter((attachment) => attachment?.id) : [];
      const failed = attachments.find((attachment) => attachment.status === 'failed' || attachment.status === 'unsupported');
      if (failed) setAttachmentError(failed.error || `Couldn't read ${failed.name}.`);
      const usable = attachments.filter((attachment) => attachment.status === 'ready' || attachment.status === 'processing');
      setComposerAttachments((current) => [...current, ...usable.map((attachment) => ({ kind: 'file' as const, attachment }))]);
      setAttachmentMenuOpen(false);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not add that attachment.');
    }
  };

  const openResourcePicker = async () => {
    if (!workspaceId) return;
    setAttachmentError(null);
    setResourcePickerOpen(true);
    setResourcePickerLoading(true);
    try {
      const payload = await api.getAskLedgerDocuments(workspaceId) as { documents?: Array<Record<string, unknown>> };
      const resources = (payload.documents ?? []).map((item) => {
        const type = sourceType(item.resourceType);
        if (!type) return null;
        return { id: String(item.resourceId ?? ''), resourceId: String(item.resourceId ?? ''), title: String(item.title ?? 'Untitled'), type, sourceLabel: sourceTypeLabels[type], projectId: item.projectId ? String(item.projectId) : undefined } as AskLedgerSource;
      }).filter((item): item is AskLedgerSource => Boolean(item?.resourceId));
      setResourcePickerOptions(resources.slice(0, 50));
    } catch {
      setResourcePickerOptions([]);
      setAttachmentError('Could not load Ledger resources.');
    } finally {
      setResourcePickerLoading(false);
    }
  };

  const addResourceAttachment = (resource: AskLedgerSource) => {
    setComposerAttachments((current) => current.some((item) => item.kind === 'resource' && item.resource.resourceId === resource.resourceId) ? current : [...current, { kind: 'resource', resource }]);
    setResourcePickerOpen(false);
    setAttachmentMenuOpen(false);
  };

  const removeComposerAttachment = (attachment: AskLedgerMessageAttachment) => {
    if (attachment.kind === 'file') void window.askLedger?.removeAttachments({ conversationId: conversationIdRef.current, attachmentIds: [attachment.attachment.id] });
    setComposerAttachments((current) => current.filter((item) => item !== attachment));
  };

  useEffect(() => {
    const customMetadata: AskLedgerSkillMetadata[] = customSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? 'A custom Ledger workflow.',
      icon: skill.icon ?? 'Boxes',
      requiresContext: false,
      supportedContextTypes: ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake', 'person', 'team', 'external'],
      allowedActions: [],
      isCustom: true,
      instructions: skill.instructions,
    }));
    setSkillCatalog((current) => [...current.filter((skill) => !skill.isCustom), ...customMetadata]);
  }, [customSkills]);

  useEffect(() => {
    if (!actionReview?.actions.some((action) => action.type === 'create_task') || !workspaceId) return;
    void api.getProjects({ includeCompleted: false }).then((value) => {
      if (!Array.isArray(value)) return;
      setProjectOptions(value.map((project) => {
        const item = project as Record<string, unknown>;
        return { id: String(item.id ?? ''), name: String(item.name ?? item.title ?? 'Untitled project') };
      }).filter((project) => project.id));
    }).catch(() => setProjectOptions([]));
  }, [actionReview, api, workspaceId]);

  useEffect(() => {
    if (!window.askLedger?.listSkills) return;
    void window.askLedger.listSkills().then((skills) => {
      const normalized = skills.map(normalizeSkillMetadata).filter((skill): skill is AskLedgerSkillMetadata => Boolean(skill));
      if (normalized.length) setSkillCatalog((current) => [...normalized, ...current.filter((skill) => skill.isCustom)]);
    }).catch(() => {
      // Keep the shared safe metadata fallback available in the browser/runtime.
    });
  }, []);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!skillPickerRef.current?.contains(target) && !skillPopupRef.current?.contains(target)) setSkillPickerOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [skillPickerOpen]);

  useEffect(() => {
    if (!skillPickerOpen) {
      setSkillPopupPosition(null);
      return undefined;
    }
    const updatePosition = () => {
      const button = skillButtonRef.current;
      if (!button) return;
      const bounds = button.getBoundingClientRect();
      const openAbove = compact || (conversationActive && bounds.top > 160);
      const availableHeight = openAbove ? bounds.top - 16 : window.innerHeight - bounds.bottom - 16;
      const maxHeight = Math.max(140, Math.min(420, availableHeight));
      setSkillPopupPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - (compact ? 188 : 296))),
        top: openAbove ? bounds.top : bounds.bottom + 6,
        maxHeight,
        transform: openAbove ? 'translateY(calc(-100% - 6px))' : undefined,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [compact, conversationActive, skillPickerOpen]);

  useEffect(() => {
    onConversationChange?.(conversationActive);
  }, [conversationActive, onConversationChange]);

  useEffect(() => {
    if (resetKey === undefined) return;
    const discardedAttachmentIds = messagesRef.current.flatMap((message) => (message.attachments ?? []).flatMap((attachment) => attachment.kind === 'file' ? [attachment.attachment.id] : []));
    if (discardedAttachmentIds.length) void window.askLedger?.removeAttachments({ conversationId: conversationIdRef.current, attachmentIds: discardedAttachmentIds });
    requestIdRef.current += 1;
    if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
    activeRequestIdRef.current = null;
    conversationRef.current = null;
    conversationIdRef.current = newAskLedgerConversationId();
    initialContextRef.current = null;
    setActiveInitialContext(null);
    recentTurnsRef.current = [];
    messagesRef.current = [];
    sessionIdRef.current = null;
    onSessionIdChange?.(null);
    sessionSkillIdRef.current = skillId;
    pendingSkillIdRef.current = skillId;
    setSelectedSkillId(skillId ?? null);
    setSkillPickerOpen(false);
    sessionTitleRef.current = 'Ask Ledger';
    onSessionTitleChange?.('Ask Ledger');
    sourceItemsRef.current = [];
    setQuestion('');
    setMessages([]);
    setExpandedSources({});
    setCopiedMessageId(null);
    setState({ status: 'idle' });
  }, [resetKey]);

  useEffect(() => {
    if (!initialSession) return;
    requestIdRef.current += 1;
    if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
    activeRequestIdRef.current = null;
    requestInitializingRef.current = false;
    const restoredMessages = Array.isArray(initialSession.messages) ? initialSession.messages : [];
    messagesRef.current = restoredMessages;
    sessionIdRef.current = initialSession.id;
    onSessionIdChange?.(initialSession.id);
    conversationIdRef.current = initialSession.id;
    sessionSkillIdRef.current = initialSession.skillId;
    pendingSkillIdRef.current = undefined;
    setSelectedSkillId(null);
    setSkillPickerOpen(false);
    sessionTitleRef.current = initialSession.title || 'Ask Ledger';
    initialContextRef.current = initialSession.initialContext ?? null;
    setActiveInitialContext(initialSession.initialContext ?? null);
    recentTurnsRef.current = restoredMessages
      .reduce<AskLedgerConversationTurn[]>((turns, message, index) => {
        if (message.role !== 'assistant') return turns;
        const questionMessage = restoredMessages.slice(0, index).reverse().find((item) => item.role === 'user');
        if (!questionMessage) return turns;
        return [...turns, { question: questionMessage.content, answer: message.content, sources: message.sources ?? [] }];
      }, [])
      .slice(-2);
    const lastTurn = recentTurnsRef.current[recentTurnsRef.current.length - 1];
    const restoredState = lastTurn ? deriveAskLedgerConversationState(workspaceIdRef.current ?? '', lastTurn.question, conversationStateSources(lastTurn.sources) as never) : undefined;
    conversationRef.current = lastTurn
      ? { id: conversationIdRef.current, previousQuestion: lastTurn.question, previousAnswer: lastTurn.answer, previousSources: lastTurn.sources, recentExchanges: recentTurnsRef.current, initialContext: initialContextRef.current ?? undefined, state: restoredState }
      : null;
    onSessionTitleChange?.(sessionTitleRef.current);
    setQuestion('');
    setMessages(restoredMessages);
    setExpandedSources({});
    setState({ status: restoredMessages.length ? 'focused' : 'idle' });
  }, [initialSession?.id]);

  useEffect(() => {
    if (initialSession) return;
    initialContextRef.current = initialContext ?? null;
    setActiveInitialContext(initialContext ?? null);
    conversationRef.current = conversationRef.current
      ? { ...conversationRef.current, initialContext: initialContextRef.current ?? undefined }
      : initialContextRef.current
        ? { id: conversationIdRef.current, previousQuestion: '', previousAnswer: '', previousSources: [], recentExchanges: [], initialContext: initialContextRef.current }
        : null;
  }, [initialContext, initialSession]);

  useEffect(() => {
    inputRef.current?.focus();
    const unsubscribe =
      window.askLedger?.onStream((value) => {
        if (!isAskLedgerStreamEvent(value))
          return;
        // Fast responses such as greetings can arrive before the IPC promise
        // resolves with the request id. Adopt that id while this request is
        // still initializing so the delta and done events are not discarded.
        if (value.requestId !== activeRequestIdRef.current) {
          if (requestInitializingRef.current && !activeRequestIdRef.current) activeRequestIdRef.current = value.requestId;
          else return;
        }
        if (value.type === 'activity') {
          const nextActivity = value.activity ?? null;
          const activeRequest = stateRef.current.status === 'submitting' || stateRef.current.status === 'streaming' ? stateRef.current.request : null;
          if (nextActivity && activeRequest?.retrievalRequired === false) return;
          if (nextActivity) {
            setActivitySteps((current) => {
              const next = current.some((step) => step.type === nextActivity.type && step.count === nextActivity.count) ? current : [...current, nextActivity];
              activityStepsRef.current = next;
              return next;
            });
          }
          return;
        }
        if (value.type === 'sources') {
          sourceItemsRef.current = (value.sources ?? [])
            .map((source) => {
              const type = sourceType(source.resourceType);
              return type
                ? {
                    id: String(source.resourceId ?? ''),
                    resourceId: String(source.resourceId ?? ''),
                    parentResourceId: source.parentResourceId
                      ? String(source.parentResourceId)
                      : undefined,
                    projectId: source.projectId ? String(source.projectId) : undefined,
                    title: String(source.title ?? 'Untitled'),
                    type,
                    route: source.route as string | Record<string, unknown> | undefined,
                    sourceLabel: source.sourceLabel ? String(source.sourceLabel) : undefined,
                    integrationProvider: source.integrationProvider ? String(source.integrationProvider) : undefined,
                    integrationResourceType: source.integrationResourceType ? String(source.integrationResourceType) : undefined,
                    externalId: source.externalId ? String(source.externalId) : undefined,
                    explicitIntegrationLink: source.explicitIntegrationLink === true,
                    updatedAt: source.updatedAt ? String(source.updatedAt) : undefined,
                    attachmentSource: source.attachmentSource as AskLedgerSource['attachmentSource'],
                  }
                : null;
            })
            .filter(Boolean) as AskLedgerSource[];
          return;
        }
        if (value.type === 'delta' && typeof value.text === 'string') {
          clearRequestWatchdog();
          setRequestWatchdogStatus(null);
          if (rendererFirstDeltaAtRef.current === null) rendererFirstDeltaAtRef.current = Date.now();
          setState((current) => {
            if (current.status !== 'submitting' && current.status !== 'streaming') return current;
            const request = current.request;
            const answer = current.status === 'streaming' ? current.response.answer : '';
            return {
              status: 'streaming',
              request,
              response: { answer: `${answer}${value.text}`, sources: sourceItemsRef.current },
            };
          });
          return;
        }
        if (value.type === 'replace' && typeof value.text === 'string') {
          setState((current) => {
            if (current.status !== 'submitting' && current.status !== 'streaming') return current;
            return { status: 'streaming', request: current.request, response: { answer: value.text ?? '', sources: sourceItemsRef.current } };
          });
          return;
        }
        if (value.type === 'done') {
          clearRequestWatchdog();
          setRequestWatchdogStatus(null);
          if (completedRequestIdRef.current === value.requestId) return;
          const completedState = stateRef.current;
          if (completedState.status !== 'submitting' && completedState.status !== 'streaming') return;
          completedRequestIdRef.current = value.requestId;
          const durationMs = value.metrics?.totalMs ?? (activityStartedAtRef.current ? Date.now() - activityStartedAtRef.current : 0);
          const rendererDoneReceivedAt = Date.now();
          console.info('[local-ai] Ask Ledger renderer performance', {
            requestId: value.requestId,
            rendererDoneReceivedAt,
            rendererFirstDeltaAt: rendererFirstDeltaAtRef.current,
            firstRendererDeltaMs: rendererFirstDeltaAtRef.current && activityStartedAtRef.current ? rendererFirstDeltaAtRef.current - activityStartedAtRef.current : undefined,
            rendererDoneMs: activityStartedAtRef.current ? rendererDoneReceivedAt - activityStartedAtRef.current : undefined,
            performance: value.metrics?.performance,
          });
          const completedActivity = activityStepsRef.current;
          const completedResponse = completedState.status === 'streaming'
            ? completedState.response
            : { answer: '', sources: sourceItemsRef.current };
          setActivityDurationMs(durationMs);
          const isAbstention = Boolean(completedState.request.retrievalRequired)
            && /(?:couldn['’]t find enough information|don't have enough Ledger context)/i.test(completedResponse.answer);
          const answer = isAbstention
            ? "I don't have enough Ledger context to answer that."
            : completedResponse.answer.trim()
              ? completedResponse.answer
              : 'I couldn’t produce a visible answer. Try again or switch to Balanced for this question.';
          const assistantMessage: AskLedgerMessage = {
            id: newAskLedgerMessageId(),
            role: 'assistant',
            content: answer,
            createdAt: new Date().toISOString(),
            sources: completedResponse.sources,
            ...(completedActivity.length ? { activity: { durationMs, steps: completedActivity } } : {}),
            ...(value.skillResult?.sections?.length && value.skillResult.skillId ? { structured: { skillId: value.skillResult.skillId, sections: value.skillResult.sections } } : {}),
          };
          const previousTurn = recentTurnsRef.current[recentTurnsRef.current.length - 1];
          const skillDefinition = value.skillResult?.skillId ? skillCatalog.find((skill) => skill.id === value.skillResult?.skillId) : undefined;
          const proposedActions = value.skillResult?.actionProposals?.filter((action) => skillDefinition?.allowedActions.includes(action.type)).map((action, index) => ({
            id: `${assistantMessage.id}-skill-action-${index}`,
            type: action.type,
            payload: action.payload,
            sourceMessageId: assistantMessage.id,
            status: 'pending' as const,
          })) ?? (completedState.request.responseMode === 'conversational' ? [] : proposeAskLedgerActions({
            question: completedState.request.question,
            answer,
            previousAnswer: previousTurn?.answer,
            initialContext: initialContextRef.current,
            sourceMessageId: assistantMessage.id,
          }));
          if (proposedActions.length) assistantMessage.actions = proposedActions;
          const nextMessages = [...messagesRef.current, assistantMessage];
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
          queueSessionSave(nextMessages);
          const completedTurn: AskLedgerConversationTurn = { question: completedState.request.question, answer, sources: completedResponse.sources };
          recentTurnsRef.current = [...recentTurnsRef.current, completedTurn].slice(-2);
          const conversationState = deriveAskLedgerConversationState(workspaceIdRef.current ?? '', completedState.request.question, conversationStateSources(completedResponse.sources) as never, conversationRef.current?.state);
          conversationRef.current = {
            id: conversationIdRef.current,
            previousQuestion: completedState.request.question,
            previousAnswer: answer,
            previousSources: completedResponse.sources,
            recentExchanges: recentTurnsRef.current,
            initialContext: initialContextRef.current ?? undefined,
            state: conversationState,
          };
          setState(isAbstention ? { status: 'no-answer', request: completedState.request } : { status: 'answer', request: completedState.request, response: { answer, sources: completedResponse.sources } });
          activeRequestIdRef.current = null;
          return;
        }
        if (value.type === 'error') {
          clearRequestWatchdog();
          setRequestWatchdogStatus(null);
          if (value.error?.code === 'cancelled') {
            const current = stateRef.current;
            if ((current.status === 'streaming' || current.status === 'submitting') && current.status === 'streaming' && current.response.answer.trim()) {
              const interruptedMessage: AskLedgerMessage = {
                id: newAskLedgerMessageId(), role: 'assistant',
                content: `${current.response.answer}\n\nGeneration stopped before it finished.`,
                createdAt: new Date().toISOString(), sources: current.response.sources, interrupted: true,
                activity: { durationMs: liveActivityDurationMs, steps: activityStepsRef.current },
              };
              const nextMessages = [...messagesRef.current, interruptedMessage];
              messagesRef.current = nextMessages;
              setMessages(nextMessages);
              queueSessionSave(nextMessages);
            }
            setState({ status: 'focused' });
            activeRequestIdRef.current = null;
            return;
          }
          setState((current) => {
            const request =
              current.status === 'streaming' || current.status === 'submitting'
                ? current.request
                : { question: questionRef.current.trim(), workspaceId: workspaceIdRef.current };
            return { status: 'error', request, message: localAIErrorMessage(value.error?.code, value.error?.message) };
          });
          activeRequestIdRef.current = null;
        }
      }) ?? (() => undefined);
    return () => {
      clearRequestWatchdog();
      requestIdRef.current += 1;
      if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.askLedger?.localAIStatus) return;
    const applyLocalAIStatus = (value: unknown) => {
      const next = value as typeof localAIStatus;
      setLocalAIStatus(next);
      if (isGenerationTier(next?.selectedGenerationTier)) setSelectedGenerationTier(next.selectedGenerationTier);
      if (next?.generationModels) setGenerationModels(Object.values(next.generationModels));
      else if (next?.generation?.tier && next.generation.id) setGenerationModels([{ id: next.generation.id, tier: next.generation.tier, ...next.generation }]);
    };
    void window.askLedger
      .localAIStatus()
      .then(applyLocalAIStatus);
    return window.askLedger.onLocalAIStatus((value) =>
      applyLocalAIStatus(value)
    );
  }, []);

  useEffect(() => {
    if (!window.askLedger?.getGenerationRuntimeState) return;
    void window.askLedger.getGenerationRuntimeState().then((value) => {
      const next = value as typeof generationRuntimeState;
      setGenerationRuntimeState(next);
      if (isGenerationTier(next?.selectedTier)) setSelectedGenerationTier(next.selectedTier);
    });
    if (!window.askLedger.onGenerationRuntimeState) return;
    return window.askLedger.onGenerationRuntimeState((value) => {
      const next = value as typeof generationRuntimeState;
      setGenerationRuntimeState(next);
      if (isGenerationTier(next?.selectedTier)) setSelectedGenerationTier(next.selectedTier);
    });
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [question]);

  const queueSessionSave = (nextMessages: AskLedgerMessage[], title = sessionTitleRef.current) => {
    if (!workspaceId) return;
    sessionSaveChainRef.current = sessionSaveChainRef.current
      .then(async () => {
        let sessionId = sessionIdRef.current;
        if (!sessionId) {
          const created = await api.createAskLedgerSession(workspaceId, { title, messages: nextMessages, initialContext: initialContextRef.current, skillId: sessionSkillIdRef.current }) as { session?: AskLedgerSession };
          sessionId = created.session?.id ?? null;
          sessionIdRef.current = sessionId;
          onSessionIdChange?.(sessionId);
        }
        if (!sessionId) return;
        await api.updateAskLedgerSession(workspaceId, sessionId, { title, messages: nextMessages, initialContext: initialContextRef.current, skillId: sessionSkillIdRef.current });
        onSessionPersisted?.();
      })
      .catch(() => {
        // Session persistence is intentionally non-blocking for asking Ledger.
      });
  };
  const submit = (questionOverride?: string, appendUserMessage = true) => {
    const uiSubmitStartedAt = Date.now();
    const trimmedQuestion = (questionOverride ?? question).trim();
    const selectedSkillForRequest = pendingSkillIdRef.current;
    if ((!trimmedQuestion && !selectedSkillForRequest) || !localAIReady || requestInitializingRef.current || activeRequestIdRef.current) return;

    const effectiveQuestion = trimmedQuestion || (composerAttachments.length ? 'Review this attachment.' : '');
    onQuestionSubmitted?.(effectiveQuestion);
    const submittedAttachments = composerAttachments;
    const submittedInitialContext = activeInitialContext;
    const submittedMessageAttachments: AskLedgerMessageAttachment[] = submittedInitialContext
      ? [...submittedAttachments, { kind: 'resource', resource: { id: submittedInitialContext.resourceId, resourceId: submittedInitialContext.resourceId, title: submittedInitialContext.title, type: submittedInitialContext.resourceType, sourceLabel: sourceTypeLabels[submittedInitialContext.resourceType] } }]
      : submittedAttachments;
    const attachmentIds = submittedAttachments.flatMap((item) => item.kind === 'file' ? [item.attachment.id] : []);

    const customSkill = customSkills.find((skill) => skill.id === selectedSkillForRequest);
    const request: AskLedgerRequest = { question: effectiveQuestion, workspaceId, skillId: selectedSkillForRequest, customSkill, explicitContext: initialContextRef.current ?? undefined, attachmentIds };
    const route = routeAskLedgerMessage(effectiveQuestion, {
      previousQuestion: conversationRef.current?.previousQuestion,
      previousAnswer: conversationRef.current?.previousAnswer,
      previousSources: conversationRef.current?.previousSources,
      recentExchanges: conversationRef.current?.recentExchanges,
      explicitContext: initialContextRef.current ?? undefined,
      hasSelectedSkill: Boolean(selectedSkillForRequest),
      attachmentCount: attachmentIds.length,
    });
    request.responseMode = route.mode;
    request.retrievalRequired = route.retrievalRequired;
    request.answerDepth = route.answerDepth;
    pendingSkillIdRef.current = undefined;
    setSelectedSkillId(null);
    setSkillPickerOpen(false);
    const requestId = ++requestIdRef.current;
    const performanceRequestId = crypto.randomUUID();
    performanceRequestIdRef.current = performanceRequestId;
    rendererFirstDeltaAtRef.current = null;
    const nextTitle = messagesRef.current.length === 0 && appendUserMessage
      ? (trimmedQuestion ? deriveSessionTitle(trimmedQuestion) : skillCatalog.find((skill) => skill.id === selectedSkillForRequest)?.name ?? 'Ask Ledger')
      : sessionTitleRef.current;
    if (messagesRef.current.length === 0 && appendUserMessage) {
      sessionTitleRef.current = nextTitle;
      onSessionTitleChange?.(nextTitle);
    }
    let nextMessages = messagesRef.current;
    if (appendUserMessage) {
      const userMessage: AskLedgerMessage = {
        id: newAskLedgerMessageId(),
        role: 'user',
        content: trimmedQuestion,
        createdAt: new Date().toISOString(),
        skillId: selectedSkillForRequest,
        attachments: submittedMessageAttachments,
      };
      nextMessages = [...messagesRef.current, userMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      queueSessionSave(nextMessages, nextTitle);
    }
    setQuestion('');
    setComposerAttachments([]);
    setAttachmentMenuOpen(false);
    setResourcePickerOpen(false);
    activityStartedAtRef.current = Date.now();
    clearRequestWatchdog();
    setRequestWatchdogStatus(null);
    const watchdogMs = selectedSkillForRequest || route.answerDepth === 'detailed' || /\b(deep|analy[sz]e|compare|trade-offs?)\b/i.test(effectiveQuestion) ? 90_000 : 30_000;
    requestWatchdogTimerRef.current = window.setTimeout(() => {
      requestWatchdogTimerRef.current = null;
      setRequestWatchdogStatus('slow');
      console.warn('[local-ai] Ask Ledger request watchdog', { requestId: performanceRequestId, watchdogMs, requestDepth: route.answerDepth, skillId: selectedSkillForRequest, action: 'cancel_or_retry_available' });
    }, watchdogMs);
    activityStepsRef.current = [];
    setActivitySteps([]);
    setActivityDurationMs(null);
    setActivityExpanded(true);
    setState({ status: 'submitting', request });

    if (!window.askLedger) {
      setState({
        status: 'error',
        request,
        message: 'Local AI is available in the Ledger desktop development runtime.',
      });
      return;
    }
    if (!workspaceId) {
      setState({ status: 'error', request, message: 'Select a workspace before asking Ledger.' });
      return;
    }
    requestInitializingRef.current = true;
    const preflightStartedAt = Date.now();
    void Promise.all(route.retrievalRequired ? [
      api.getAskLedgerDocuments(workspaceId, { scope: askLedgerDocumentScope(effectiveQuestion), ...askLedgerDateWindow(effectiveQuestion), openOnly: /\b(open|todo|to-do|to do|need to do)\b/i.test(effectiveQuestion), project: askLedgerProjectReference(effectiveQuestion), taskHorizon: askLedgerTaskHorizon(effectiveQuestion), assignedToMe: askLedgerAssignedToMe(effectiveQuestion, askLedgerDocumentScope(effectiveQuestion)), integrationQuery: effectiveQuestion }) as Promise<{
        workspaceId?: string;
        documents?: Array<Record<string, unknown>>;
      }>,
      effectiveQuestion ? api.searchWorkspace(workspaceId, effectiveQuestion) as Promise<Array<Record<string, unknown>>> : Promise.resolve([]),
      (api.getSections().catch(() => []) as Promise<Array<Record<string, unknown>> | { sections?: Array<Record<string, unknown>> }>),
      ] : [Promise.resolve({ documents: [] }), Promise.resolve([]), Promise.resolve([])] as const)
      .then(([documentPayload, lexicalResults, sectionPayload]) => {
        if (requestId !== requestIdRef.current || !requestInitializingRef.current) return { requestId: '' };
        const sectionRows = Array.isArray(sectionPayload)
          ? sectionPayload
          : Array.isArray(sectionPayload?.sections)
          ? sectionPayload.sections
          : [];
        const sectionNameById = new Map(
          sectionRows.flatMap((section) => {
            const id = String(section.id ?? '').trim();
            const name = String(section.name ?? section.title ?? '').trim();
            return id && name ? [[id, name] as const] : [];
          })
        );
        const documents: Array<Record<string, unknown>> = [...(documentPayload.documents ?? [])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.resourceType === item.resourceType && candidate.resourceId === item.resourceId) === index)
          .map(
          (item) => {
            if (item.resourceType !== 'note' || item.containerName || item.sectionName) {
              return { ...item, workspaceId };
            }
            const sectionId = String(item.section_id ?? item.sectionId ?? '').trim();
            const sectionName = sectionNameById.get(sectionId);
            return sectionName ? { ...item, workspaceId, containerName: sectionName } : { ...item, workspaceId };
          }
        );
        sourceItemsRef.current = [...documents
          .map((item) => {
            const type = sourceType(item.resourceType);
            return type
              ? { id: String(item.resourceId), title: String(item.title ?? 'Untitled'), type }
              : null;
          })
          .filter((item): item is AskLedgerSource => Boolean(item))
        ].filter((item, index, all) => all.findIndex((candidate) => candidate.type === item.type && candidate.resourceId === item.resourceId) === index).slice(0, 8);
        const startResult = window.askLedger!.start({
          requestId: performanceRequestId,
          question: effectiveQuestion,
          workspaceId,
          documents,
          lexicalResults,
          conversation: conversationRef.current ?? { id: conversationIdRef.current, previousQuestion: '', previousAnswer: '', previousSources: [], recentExchanges: [] },
          skillId: request.skillId,
          customSkill: request.customSkill,
          explicitContext: request.explicitContext,
          attachmentIds: request.attachmentIds,
          messageId: nextMessages[nextMessages.length - 1]?.id,
          performance: { uiSubmitStartedAt, preflightStartedAt, preflightCompletedAt: Date.now() },
        });
        // The selected Ledger resource was attached to this request. Keep it
        // in the sent message, but remove it from the composer so it does not
        // look like an unsent attachment on the next turn.
        initialContextRef.current = null;
        setActiveInitialContext(null);
        return startResult;
      })
      .then(({ requestId: localRequestId }) => {
        requestInitializingRef.current = false;
        if (!localRequestId) return;
        if (requestId !== requestIdRef.current) return;
        if (completedRequestIdRef.current === localRequestId) {
          activeRequestIdRef.current = null;
          return;
        }
        activeRequestIdRef.current = localRequestId;
      })
      .catch(() => {
        requestInitializingRef.current = false;
        if (requestId === requestIdRef.current)
          setState({ status: 'error', request, message: localAIErrorMessage() });
      });
  };

  useEffect(() => {
    const handleSeedQuestion = (event: Event) => {
      const detail = (event as CustomEvent<{ question?: string; submit?: boolean; source?: string }>).detail;
      if (compact && detail?.source === 'fullscreen') return;
      const seededQuestion = detail?.question?.trim();
      if (!seededQuestion) return;
      setQuestion(seededQuestion);
      onQuestionChange?.(seededQuestion);
      if (detail?.submit) window.setTimeout(() => submit(seededQuestion), 0);
      else window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('ledger:ask-ledger-seed-question', handleSeedQuestion);
    return () => window.removeEventListener('ledger:ask-ledger-seed-question', handleSeedQuestion);
  }, [compact, onQuestionChange]);

  const cancel = () => {
    if (!activeRequestIdRef.current && !requestInitializingRef.current) return;
    clearRequestWatchdog();
    setRequestWatchdogStatus(null);
    requestIdRef.current += 1;
    console.info('[local-ai] Ask Ledger renderer cancellation', { requestId: activeRequestIdRef.current ?? performanceRequestIdRef.current, requestIdAvailable: Boolean(activeRequestIdRef.current), cancelledAt: Date.now() });
    if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
    activeRequestIdRef.current = null;
    requestInitializingRef.current = false;
    if (state.status === 'streaming' && state.response.answer.trim()) {
      const interruptedMessage: AskLedgerMessage = {
        id: newAskLedgerMessageId(),
        role: 'assistant',
        content: `${state.response.answer}\n\nGeneration stopped before it finished.`,
        createdAt: new Date().toISOString(),
        sources: state.response.sources,
        interrupted: true,
        activity: { durationMs: liveActivityDurationMs, steps: activityStepsRef.current },
      };
      const nextMessages = [...messagesRef.current, interruptedMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      queueSessionSave(nextMessages);
    }
    setState({ status: 'focused' });
  };

  const retryLastQuestion = () => {
    const lastQuestion = [...messages].reverse().find((message) => message.role === 'user');
    if (lastQuestion) submit(lastQuestion.content, false);
  };

  const copyAnswer = async (message: AskLedgerMessage) => {
    try {
      await navigator.clipboard?.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400);
    } catch {
      // Clipboard access is optional in some desktop/web contexts.
    }
  };

  const startLocalAISetup = () => {
    setupCancelRequestedRef.current = false;
    setSetupStarted(true);
    setSetupError(null);
    void window.askLedger?.downloadLocalAI('generation').then(() => window.askLedger?.downloadLocalAI('embedding')).catch((error) => {
      if (setupCancelRequestedRef.current) return;
      setSetupStarted(false);
      setSetupError(localAISetupErrorMessage(error));
    });
  };

  const cancelLocalAISetup = () => {
    setupCancelRequestedRef.current = true;
    setSetupStarted(false);
    void window.askLedger?.cancelLocalAIDownload('generation');
    void window.askLedger?.cancelLocalAIDownload('embedding');
  };

  const closeSetupModal = () => {
    if (generation?.downloading || embedding?.downloading) return;
    setSetupModalOpen(false);
    setSetupStarted(false);
    setSetupError(null);
  };

  const modelForTier = (tier: GenerationTier) => generationModels.find((model) => model.tier === tier);
  const visibleGenerationTiers = generationTierOrder;
  const visibleRecommendedTier = localAICapability?.recommendedTier && visibleGenerationTiers.includes(localAICapability.recommendedTier)
    ? localAICapability.recommendedTier
    : 'fast';
  const downloadModelView = downloadTier ? modelForTier(downloadTier) : undefined;
  const tierSwitchInProgress = Boolean(switchingTier || generationRuntimeState?.switching);
  const tierWarning = (tier: GenerationTier) => localAICapability?.warnings?.[tier];
  const tierWarningNeedsAcknowledgement = (tier: GenerationTier) => Boolean(tierWarning(tier) && !localAICapability?.acknowledgedTiers?.includes(tier));

  const switchToTier = async (tier: GenerationTier) => {
    if (!window.askLedger?.switchGenerationTier || tierSwitchInProgress) return;
    const model = modelForTier(tier);
    if (!model) {
      setTierSwitchError(`${generationTierLabels[tier]} is not available yet.`);
      return;
    }
    if (model.state === 'unavailable' || model.available === false) {
      setTierSwitchError(`${generationTierLabels[tier]} is not available for download yet.`);
      return;
    }
    if (tierWarningNeedsAcknowledgement(tier)) {
      setDownloadTier(tier);
      setDownloadPhase('confirm');
      setDownloadError(null);
      return;
    }
    if (!model.installed || model.state === 'not_installed' || model.state === 'failed') {
      setDownloadTier(tier);
      setDownloadPhase('confirm');
      setDownloadError(null);
      return;
    }
    setTierSwitchError(null);
    setSwitchingTier(tier);
    const result = await window.askLedger.switchGenerationTier(tier) as { ok?: boolean; state?: string; tier?: GenerationTier; error?: unknown };
    setSwitchingTier(null);
    if (result?.ok && (result.state === 'ready' || result.state === 'noop')) {
      setSelectedGenerationTier(tier);
      return;
    }
    if (result?.state === 'requires_download') {
      setDownloadTier(tier);
      setDownloadPhase('confirm');
      return;
    }
    const detail = errorMessage(result?.error);
    setTierSwitchError(detail ? `Couldn't switch to ${generationTierLabels[tier]}: ${detail}` : `Couldn't switch to ${generationTierLabels[tier]}.`);
  };

  const startOptionalDownload = async () => {
    if (!downloadTier || !window.askLedger?.downloadGenerationModel) return;
    const tier = downloadTier;
    const model = modelForTier(tier);
    if (!model) return;
    setDownloadPhase('downloading');
    setDownloadMinimized(false);
    setDownloadError(null);
    try {
      if (tierWarningNeedsAcknowledgement(tier) && window.askLedger.acknowledgeLocalAITier) {
        const capability = await window.askLedger.acknowledgeLocalAITier(tier) as LocalAICapabilityView;
        setLocalAICapability(capability);
      }
      const result = await window.askLedger.downloadGenerationModel(model.id) as { ok?: boolean; status?: { generationModels?: Record<string, { error?: string | null; state?: string }> }; error?: string; state?: string };
      if (!result?.ok) {
        const status = result.status?.generationModels?.[model.id];
        setDownloadError(optionalModelDownloadMessage(result?.error || status?.error || undefined, result?.state || status?.state));
        setDownloadPhase('error');
        return;
      }
      setDownloadPhase('preparing');
      setDownloadMinimized(false);
      if (!window.askLedger.switchGenerationTier) throw new Error('Model switching is unavailable.');
      const switchResult = await window.askLedger.switchGenerationTier(tier) as { ok?: boolean; state?: string; error?: unknown };
      if (!switchResult?.ok || !['ready', 'noop'].includes(String(switchResult.state))) {
        const detail = errorMessage(switchResult?.error);
        throw new Error(detail || `Couldn't switch to ${generationTierLabels[tier]}.`);
      }
      setSelectedGenerationTier(tier);
      setDownloadTier(null);
      setDownloadPhase('confirm');
      setAdvancedOpen(false);
    } catch (error) {
      setDownloadError(optionalModelDownloadMessage(error));
      setDownloadPhase('error');
    }
  };

  const cancelOptionalDownload = () => {
    const model = downloadTier ? modelForTier(downloadTier) : undefined;
    if (model && model.downloading) void window.askLedger?.cancelGenerationModelDownload(model.id);
    setDownloadTier(null);
    setDownloadPhase('confirm');
    setDownloadError(null);
  };

  const qualityTierAtPointer = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const index = Math.round(ratio * (visibleGenerationTiers.length - 1));
    return visibleGenerationTiers[index] ?? null;
  };

  useEffect(() => {
    if (!advancedOpen) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!advancedPopoverRef.current?.contains(target) && !advancedButtonRef.current?.contains(target)) {
        setAdvancedOpen(false);
        advancedButtonRef.current?.focus();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setAdvancedOpen(false); advancedButtonRef.current?.focus(); }
    };
    window.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('pointerdown', closeOnOutside); window.removeEventListener('keydown', closeOnEscape); };
  }, [advancedOpen]);

  useEffect(() => {
    if (!downloadTier) return undefined;
    const focusTimer = window.setTimeout(() => downloadPrimaryButtonRef.current?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !downloadModalRef.current) return;
      const focusable = Array.from(downloadModalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', trapFocus); advancedButtonRef.current?.focus(); };
  }, [downloadTier]);

  const openSource = (source: AskLedgerSource) => {
    if (!workspaceId) return;
    const id = source.resourceId ?? source.id;
    switch (source.type) {
      case 'project':
        platform.navigation.openRoute(routeForProject(workspaceId, id));
        return;
      case 'task':
        platform.navigation.openRoute(
          source.projectId
            ? routeForProject(workspaceId, source.projectId, id)
            : routeForTask(workspaceId, id)
        );
        return;
      case 'milestone':
        if (source.route) {
          platform.navigation.openRoute(source.route as Parameters<typeof platform.navigation.openRoute>[0]);
        }
        return;
      case 'note':
        platform.navigation.openRoute(routeForNote(workspaceId, source.parentResourceId ?? id));
        return;
      case 'transcript':
        platform.navigation.openRoute(routeForNote(workspaceId, source.parentResourceId ?? id));
        return;
      case 'event':
        platform.navigation.openRoute(routeForCalendarEvent(workspaceId, id));
        return;
      case 'reminder':
        platform.navigation.openRoute(routeForCalendarReminder(workspaceId, id));
        return;
      case 'intake':
        platform.navigation.openRoute(routeForInboxItem(workspaceId, id));
        return;
      case 'team':
        platform.navigation.openRoute({ kind: 'workspace', workspaceId, page: 'team', teamId: id });
        return;
      case 'person':
        if (source.route) {
          platform.navigation.openRoute(source.route as Parameters<typeof platform.navigation.openRoute>[0]);
        }
        return;
      case 'attachment':
        if (source.attachmentSource?.attachmentId) void window.askLedger?.openAttachment(source.attachmentSource.attachmentId);
        return;
      default:
        return;
    }
  };

  const removeInitialContext = () => {
    initialContextRef.current = null;
    setActiveInitialContext(null);
    if (sessionIdRef.current && messagesRef.current.length) queueSessionSave(messagesRef.current);
  };

  const actionLabel = (type: AskLedgerActionType) => ({
    create_task: 'Create task',
    create_note: 'Create note',
    create_reminder: 'Create reminder',
    update_task_status: 'Update task',
  })[type];

  const updateMessageActions = (messageId: string, update: (action: AskLedgerActionProposal) => AskLedgerActionProposal) => {
    const nextMessages = messagesRef.current.map((message) => message.id === messageId
      ? { ...message, actions: message.actions?.map(update) }
      : message);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    queueSessionSave(nextMessages);
  };

  const rejectAction = (action: AskLedgerActionProposal) => {
    updateMessageActions(action.sourceMessageId, (current) => current.id === action.id ? { ...current, status: 'rejected', error: undefined } : current);
  };

  const executeAction = async (action: AskLedgerActionProposal) => {
    const payload = action.payload;
    const title = String(payload.title ?? '').trim();
    if (action.type === 'create_task' && !title) throw new Error('A task title is required.');
    if (action.type === 'create_note' && !title) throw new Error('A note title is required.');
    if (action.type === 'create_reminder' && (!title || !String(payload.remind_at ?? '').trim())) throw new Error('A reminder title and date are required.');
    if (action.type === 'update_task_status' && (!String(payload.task_id ?? '').trim() || !['todo', 'in_progress', 'completed'].includes(String(payload.status)))) throw new Error('This task update is no longer valid.');
    let created: Record<string, unknown> | null = null;
    if (action.type === 'create_task') {
      created = await api.createTask({
        title,
        project_id: payload.project_id ? String(payload.project_id) : null,
        status: String(payload.status ?? 'todo'),
        due_date: payload.due_date ? String(payload.due_date) : null,
        priority: payload.priority ? String(payload.priority) : undefined,
      }) as Record<string, unknown>;
    } else if (action.type === 'create_note') {
      created = await api.createNote(title || 'Ask Ledger notes', String(payload.content ?? '')) as Record<string, unknown>;
    } else if (action.type === 'create_reminder') {
      const remindAt = String(payload.remind_at ?? '').trim();
      if (!remindAt) throw new Error('Choose a reminder date before creating it.');
      created = await api.createReminder({ title, remind_at: remindAt, project_id: payload.project_id ? String(payload.project_id) : null }) as Record<string, unknown>;
    } else if (action.type === 'update_task_status') {
      created = await api.updateTask(String(payload.task_id), { status: String(payload.status) }) as Record<string, unknown>;
    }
    const nestedId = (key: string) => {
      const value = created?.[key];
      return value && typeof value === 'object' && 'id' in value ? String((value as { id?: unknown }).id ?? '') : '';
    };
    const id = String(created?.id ?? (nestedId('task') || nestedId('note') || nestedId('reminder') || payload.task_id || ''));
    return { id, title: String(payload.title ?? created?.title ?? 'Task') };
  };

  const executeActionGroup = async (actions: AskLedgerActionProposal[]) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      for (const action of actions) {
        if (action.status === 'created') continue;
        try {
          const result = await executeAction(action);
          updateMessageActions(action.sourceMessageId, (current) => current.id === action.id
            ? { ...current, ...action, status: 'created', resultResourceId: result.id, resultTitle: result.title, error: undefined }
            : current);
        } catch (error) {
          updateMessageActions(action.sourceMessageId, (current) => current.id === action.id
            ? { ...current, ...action, status: 'failed', error: error instanceof Error ? error.message : 'Could not complete this action.' }
            : current);
        }
      }
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
      setActionReview(null);
      setActionDraft(null);
    }
  };

  const openActionResult = (action: AskLedgerActionProposal) => {
    if (!action.resultResourceId || !workspaceId) return;
    const type = action.type === 'create_note' ? 'note' : action.type === 'create_reminder' ? 'reminder' : 'task';
    openSource({ id: action.resultResourceId, resourceId: action.resultResourceId, title: action.resultTitle ?? 'Created resource', type });
  };

  const isSubmitting = state.status === 'submitting' || state.status === 'streaming';
  const generationActive = state.status === 'submitting' || (state.status === 'streaming' && !state.response.answer);

  useEffect(() => {
    onGenerationActiveChange?.(generationActive);
  }, [generationActive, onGenerationActiveChange]);

  useEffect(() => {
    if (!generationActive) {
      setGenerationPhrase(GENERATION_PHRASES[0]);
      return undefined;
    }
    let index = 0;
    setGenerationPhrase(GENERATION_PHRASES[index]);
    const timer = window.setInterval(() => {
      index = (index + 1) % GENERATION_PHRASES.length;
      setGenerationPhrase(GENERATION_PHRASES[index]);
    }, 950);
    return () => window.clearInterval(timer);
  }, [generationActive]);

  const generation = localAIStatus?.generation;
  const embedding = localAIStatus?.embedding;
  const localAIReady = Boolean(generation?.installed && embedding?.installed);
  const localAIUnavailable = Boolean(window.askLedger && localAIStatus && !localAIReady);
  const localAITotalBytes = (generation?.expectedSize ?? 0) + (embedding?.expectedSize ?? 0) || generation?.expectedSize;
  const localAIBytesDownloaded = (generation?.bytesDownloaded ?? 0) + (embedding?.bytesDownloaded ?? 0);
  const localAIProgress = localAITotalBytes
    ? Math.min(100, Math.round((localAIBytesDownloaded / localAITotalBytes) * 100))
    : 0;
  const localAISettingUp = Boolean(generation?.downloading || embedding?.downloading || (setupStarted && !localAIReady));

  useEffect(() => {
    const context = activeInitialContext;
    if (initialSession || !context?.initialQuestion?.trim() || !localAIReady || requestInitializingRef.current || activeRequestIdRef.current) return;
    const key = `${context.resourceType}:${context.resourceId}:${context.initialQuestion}`;
    if (autoSubmittedContextRef.current === key) return;
    const timer = window.setTimeout(() => {
      if (autoSubmittedContextRef.current === key) return;
      autoSubmittedContextRef.current = key;
      submit(context.initialQuestion, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeInitialContext, initialSession, localAIReady, submit]);
  const localAIVerifying = Boolean(
    setupStarted && !generation?.downloading && !embedding?.downloading && !localAIReady && !setupError
  );
  const displayedRequest =
    state.status === 'answer' ||
    state.status === 'streaming' ||
    state.status === 'no-answer' ||
    state.status === 'error'
      ? state.request.question
      : '';

  useEffect(() => {
    if (!localAIReady) return;
    setSetupStarted(false);
    setSetupModalOpen(false);
    setSetupError(null);
  }, [localAIReady]);

  useEffect(() => {
    if (!localAIReady || !window.askLedger?.localAICapability) return;
    void window.askLedger.localAICapability().then((value) => setLocalAICapability(value as LocalAICapabilityView));
  }, [localAIReady]);

  useEffect(() => {
    if (!isSubmitting || !activityStartedAtRef.current) return;
    const timer = window.setInterval(() => setActivityNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isSubmitting]);

  const liveActivityDurationMs = activityDurationMs ?? (activityStartedAtRef.current ? activityNow - activityStartedAtRef.current : 0);

  useEffect(() => {
    if (!conversationActive || !['answer', 'no-answer', 'error'].includes(state.status)) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [conversationActive, state.status]);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (!conversationActive || latestMessage?.role !== 'user') return;
    const scrollTimer = window.setTimeout(() => latestMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    return () => window.clearTimeout(scrollTimer);
  }, [conversationActive, messages.length]);

  return (
      <div className={compact
      ? `agent-ask-ledger-content flex h-full min-h-0 flex-col ${conversationActive ? 'agent-ask-ledger-content--active' : ''}`
      : conversationActive ? 'flex h-full min-h-0 flex-col' : 'mt-5'}>
      {conversationActive && (
        <section className="order-1 min-h-0 flex-1 space-y-10 overflow-y-auto pb-32 pt-8" aria-live="polite">
          {messages.map((message, messageIndex) => (
            <article key={message.id} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} className={message.role === 'user' ? 'group flex justify-end' : 'group max-w-[640px]'}>
              {message.role === 'user' ? (
                <div className="flex max-w-[78%] flex-col items-end gap-1">
                  {message.skillId && <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ledger-text-muted)]"><Boxes size={12} />{skillCatalog.find((skill) => skill.id === message.skillId)?.name}</span>}
                  {message.attachments?.length ? <div className="flex max-w-full flex-wrap justify-end gap-1.5">{message.attachments.map((attachment, index) => attachment.kind === 'file' ? <button key={`${message.id}-file-${attachment.attachment.id}`} type="button" onClick={() => void window.askLedger?.openAttachment(attachment.attachment.id)} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]" aria-label={`Open ${attachment.attachment.name}`}><FileText size={12} className="shrink-0 text-[var(--ledger-text-muted)]" /><span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">{attachmentKindLabel(attachment.attachment)}</span><span className="truncate">{attachmentDisplayName(attachment.attachment.name)}</span></button> : <button key={`${message.id}-resource-${index}`} type="button" onClick={() => openSource(attachment.resource)} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]" aria-label={`Open ${attachment.resource.title}`}><span className="truncate">{attachment.resource.title}</span></button>)}</div> : null}
                  {message.content && <>
                    <p className="w-fit rounded-lg bg-[var(--ledger-surface-hover)] px-3 py-2 text-sm leading-6 text-[var(--ledger-text-primary)]">{message.content}</p>
                    <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" onClick={() => void copyAnswer(message)} aria-label={copiedMessageId === message.id ? 'Copied message' : 'Copy message'} title={copiedMessageId === message.id ? 'Copied' : 'Copy message'} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">{copiedMessageId === message.id ? <Check size={14} /> : <CopyIcon size={14} />}</button>
                    </div>
                  </>}
                </div>
              ) : (
                <div>
                  {message.activity?.steps?.length ? <AskLedgerActivityTrace steps={message.activity.steps} durationMs={message.activity.durationMs} expanded={Boolean(expandedActivity[message.id])} onToggle={() => setExpandedActivity((current) => ({ ...current, [message.id]: !current[message.id] }))} /> : null}
                  {message.structured?.sections?.length ? (
                    <div className="space-y-6 text-[15px] leading-7 text-[var(--ledger-text-secondary)]">
                      {message.structured.sections.map((section) => (
                        <section key={`${message.id}-${section.title}`}>
                          <h3 className="mb-2 text-sm font-medium text-[var(--ledger-text-primary)]">{section.title}</h3>
                          <div className="space-y-3">{renderAnswerContent(section.content)}</div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4 text-[15px] leading-7 text-[var(--ledger-text-secondary)]">{renderAnswerContent(message.content)}</div>
                  )}
                  {message.actions && message.actions.length > 0 && (
                    <div className="mt-5 space-y-2">
                      {message.actions.some((action) => action.status === 'pending') && (
                        <div className="space-y-1 text-sm text-[var(--ledger-text-secondary)]">
                          {message.actions.filter((action) => action.status === 'pending').map((action) => <p key={action.id}>- {String(action.payload.title ?? actionLabel(action.type))}</p>)}
                        </div>
                      )}
                      {message.actions.some((action) => action.status === 'pending') && (
                        <button type="button" onClick={() => { const pending = message.actions?.filter((action) => action.status === 'pending') ?? []; setActionDraft(pending.length === 1 ? pending[0] : null); setActionReview({ actions: pending, title: pending.length === 1 ? actionLabel(pending[0].type) : `Create ${pending.length} tasks` }); }} className="rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">{message.actions.filter((action) => action.status === 'pending').length > 1 ? `Create ${message.actions.filter((action) => action.status === 'pending').length} tasks` : actionLabel(message.actions.find((action) => action.status === 'pending')?.type ?? 'create_task')}</button>
                      )}
                      {message.actions.some((action) => action.status === 'created') && (
                        <p className="text-xs text-[var(--ledger-text-muted)]">✓ {message.actions.filter((action) => action.status === 'created').length} {message.actions.some((action) => action.type === 'create_task') ? 'tasks' : 'actions'} created</p>
                      )}
                      {message.actions.some((action) => action.status === 'failed') && (
                        <p className="text-xs text-[var(--ledger-text-muted)]">{message.actions.filter((action) => action.status === 'created').length} of {message.actions.filter((action) => action.status !== 'rejected').length} actions completed. <button type="button" onClick={() => { const failed = message.actions?.filter((action) => action.status === 'failed') ?? []; setActionDraft(failed.length === 1 ? failed[0] : null); setActionReview({ actions: failed, title: `Retry ${failed.length} failed ${failed.length === 1 ? 'action' : 'actions'}` }); }} className="underline underline-offset-2">Retry</button></p>
                      )}
                      {message.actions.filter((action) => action.status === 'created').map((action) => <button key={action.id} type="button" onClick={() => openActionResult(action)} className="mr-3 text-xs text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">✓ {action.resultTitle || 'Created'}</button>)}
                      {message.actions.filter((action) => action.status === 'failed').map((action) => <p key={`${action.id}-error`} className="text-xs text-[var(--ledger-text-muted)]">! {String(action.payload.title ?? actionLabel(action.type))} could not be created: {action.error}</p>)}
                    </div>
                  )}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-4">
                      <button
                        type="button"
                        aria-expanded={Boolean(expandedSources[message.id])}
                        aria-controls={`ask-ledger-sources-${message.id}`}
                        onClick={() => setExpandedSources((current) => ({ ...current, [message.id]: !current[message.id] }))}
                        className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                      >
                        <img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="" className="h-4 w-4 shrink-0" />
                        <span>Ledger sources</span>
                        <span className="text-[11px] text-[var(--ledger-text-muted)]">{message.sources.length}</span>
                        <ChevronDown size={13} className={`transition-transform ${expandedSources[message.id] ? 'rotate-180' : ''}`} />
                      </button>
                      {expandedSources[message.id] && <div id={`ask-ledger-sources-${message.id}`} className="mt-1.5 max-h-64 space-y-1 overflow-y-auto pl-1">
                        {message.sources.map((source) => {
                          const Icon = sourceIconMap[source.type];
                          return <button key={source.id} type="button" onClick={() => openSource(source)} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left transition hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]"><Icon size={14} className="shrink-0 text-[var(--ledger-text-muted)]" /><span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-secondary)]">{source.title}</span><span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">{source.sourceLabel ?? sourceTypeLabels[source.type]}</span></button>;
                        })}
                      </div>}
                    </div>
                  )}
                  <div className="mt-4 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => void copyAnswer(message)} aria-label={copiedMessageId === message.id ? 'Copied answer' : 'Copy answer'} title={copiedMessageId === message.id ? 'Copied' : 'Copy answer'} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">{copiedMessageId === message.id ? <Check size={14} /> : <CopyIcon size={14} />}</button>
                  </div>
                </div>
              )}
            </article>
          ))}
          {(state.status === 'submitting' || state.status === 'streaming') && (
            <article className="max-w-[640px]">
              {state.request.retrievalRequired !== false && <AskLedgerActivityTrace steps={activitySteps} durationMs={liveActivityDurationMs} active expanded={activityExpanded} onToggle={() => setActivityExpanded((current) => !current)} generationPhrase={requestWatchdogStatus === 'slow' ? 'Still working — Cancel is available.' : generationPhrase} />}
              {state.status === 'streaming' && state.response.answer ? <div className="mt-4 space-y-4 text-[15px] leading-7 text-[var(--ledger-text-secondary)]">{renderAnswerContent(state.response.answer)}</div> : null}
            </article>
          )}
          {state.status === 'error' && <article className="max-w-[640px] text-sm text-[var(--ledger-text-muted)]" role="alert"><p>Ledger couldn’t answer this question.</p><button type="button" onClick={retryLastQuestion} className="mt-2 text-xs text-[var(--ledger-text-primary)] underline-offset-2 hover:underline">Try again</button></article>}
        </section>
      )}
      <div
        ref={skillPickerRef}
        className={`ask-ledger-composer ${conversationActive ? 'order-2 sticky bottom-4 z-10 mt-auto min-h-[104px]' : 'mx-auto min-h-[104px] max-w-[620px]'} relative flex w-full flex-col rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 py-3 shadow-[0_4px_18px_rgba(17,24,39,0.04)] transition focus-within:border-[color:var(--ledger-border-strong)] ${localAIUnavailable ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (localAIUnavailable) setSetupModalOpen(true);
        }}
      >
        {(activeInitialContext || selectedSkill || composerAttachments.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
            {composerAttachments.map((attachment) => (
              <span key={`${attachment.kind}-${attachment.kind === 'file' ? attachment.attachment.id : attachment.resource.resourceId}`} className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-md bg-[var(--ledger-surface-hover)] px-2 text-xs text-[var(--ledger-text-secondary)]">
                {attachment.kind === 'file' ? <FileText size={12} className="shrink-0 text-[var(--ledger-text-muted)]" /> : (() => { const Icon = sourceIconMap[attachment.resource.type]; return <Icon size={12} className="shrink-0 text-[var(--ledger-text-muted)]" />; })()}
                <span className="min-w-0 truncate">{attachment.kind === 'file' ? attachmentDisplayName(attachment.attachment.name) : attachment.resource.title}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); removeComposerAttachment(attachment); }} aria-label={`Remove ${attachment.kind === 'file' ? attachment.attachment.name : attachment.resource.title}`} className="ml-0.5 rounded p-0.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)]"><X size={12} /></button>
              </span>
            ))}
            {activeInitialContext && (
              <span className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-md bg-[var(--ledger-surface-hover)] px-2 text-xs text-[var(--ledger-text-secondary)]">
                <FileText size={12} className="shrink-0 text-[var(--ledger-text-muted)]" />
                <span className="min-w-0 truncate">{activeInitialContext.title}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); removeInitialContext(); }} aria-label="Remove Ask Ledger context" className="ml-0.5 rounded p-0.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)]">×</button>
              </span>
            )}
            {selectedSkill && (
              <span className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-md bg-[var(--ledger-surface-hover)] px-2 text-xs text-[var(--ledger-text-secondary)]">
                <Boxes size={12} className="text-[var(--ledger-text-muted)]" />
                <span className="min-w-0 truncate">{selectedSkill.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${selectedSkill.name}`}
                  onClick={(event) => { event.stopPropagation(); setSelectedSkillId(null); pendingSkillIdRef.current = undefined; sessionSkillIdRef.current = undefined; inputRef.current?.focus(); }}
                  className="ml-0.5 rounded p-0.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)]"
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={question}
          readOnly={!localAIReady}
          onChange={(event) => {
            if (!localAIReady) return;
            setQuestion(event.target.value);
            onQuestionChange?.(event.target.value);
            if (state.status === 'idle') setState({ status: 'focused' });
          }}
          onFocus={() => {
            if (localAIUnavailable) setSetupModalOpen(true);
            if (state.status === 'idle') setState({ status: 'focused' });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isSubmitting) {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (localAIReady) submit();
            }
          }}
          rows={3}
          placeholder={skillPlaceholder(selectedSkill) ?? (conversationActive ? 'Reply...' : 'Ask Ledger...')}
          aria-label="Ask Ledger"
          aria-disabled={localAIUnavailable}
          aria-describedby={localAIUnavailable ? 'ask-ledger-setup-help' : undefined}
          className={`max-h-32 ${conversationActive ? 'min-h-[44px]' : 'min-h-[52px]'} min-w-0 flex-1 resize-none self-stretch border-0 bg-transparent p-0 text-sm leading-6 shadow-none outline-none ring-0 placeholder:text-[var(--ledger-placeholder)] focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${localAIUnavailable ? 'cursor-pointer text-[var(--ledger-text-secondary)]' : 'text-[var(--ledger-text-primary)]'}`}
        />
        {localAIUnavailable && <span id="ask-ledger-setup-help" className="sr-only">Set up Local AI to ask your workspace.</span>}
        {attachmentError && <p role="alert" className="mt-1 truncate text-[11px] text-[var(--ledger-danger)]">{attachmentError}</p>}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="relative">
            <button
              ref={skillButtonRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={skillPickerOpen}
              onClick={(event) => {
                event.stopPropagation();
                const nextOpen = !skillPickerOpen;
                setSkillPickerOpen(nextOpen);
                if (nextOpen) window.setTimeout(() => skillOptionRefs.current[0]?.focus(), 0);
              }}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSkillPickerOpen(false); inputRef.current?.focus(); } }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <Boxes size={13} />
              <span>Skills</span>
              <ChevronDown size={12} className={`transition-transform ${skillPickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {skillPickerOpen && skillPopupPosition && createPortal(
              <div
                ref={skillPopupRef}
                role="listbox"
                aria-label="Ledger Skills"
                tabIndex={-1}
                onKeyDown={(event) => {
                  const currentIndex = skillOptionRefs.current.findIndex((option) => option === document.activeElement);
                  if (event.key === 'Escape') { event.preventDefault(); setSkillPickerOpen(false); inputRef.current?.focus(); }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const nextIndex = event.key === 'ArrowDown' ? Math.min(currentIndex + 1, skillCatalog.length - 1) : Math.max(currentIndex - 1, 0);
                    skillOptionRefs.current[nextIndex]?.focus();
                  }
                }}
                style={{ left: skillPopupPosition.left, top: skillPopupPosition.top, maxHeight: skillPopupPosition.maxHeight, transform: skillPopupPosition.transform }}
                className={`agent-ask-ledger-portal fixed z-[2147483647] overflow-y-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)] ${compact ? 'agent-ask-ledger-portal--compact' : 'w-[280px]'}`}
              >
                {contextPickerSkill ? (
                  <div role="dialog" aria-label={`Choose context for ${contextPickerSkill.name}`}>
                    <div className="flex items-center gap-2 border-b border-[color:var(--ledger-border-subtle)] px-2.5 py-2">
                      <button type="button" onClick={() => setContextPickerSkill(null)} className="text-[11px] text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">Back</button>
                      <span className="truncate text-xs font-medium text-[var(--ledger-text-primary)]">{skillRequirementLabel(contextPickerSkill)}</span>
                    </div>
                    <input autoFocus value={contextPickerSearch} onChange={(event) => setContextPickerSearch(event.target.value)} placeholder="Search Ledger" aria-label="Search Ledger context" className="mx-1 my-1 h-8 w-[calc(100%-8px)] rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-xs text-[var(--ledger-text-primary)] outline-none" />
                    <div className="max-h-56 overflow-y-auto">
                      {contextPickerLoading ? <p className="px-2.5 py-3 text-xs text-[var(--ledger-text-muted)]">Loading Ledger resources…</p> : contextPickerOptions.filter((item) => item.title.toLowerCase().includes(contextPickerSearch.toLowerCase())).slice(0, 30).map((context) => <button key={`${context.resourceType}:${context.resourceId}`} type="button" onClick={() => selectSkillContext(context)} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"><span className="min-w-0 flex-1 truncate">{context.title}</span><span className="ml-2 text-[10px] text-[var(--ledger-text-muted)]">{context.resourceType}</span></button>)}
                      {!contextPickerLoading && !contextPickerOptions.length && <p className="px-2.5 py-3 text-xs text-[var(--ledger-text-muted)]">No matching Ledger resources.</p>}
                    </div>
                  </div>
                ) : skillCatalog.map((skill, index) => {
                  const Icon = skillIconMap[skill.icon as keyof typeof skillIconMap] ?? Boxes;
                  const requirement = skillRequirementLabel(skill);
                  return (
                    <button
                      key={skill.id}
                      ref={(element) => { skillOptionRefs.current[index] = element; }}
                      type="button"
                      role="option"
                      aria-selected={selectedSkillId === skill.id}
                      onClick={() => selectSkill(skill)}
                      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"
                    >
                      <Icon size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[var(--ledger-text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[var(--ledger-text-primary)]">{skill.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--ledger-text-muted)]">{requirement ?? skill.description}</span>
                      </span>
                      {skill.isCustom && <span role="button" tabIndex={0} aria-label={`Edit ${skill.name}`} title={`Edit ${skill.name}`} onClick={(event) => { event.stopPropagation(); const custom = customSkills.find((item) => item.id === skill.id); if (custom) onEditCustomSkill?.(custom); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); const custom = customSkills.find((item) => item.id === skill.id); if (custom) onEditCustomSkill?.(custom); } }} className="px-1 text-sm text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">⋯</span>}
                    </button>
                  );
                })}
                <div className="mt-1 border-t border-[color:var(--ledger-border-subtle)] pt-1">
                  <button type="button" onClick={() => { setSkillPickerOpen(false); window.dispatchEvent(new CustomEvent('ledger:ask-ledger-create-skill')); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"><span className="text-base leading-none text-[var(--ledger-text-muted)]">+</span><span>Create skill</span></button>
                </div>
              </div>,
              document.documentElement
            )}
          </div>
        <div className="flex items-center gap-1">
          {downloadMinimized && downloadTier && downloadPhase === 'downloading' && <button type="button" onClick={() => setDownloadMinimized(false)} className="inline-flex h-7 max-w-40 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]" aria-label={`Show ${generationTierLabels[downloadTier]} download progress`}><Download size={13} /><span className="truncate">Downloading {generationTierLabels[downloadTier]} {downloadModelView?.progressPercent ?? 0}%</span></button>}
            {localAIUnavailable && (
              <button type="button" onClick={(event) => { event.stopPropagation(); setSetupModalOpen(true); }} aria-label="Set up Local AI" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><AlertCircle size={15} /></button>
            )}
            <div ref={attachmentMenuRef} className="relative">
              <button type="button" onClick={(event) => { event.stopPropagation(); setAdvancedOpen(false); setAttachmentMenuOpen((open) => !open); setResourcePickerOpen(false); }} aria-label="Add attachment" aria-expanded={attachmentMenuOpen} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">
                <Paperclip size={15} />
              </button>
              {attachmentMenuOpen && (
                <div role="menu" aria-label="Add Ask Ledger context" className="absolute bottom-9 right-0 z-40 w-56 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]">
                  {!resourcePickerOpen ? <>
                    <button type="button" role="menuitem" onClick={() => void uploadAttachments()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><Paperclip size={14} />Upload file</button>
                    <button type="button" role="menuitem" onClick={() => void openResourcePicker()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><FolderKanban size={14} />Add Ledger resource</button>
                  </> : <>
                    <button type="button" onClick={() => setResourcePickerOpen(false)} className="w-full px-3 py-2 text-left text-xs text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">← Back</button>
                    <div className="max-h-56 overflow-y-auto border-t border-[color:var(--ledger-border-subtle)] pt-1">{resourcePickerLoading ? <p className="px-3 py-3 text-xs text-[var(--ledger-text-muted)]">Loading Ledger resources…</p> : resourcePickerOptions.map((resource) => <button key={`${resource.type}:${resource.resourceId}`} type="button" onClick={() => addResourceAttachment(resource)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><span className="min-w-0 flex-1 truncate">{resource.title}</span><span className="text-[10px] text-[var(--ledger-text-muted)]">{sourceTypeLabels[resource.type]}</span></button>)}{!resourcePickerLoading && !resourcePickerOptions.length && <p className="px-3 py-3 text-xs text-[var(--ledger-text-muted)]">No Ledger resources available.</p>}</div>
                  </>}
                </div>
              )}
            </div>
            {isSubmitting && <button type="button" onClick={cancel} aria-label="Cancel generation" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><Square size={12} /></button>}
            <button type="button" onClick={() => submit()} disabled={(!question.trim() && !selectedSkillId && !composerAttachments.length) || !localAIReady || isSubmitting} aria-label="Submit question" className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)] disabled:opacity-35">
              {isSubmitting ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          {localAIReady && (
            <div className="ledger-ask-model-control relative order-first">
              <button
                ref={advancedButtonRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={advancedOpen}
                onPointerDown={(event) => { event.stopPropagation(); qualityPointerInteractionRef.current = false; }}
                onClick={(event) => { event.stopPropagation(); qualityPointerInteractionRef.current = false; setAttachmentMenuOpen(false); setAdvancedOpen((open) => !open); setAdvancedView('quality'); setTierSwitchError(null); }}
                disabled={tierSwitchInProgress}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:cursor-wait disabled:opacity-60"
              >
                <SlidersHorizontal size={13} />
                <span>{generationTierLabels[selectedGenerationTier]}</span>
              </button>
              {advancedOpen && (
                <div ref={advancedPopoverRef} role="dialog" aria-label="Advanced Local AI settings" onPointerDown={(event) => event.stopPropagation()} className="absolute bottom-9 left-0 z-40 w-[min(180px,calc(100vw-24px))] overflow-hidden rounded-[12px] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-2.5 py-2.5 shadow-[var(--ledger-shadow)]">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setAdvancedView((view) => view === 'quality' ? 'models' : 'quality')} className="flex items-center gap-1 text-xs font-medium tracking-[-0.02em] text-[var(--ledger-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ledger-accent)]" aria-label={advancedView === 'quality' ? 'Show local AI models' : 'Show answer quality'}>
                      <span>Advanced</span>{advancedView === 'quality' ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    </button>
                    {tierSwitchInProgress && <LoaderCircle size={15} className="shrink-0 animate-spin text-[var(--ledger-text-muted)]" aria-label="Switching Local AI model" />}
                  </div>
                  {advancedView === 'quality' ? <>
                    <div
                    key={advancedView}
                    className="ledger-ask-advanced-view relative mt-3 h-9"
                    role="radiogroup"
                    aria-label="Local AI quality"
                    onPointerDown={(event) => {
                      if (tierSwitchInProgress) return;
                      event.preventDefault();
                      qualityPointerInteractionRef.current = true;
                      qualityPointerIdRef.current = event.pointerId;
                      qualitySuppressClickRef.current = false;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setQualityDragTier(qualityTierAtPointer(event.clientX, event.currentTarget));
                    }}
                    onPointerMove={(event) => {
                      if (qualityPointerInteractionRef.current && qualityPointerIdRef.current === event.pointerId) {
                        setQualityDragTier(qualityTierAtPointer(event.clientX, event.currentTarget));
                      }
                    }}
                    onPointerUp={(event) => {
                      if (qualityPointerIdRef.current !== event.pointerId) return;
                      const tier = qualityDragTier;
                      qualityPointerInteractionRef.current = false;
                      qualityPointerIdRef.current = null;
                      qualitySuppressClickRef.current = true;
                      setQualityDragTier(null);
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      if (tier) void switchToTier(tier);
                    }}
                    onPointerCancel={(event) => {
                      if (qualityPointerIdRef.current !== event.pointerId) return;
                      qualityPointerInteractionRef.current = false;
                      qualityPointerIdRef.current = null;
                      setQualityDragTier(null);
                    }}
                    onLostPointerCapture={() => {
                      qualityPointerInteractionRef.current = false;
                      qualityPointerIdRef.current = null;
                      setQualityDragTier(null);
                    }}
                  >
                    <div className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-full bg-[var(--ledger-accent)]" aria-hidden="true" />
                    <div className="relative grid h-full grid-cols-3 items-center px-3">
                      {visibleGenerationTiers.map((tier) => {
                        const model = modelForTier(tier);
                        const installed = model?.installed || model?.state === 'installed';
                        const unavailable = model?.state === 'unavailable' || model?.available === false;
                        const active = (qualityDragTier ?? selectedGenerationTier) === tier;
                        return (
                          <button
                            key={tier}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={`${generationTierLabels[tier]}: ${generationTierDescriptions[tier]}${installed ? ', installed' : unavailable ? ', unavailable' : ', download required'}`}
                            disabled={tierSwitchInProgress}
                            onClick={() => {
                              if (qualityPointerInteractionRef.current || qualitySuppressClickRef.current) {
                                qualityPointerInteractionRef.current = false;
                                qualitySuppressClickRef.current = false;
                                return;
                              }
                              void switchToTier(tier);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                              event.preventDefault();
                              const index = visibleGenerationTiers.indexOf(tier) + (event.key === 'ArrowRight' ? 1 : -1);
                              const nextTier = visibleGenerationTiers[Math.max(0, Math.min(visibleGenerationTiers.length - 1, index))];
                              if (nextTier) void switchToTier(nextTier);
                            }}
                            className="group flex h-full min-w-0 items-center justify-center rounded-lg px-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--ledger-surface)] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <span className={`z-10 rounded-full transition ${active ? 'h-9 w-9 bg-[var(--ledger-text-primary)] shadow-[0_1px_3px_rgba(17,24,39,0.18)]' : 'h-1.5 w-1.5 bg-[var(--ledger-accent-soft)]'}`} aria-hidden="true" />
                            <span className="sr-only">{generationTierLabels[tier]}{visibleRecommendedTier === tier ? ', recommended for this device' : tierWarning(tier) ? ', may respond more slowly on this device' : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                    </div>
                    <span className="sr-only" aria-live="polite">{tierSwitchInProgress ? 'Switching Local AI model…' : `${generationTierLabels[selectedGenerationTier]} selected`}</span>
                  </> : (
                    <div key={advancedView} className="ledger-ask-advanced-view mt-3 space-y-0.5" role="radiogroup" aria-label="Local AI models">
                      {generationTierOrder.map((tier) => {
                        const model = modelForTier(tier);
                        const installed = Boolean(model?.installed || model?.state === 'installed');
                        const unavailable = model?.state === 'unavailable' || model?.available === false;
                        return <button key={tier} type="button" role="radio" aria-checked={selectedGenerationTier === tier} onClick={() => void switchToTier(tier)} disabled={tierSwitchInProgress} className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ledger-accent)] ${selectedGenerationTier === tier ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]' : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'} disabled:opacity-55`}><span className="min-w-0 font-medium">{generationTierLabels[tier]}</span><span className="flex shrink-0 items-center justify-end text-[10px] text-[var(--ledger-text-muted)]" aria-label={switchingTier === tier ? 'Switching' : installed ? 'Installed' : unavailable ? 'Unavailable' : 'Download required'}>{switchingTier === tier ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : installed ? 'Installed' : <AlertCircle size={13} aria-hidden="true" />}</span></button>;
                      })}
                    </div>
                  )}
                  {tierSwitchError && <p className="mt-2 text-[11px] text-[var(--ledger-danger)]" role="alert">{tierSwitchError}</p>}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
      {!conversationActive && (
        <section className="mt-7" aria-labelledby="ask-ledger-examples-heading">
          <h2 id="ask-ledger-examples-heading" className="mb-2 px-1 text-xs font-medium text-[var(--ledger-text-muted)]">Get started with some examples</h2>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {emptyStateExamples.map(({ title, description, icon: Icon, prompt }) => (
              <button
                key={title}
                type="button"
                onClick={() => {
                  if (!localAIReady) {
                    if (localAIUnavailable) setSetupModalOpen(true);
                    return;
                  }
                  submit(prompt);
                }}
                className="group flex min-h-[72px] items-start gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-[color:var(--ledger-border-subtle)] hover:bg-[var(--ledger-surface-hover)]"
              >
                <Icon size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[var(--ledger-text-muted)] transition group-hover:text-[var(--ledger-text-primary)]" />
                <span className="min-w-0"><span className="block truncate text-sm text-[var(--ledger-text-primary)]">{title}</span><span className="mt-0.5 block truncate text-xs leading-5 text-[var(--ledger-text-muted)]">{description}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <ModalOverlay
        isOpen={Boolean(actionReview)}
        onClose={() => { if (!actionBusy) { setActionReview(null); setActionDraft(null); } }}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">{actionReview?.title ?? 'Review action'}</h2>
            <button type="button" aria-label="Close action review" onClick={() => { setActionReview(null); setActionDraft(null); }} disabled={actionBusy} className="text-sm text-[var(--ledger-text-muted)]">×</button>
          </div>
          {actionDraft ? (
            <div className="mt-5 space-y-3">
              <label className="block text-xs text-[var(--ledger-text-muted)]">Title<input value={String(actionDraft.payload.title ?? '')} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, title: event.target.value } })} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]" /></label>
              {actionDraft.type === 'create_task' && <>
                <label className="block text-xs text-[var(--ledger-text-muted)]">Project (optional)<select value={String(actionDraft.payload.project_id ?? '')} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, project_id: event.target.value || null } })} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"><option value="">No project</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2"><label className="block text-xs text-[var(--ledger-text-muted)]">Status<select value={String(actionDraft.payload.status ?? 'todo')} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, status: event.target.value } })} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)]"><option value="todo">To do</option><option value="in_progress">In progress</option></select></label><label className="block text-xs text-[var(--ledger-text-muted)]">Due date<input type="date" value={String(actionDraft.payload.due_date ?? '')} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, due_date: event.target.value || null } })} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)]" /></label></div>
              </>}
              {actionDraft.type === 'create_reminder' && <label className="block text-xs text-[var(--ledger-text-muted)]">Reminder date<input type="date" value={String(actionDraft.payload.remind_at ?? '').slice(0, 10)} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, remind_at: event.target.value ? `${event.target.value}T09:00:00.000Z` : null } })} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]" />{!actionDraft.payload.remind_at && <span className="mt-1 block text-[11px]">Choose a date to continue.</span>}</label>}
              {actionDraft.type === 'create_note' && <label className="block text-xs text-[var(--ledger-text-muted)]">Content<textarea value={String(actionDraft.payload.content ?? '')} onChange={(event) => setActionDraft({ ...actionDraft, payload: { ...actionDraft.payload, content: event.target.value } })} rows={4} className="mt-1 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-2.5 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]" /></label>}
            </div>
          ) : (
            <div className="mt-5 space-y-3">{actionReview?.actions.map((action) => <div key={action.id} className="flex items-start gap-2"><div className="min-w-0 flex-1"><label className="block text-xs text-[var(--ledger-text-muted)]">{actionLabel(action.type)}<input value={String(action.payload.title ?? '')} onChange={(event) => setActionReview((current) => current ? { ...current, actions: current.actions.map((item) => item.id === action.id ? { ...item, payload: { ...item.payload, title: event.target.value } } : item) } : current)} className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]" /></label>{action.type === 'create_task' && <div className="mt-1 grid grid-cols-2 gap-2"><select aria-label="Project" value={String(action.payload.project_id ?? '')} onChange={(event) => setActionReview((current) => current ? { ...current, actions: current.actions.map((item) => item.id === action.id ? { ...item, payload: { ...item.payload, project_id: event.target.value || null } } : item) } : current)} className="h-8 min-w-0 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[11px] text-[var(--ledger-text-secondary)]"><option value="">No project</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><input aria-label="Due date" type="date" value={String(action.payload.due_date ?? '')} onChange={(event) => setActionReview((current) => current ? { ...current, actions: current.actions.map((item) => item.id === action.id ? { ...item, payload: { ...item.payload, due_date: event.target.value || null } } : item) } : current)} className="h-8 min-w-0 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[11px] text-[var(--ledger-text-secondary)]" /></div>}</div><button type="button" aria-label={`Remove ${String(action.payload.title ?? actionLabel(action.type))}`} onClick={() => { rejectAction(action); setActionReview((current) => current ? { ...current, actions: current.actions.filter((item) => item.id !== action.id) } : current); }} className="mt-5 rounded p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">×</button></div>)}</div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => { setActionReview(null); setActionDraft(null); }} disabled={actionBusy} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-muted)]">Cancel</button>
            <button type="button" onClick={() => { if (!actionReview || !actionReview.actions.length) return; const actions = actionReview.actions.map((action) => actionDraft?.id === action.id ? actionDraft : action); void executeActionGroup(actions); }} disabled={actionBusy || !actionReview?.actions.length || Boolean(actionDraft?.type === 'create_reminder' && !actionDraft.payload.remind_at)} className="rounded-md bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{actionBusy ? 'Working…' : actionReview?.actions.length && actionReview.actions.length > 1 ? `Create ${actionReview.actions.length} tasks` : actionReview ? actionLabel(actionReview.actions[0].type) : 'Confirm'}</button>
          </div>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={Boolean(downloadTier && !downloadMinimized)}
        onClose={() => { if (downloadPhase === 'downloading') cancelOptionalDownload(); else if (downloadPhase !== 'preparing') setDownloadTier(null); }}
        closeOnBackdropClick={downloadPhase !== 'downloading' && downloadPhase !== 'preparing'}
        backdropBorderRadius="var(--window-radius)"
        backdropInset="0px"
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div ref={downloadModalRef} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">{downloadPhase === 'downloading' ? `Downloading ${downloadTier ? generationTierLabels[downloadTier] : 'model'}` : downloadPhase === 'preparing' ? `Preparing ${downloadTier ? generationTierLabels[downloadTier] : 'model'}` : downloadModelView?.installed ? `Use ${downloadTier ? generationTierLabels[downloadTier] : 'model'}` : `Download ${downloadTier ? generationTierLabels[downloadTier] : 'model'}`}</h2>
              {downloadPhase === 'confirm' && <><p className="mt-1 text-sm leading-6 text-[var(--ledger-text-secondary)]">{downloadTier ? generationTierDescriptions[downloadTier] : 'Improve local answer quality.'}</p>{downloadTier && tierWarningNeedsAcknowledgement(downloadTier) && <p className="mt-3 text-xs leading-5 text-[var(--ledger-text-muted)]">{tierWarning(downloadTier)}</p>}</>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {downloadPhase === 'downloading' && <button type="button" onClick={() => { setDownloadMinimized(true); advancedButtonRef.current?.focus(); }} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]" aria-label="Minimize model download"><Minimize2 size={14} /></button>}
              <ModalCloseButton onClick={() => { if (downloadPhase === 'downloading') cancelOptionalDownload(); else if (downloadPhase !== 'preparing') setDownloadTier(null); }} ariaLabel="Close model download" disabled={downloadPhase === 'preparing'} />
            </div>
          </div>
          {downloadPhase === 'error' ? (
            <div className="mt-5 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-3" role="alert"><p className="text-sm font-medium text-[var(--ledger-text-primary)]">Couldn’t download this model.</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">{downloadError ?? 'Try again later.'}</p></div>
          ) : downloadPhase === 'preparing' ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-[var(--ledger-text-secondary)]" aria-live="polite"><LoaderCircle size={15} className="animate-spin text-[var(--ledger-text-muted)]" /> Switching Local AI model…</div>
          ) : downloadPhase === 'downloading' ? (
            <div className="mt-5" aria-live="polite">
              <div className="flex items-center justify-between gap-4"><p className="text-sm font-medium text-[var(--ledger-text-primary)]">Downloading {downloadTier ? generationTierLabels[downloadTier] : 'model'}</p><span className="text-xs tabular-nums text-[var(--ledger-text-muted)]">{downloadModelView?.progressPercent ?? 0}%</span></div>
              <p className="mt-3 text-xs tabular-nums text-[var(--ledger-text-secondary)]">{formatDownloadedBytes(downloadModelView?.bytesDownloaded)} of {formatLocalAIBytes(downloadModelView?.totalBytes ?? downloadModelView?.expectedSize)}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)]" role="progressbar" aria-label={`Downloading ${downloadTier ? generationTierLabels[downloadTier] : 'model'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadModelView?.progressPercent ?? 0}><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300" style={{ width: `${Math.max(downloadModelView?.progressPercent ?? 1, 1)}%` }} /></div>
            </div>
          ) : (
            <>
              <div className="mt-5 space-y-2 text-xs"><div className="flex items-center justify-between gap-4"><span className="text-[var(--ledger-text-muted)]">Download size</span><span className="tabular-nums text-[var(--ledger-text-secondary)]">{formatLocalAIBytes(downloadModelView?.expectedSize, 'Unavailable')}</span></div><div className="flex items-center justify-between gap-4"><span className="text-[var(--ledger-text-muted)]">AI processing</span><span className="text-[var(--ledger-text-secondary)]">On this device</span></div></div>
            </>
          )}
          <div className="mt-6 flex justify-end gap-2">
            {downloadPhase === 'downloading' ? <button type="button" onClick={cancelOptionalDownload} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button> : downloadPhase === 'preparing' ? null : downloadPhase === 'error' ? <><button type="button" onClick={() => setDownloadTier(null)} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)]">Close</button><button ref={downloadPrimaryButtonRef} type="button" onClick={() => void startOptionalDownload()} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)]">Try again</button></> : <><button type="button" onClick={() => setDownloadTier(null)} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button ref={downloadPrimaryButtonRef} type="button" onClick={() => void startOptionalDownload()} disabled={!downloadModelView?.available} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)] disabled:opacity-50">{downloadModelView?.installed ? 'Use & continue' : 'Download & use'}</button></>}
          </div>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={setupModalOpen}
        onClose={closeSetupModal}
        backdropBorderRadius="var(--window-radius)"
        backdropInset="0px"
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[420px] overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">Set up Local AI</h2>
            </div>
            <ModalCloseButton onClick={closeSetupModal} ariaLabel="Close Local AI setup" disabled={localAISettingUp} />
          </div>

          {setupError ? (
            <div className="mt-5 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-3">
              <p className="text-sm font-medium text-[var(--ledger-text-primary)]">{setupError.title}</p>
              {setupError.detail && <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">{setupError.detail}</p>}
            </div>
          ) : localAISettingUp ? (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Setting up Local AI</p>
                {localAIVerifying ? <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ledger-text-muted)]"><LoaderCircle size={12} className="animate-spin" /> Verifying files…</span> : <span className="text-xs tabular-nums text-[var(--ledger-text-muted)]">{localAIProgress}%</span>}
              </div>
              {!localAIVerifying && <>
                <p className="mt-4 text-xs text-[var(--ledger-text-muted)]">Downloading models…</p>
                <p className="mt-1 text-xs tabular-nums text-[var(--ledger-text-secondary)]">{formatDownloadedBytes(localAIBytesDownloaded)} of {formatLocalAIBytes(localAITotalBytes)}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)]" role="progressbar" aria-label="Local AI setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={localAIProgress}><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-[width] duration-300" style={{ width: `${Math.max(localAIProgress, 1)}%` }} /></div>
              </>}
              <button type="button" onClick={() => { cancelLocalAISetup(); setSetupModalOpen(false); }} className="mt-4 text-xs text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]">Cancel</button>
            </div>
          ) : (
            <>
              <p className="mt-5 text-sm leading-6 text-[var(--ledger-text-secondary)]">AI processing runs on this device. A one-time download is required.</p>
              <div className="mt-5 space-y-2 text-xs"><div className="flex items-center justify-between gap-4"><span className="text-[var(--ledger-text-muted)]">Download</span><span className="tabular-nums text-[var(--ledger-text-secondary)]">{formatLocalAIBytes(localAITotalBytes)}</span></div><div className="flex items-center justify-between gap-4"><span className="text-[var(--ledger-text-muted)]">AI processing</span><span className="text-[var(--ledger-text-secondary)]">On this device</span></div></div>
              <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeSetupModal} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={startLocalAISetup} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)] transition hover:opacity-85">Set up</button></div>
            </>
          )}
          {setupError && <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeSetupModal} className="rounded-md px-3 py-2 text-xs text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={startLocalAISetup} className="rounded-md bg-[var(--ledger-text-primary)] px-3 py-2 text-xs font-medium text-[var(--ledger-surface)] transition hover:opacity-85">Try again</button></div>}
        </div>
      </ModalOverlay>

      {!conversationActive && (state.status === 'streaming' || state.status === 'answer') && (
        <section className="mt-10" aria-live="polite">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
            {displayedRequest}
          </p>
          {activitySteps.length ? <AskLedgerActivityTrace steps={activitySteps} durationMs={state.status === 'answer' ? activityDurationMs : liveActivityDurationMs} active={state.status !== 'answer'} expanded={activityExpanded} onToggle={() => setActivityExpanded((current) => !current)} generationPhrase={generationPhrase} /> : null}
          <p className={`mt-5 max-w-[620px] whitespace-pre-wrap text-[15px] leading-7 text-[var(--ledger-text-secondary)] ${!state.response.answer ? 'ledger-ask-generating' : ''}`}>
            {state.response.answer || generationPhrase}
          </p>
          {state.status === 'answer' && state.response.sources.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ledger-text-muted)]">
                Sources
              </p>
              <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                {state.response.sources.map((source) => {
                  const Icon = sourceIconMap[source.type];
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => openSource(source)}
                      className="flex min-h-10 w-full items-center gap-2.5 py-2 text-left transition hover:text-[var(--ledger-text-primary)]"
                    >
                      <Icon size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-secondary)]">
                        {source.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">
                        {sourceTypeLabels[source.type]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {!conversationActive && state.status === 'no-answer' && (
        <p
          className="mt-10 px-1 text-sm leading-6 text-[var(--ledger-text-muted)]"
          aria-live="polite"
        >
          I couldn’t find enough information in the provided Ledger context.
        </p>
      )}

      {!conversationActive && state.status === 'error' && (
        <p className="mt-10 px-1 text-sm leading-6 text-[var(--ledger-text-muted)]" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
};
