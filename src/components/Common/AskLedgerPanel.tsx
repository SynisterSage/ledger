import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  ListChecks,
  LoaderCircle,
  Mic,
  Send,
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
import type { AskLedgerAttachment } from '../../types/askLedgerAttachments';
import { ASK_LEDGER_SKILL_METADATA, isAskLedgerSkillId, type AskLedgerSkillId, type AskLedgerSkillMetadata } from '../../types/askLedgerSkills';
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
  | 'attachment';

export interface AskLedgerRequest {
  question: string;
  workspaceId?: string | null;
  skillId?: AskLedgerSkillId;
  explicitContext?: AskLedgerInitialContext;
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
  structured?: { skillId: AskLedgerSkillId; sections: Array<{ title: string; content: string }> };
  skillId?: AskLedgerSkillId;
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
  skillId?: AskLedgerSkillId;
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
};

export type AskLedgerState =
  | { status: 'idle' | 'focused' }
  | { status: 'submitting'; request: AskLedgerRequest }
  | { status: 'streaming'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'answer'; request: AskLedgerRequest; response: AskLedgerResponse }
  | { status: 'no-answer'; request: AskLedgerRequest }
  | { status: 'error'; request: AskLedgerRequest; message: string };

type LocalAISetupError = 'storage' | 'interrupted' | 'generic';

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
};

type AskLedgerStreamEvent = {
  type: 'start' | 'activity' | 'sources' | 'delta' | 'done' | 'error';
  requestId: string;
  activity?: { type: 'starting_runtime' | 'searching' | 'sources_found' | 'reading_context' | 'preparing_answer' | 'generating'; count?: number; sources?: Array<Record<string, unknown>> };
  text?: string;
  sources?: Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
  skillResult?: {
    skillId: string;
    sections?: Array<{ title: string; content: string }>;
    actionProposals?: Array<{ id: string; type: AskLedgerActionType; payload: Record<string, unknown>; sourceMessageId?: string }>;
  };
};

const askLedgerDocumentScope = (question: string) => {
  const value = question.toLowerCase().replace(/[’']/g, '').trim();
  if (/\b(my team|team members|members of (the )?team|who.*team)\b/.test(value)) return 'team_members';
  if (/\b(deadline|deadlines|deadliens|due date|due dates)\b/.test(value)) return 'deadlines';
  if (/\b(projects?|portfolio)\b/.test(value) && !/\b(discuss|discussed|decide|decided|mention|mentioned|say|said)\b/.test(value)) return 'projects';
  if (/\b(reminders?|remind me)\b/.test(value)) return 'reminders';
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
  const match = question.match(/\b(?:for|in|of)\s+(?:the\s+)?([^?]+?)(?:\?|$)/i);
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

const localAIErrorMessage = (code?: string) => {
  if (code === 'model_missing' || code === 'llama_unavailable')
    return 'Local AI is unavailable right now. Try again.';
  if (code === 'cancelled') return 'Generation cancelled.';
  if (code === 'runtime_start_failed' || code === 'runtime_exited') return 'Local AI could not start. Try again.';
  if (code === 'request_timeout') return 'Local AI took too long to respond. Try again.';
  if (code === 'retrieval_failed') return "Couldn't search your workspace. Try again.";
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
  return 'Generating…';
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
  if (skill.supportedContextTypes.includes('project')) return 'Requires a project';
  if (skill.supportedContextTypes.includes('note')) return 'Requires a note';
  return 'Requires a meeting context';
};

const normalizeSkillMetadata = (value: unknown): AskLedgerSkillMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!isAskLedgerSkillId(item.id) || typeof item.name !== 'string' || typeof item.description !== 'string' || typeof item.icon !== 'string' || typeof item.requiresContext !== 'boolean' || !Array.isArray(item.supportedContextTypes) || !Array.isArray(item.allowedActions)) return null;
  return { id: item.id, name: item.name, description: item.description, icon: item.icon, requiresContext: item.requiresContext, supportedContextTypes: item.supportedContextTypes as AskLedgerSkillMetadata['supportedContextTypes'], allowedActions: item.allowedActions as AskLedgerSkillMetadata['allowedActions'] };
};

const newAskLedgerConversationId = () => `ask-ledger-${crypto.randomUUID()}`;

const attachmentKindLabel = (attachment: AskLedgerAttachment) => attachment.extension.toUpperCase();

const attachmentDisplayName = (name: string) => name.length > 28 ? `${name.slice(0, 24)}…${name.slice(name.lastIndexOf('.') || name.length)}` : name;

export const AskLedgerPanel = ({ workspaceId, resetKey, initialSession, initialContext, skillId, onConversationChange, onSessionTitleChange, onSessionPersisted }: { workspaceId?: string | null; resetKey?: number; initialSession?: AskLedgerSession | null; initialContext?: AskLedgerInitialContext | null; skillId?: AskLedgerSkillId; onConversationChange?: (active: boolean) => void; onSessionTitleChange?: (title: string) => void; onSessionPersisted?: () => void }) => {
  const api = useApi();
  const platform = usePlatform();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestMessageRef = useRef<HTMLElement | null>(null);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskLedgerState>({ status: 'idle' });
  const [activity, setActivity] = useState<AskLedgerStreamEvent['activity'] | null>(null);
  const [messages, setMessages] = useState<AskLedgerMessage[]>([]);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeInitialContext, setActiveInitialContext] = useState<AskLedgerInitialContext | null>(initialContext ?? null);
  const [actionReview, setActionReview] = useState<{ actions: AskLedgerActionProposal[]; title: string } | null>(null);
  const [actionDraft, setActionDraft] = useState<AskLedgerActionProposal | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const actionBusyRef = useRef(false);
  const [localAIStatus, setLocalAIStatus] = useState<{
    generation?: {
      installed?: boolean;
      downloading?: boolean;
      bytesDownloaded?: number;
      expectedSize?: number;
      error?: string | null;
    };
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
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<AskLedgerSkillId | null>(skillId ?? null);
  const [skillCatalog, setSkillCatalog] = useState<AskLedgerSkillMetadata[]>(ASK_LEDGER_SKILL_METADATA);
  const setupCancelRequestedRef = useRef(false);
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestIdRef = useRef(0);
  const messageIdRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const sourceItemsRef = useRef<AskLedgerSource[]>([]);
  const conversationRef = useRef<AskLedgerConversationContext | null>(null);
  const recentTurnsRef = useRef<AskLedgerConversationTurn[]>([]);
  const requestInitializingRef = useRef(false);
  const messagesRef = useRef<AskLedgerMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef(initialSession?.id ?? newAskLedgerConversationId());
  const sessionTitleRef = useRef('Ask Ledger');
  const sessionSkillIdRef = useRef<AskLedgerSkillId | undefined>(initialSession?.skillId ?? skillId);
  const pendingSkillIdRef = useRef<AskLedgerSkillId | undefined>(skillId);
  const initialContextRef = useRef<AskLedgerInitialContext | null>(initialContext ?? null);
  const sessionSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const questionRef = useRef(question);
  const workspaceIdRef = useRef(workspaceId);
  questionRef.current = question;
  workspaceIdRef.current = workspaceId;

  const conversationActive = messages.length > 0;
  const selectedSkill = selectedSkillId ? skillCatalog.find((skill) => skill.id === selectedSkillId) : undefined;

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
      if (normalized.length) setSkillCatalog(normalized);
    }).catch(() => {
      // Keep the shared safe metadata fallback available in the browser/runtime.
    });
  }, []);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!skillPickerRef.current?.contains(event.target as Node)) setSkillPickerOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [skillPickerOpen]);

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
    sessionSkillIdRef.current = skillId;
    pendingSkillIdRef.current = skillId;
    setSelectedSkillId(skillId ?? null);
    setSkillPickerOpen(false);
    sessionTitleRef.current = 'Ask Ledger';
    onSessionTitleChange?.('Ask Ledger');
    sourceItemsRef.current = [];
    setQuestion('');
    setActivity(null);
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
    conversationRef.current = lastTurn
      ? { id: conversationIdRef.current, previousQuestion: lastTurn.question, previousAnswer: lastTurn.answer, previousSources: lastTurn.sources, recentExchanges: recentTurnsRef.current, initialContext: initialContextRef.current ?? undefined }
      : null;
    onSessionTitleChange?.(sessionTitleRef.current);
    setQuestion('');
    setActivity(null);
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
        if (!isAskLedgerStreamEvent(value) || value.requestId !== activeRequestIdRef.current)
          return;
        if (value.type === 'activity') {
          setActivity(value.activity ?? null);
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
                    updatedAt: source.updatedAt ? String(source.updatedAt) : undefined,
                    attachmentSource: source.attachmentSource as AskLedgerSource['attachmentSource'],
                  }
                : null;
            })
            .filter(Boolean) as AskLedgerSource[];
          return;
        }
        if (value.type === 'delta' && typeof value.text === 'string') {
          setActivity(null);
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
        if (value.type === 'done') {
          setActivity(null);
          setState((current) => {
            if (current.status !== 'streaming') return current;
            const isAbstention =
              /(?:couldn['’]t find enough information|don't have enough Ledger context)/i.test(
                current.response.answer
              );
            const answer = isAbstention || !current.response.answer.trim()
              ? "I don't have enough Ledger context to answer that."
              : current.response.answer;
            const assistantMessage: AskLedgerMessage = {
              id: `ask-${++messageIdRef.current}`,
              role: 'assistant',
              content: answer,
              createdAt: new Date().toISOString(),
              sources: current.response.sources,
              ...(value.skillResult?.sections?.length && value.skillResult.skillId ? { structured: { skillId: value.skillResult.skillId as AskLedgerSkillId, sections: value.skillResult.sections } } : {}),
            };
            const previousTurn = recentTurnsRef.current[recentTurnsRef.current.length - 1];
            const skillDefinition = value.skillResult?.skillId ? skillCatalog.find((skill) => skill.id === value.skillResult?.skillId) : undefined;
            const proposedActions = value.skillResult?.actionProposals?.filter((action) => skillDefinition?.allowedActions.includes(action.type)).map((action, index) => ({
              id: `${assistantMessage.id}-skill-action-${index}`,
              type: action.type,
              payload: action.payload,
              sourceMessageId: assistantMessage.id,
              status: 'pending' as const,
            })) ?? proposeAskLedgerActions({
              question: current.request.question,
              answer,
              previousAnswer: previousTurn?.answer,
              initialContext: initialContextRef.current,
              sourceMessageId: assistantMessage.id,
            });
            if (proposedActions.length) assistantMessage.actions = proposedActions;
            const nextMessages = [...messagesRef.current, assistantMessage];
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
            queueSessionSave(nextMessages);
            const completedTurn: AskLedgerConversationTurn = {
              question: current.request.question,
              answer,
              sources: current.response.sources,
            };
            recentTurnsRef.current = [...recentTurnsRef.current, completedTurn].slice(-2);
            conversationRef.current = {
              id: conversationIdRef.current,
              previousQuestion: current.request.question,
              previousAnswer: answer,
              previousSources: current.response.sources,
              recentExchanges: recentTurnsRef.current,
              initialContext: initialContextRef.current ?? undefined,
            };
            if (isAbstention || !current.response.answer.trim())
              return { status: 'no-answer', request: current.request };
            return { ...current, status: 'answer' };
          });
          activeRequestIdRef.current = null;
          return;
        }
        if (value.type === 'error') {
          setActivity(null);
          setState((current) => {
            const request =
              current.status === 'streaming' || current.status === 'submitting'
                ? current.request
                : { question: questionRef.current.trim(), workspaceId: workspaceIdRef.current };
            return { status: 'error', request, message: localAIErrorMessage(value.error?.code) };
          });
          activeRequestIdRef.current = null;
        }
      }) ?? (() => undefined);
    return () => {
      requestIdRef.current += 1;
      if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window.askLedger?.localAIStatus) return;
    void window.askLedger
      .localAIStatus()
      .then((value) => setLocalAIStatus(value as typeof localAIStatus));
    return window.askLedger.onLocalAIStatus((value) =>
      setLocalAIStatus(value as typeof localAIStatus)
    );
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
    const trimmedQuestion = (questionOverride ?? question).trim();
    const selectedSkillForRequest = pendingSkillIdRef.current;
    if ((!trimmedQuestion && !selectedSkillForRequest) || !localAIReady || requestInitializingRef.current || activeRequestIdRef.current) return;

    const effectiveQuestion = trimmedQuestion;

    const request: AskLedgerRequest = { question: effectiveQuestion, workspaceId, skillId: selectedSkillForRequest, explicitContext: initialContextRef.current ?? undefined };
    pendingSkillIdRef.current = undefined;
    setSelectedSkillId(null);
    setSkillPickerOpen(false);
    const requestId = ++requestIdRef.current;
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
        id: `ask-${++messageIdRef.current}`,
        role: 'user',
        content: trimmedQuestion,
        createdAt: new Date().toISOString(),
        skillId: selectedSkillForRequest,
      };
      nextMessages = [...messagesRef.current, userMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      queueSessionSave(nextMessages, nextTitle);
    }
    setQuestion('');
    setActivity(null);
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
    void Promise.all([
      api.getAskLedgerDocuments(workspaceId, { scope: askLedgerDocumentScope(effectiveQuestion), ...askLedgerDateWindow(effectiveQuestion), openOnly: /\b(open|todo|to-do|to do|need to do)\b/i.test(effectiveQuestion), project: askLedgerProjectReference(effectiveQuestion), taskHorizon: askLedgerTaskHorizon(effectiveQuestion), assignedToMe: askLedgerAssignedToMe(effectiveQuestion, askLedgerDocumentScope(effectiveQuestion)) }) as Promise<{
        workspaceId?: string;
        documents?: Array<Record<string, unknown>>;
      }>,
      effectiveQuestion ? api.searchWorkspace(workspaceId, effectiveQuestion) as Promise<Array<Record<string, unknown>>> : Promise.resolve([]),
    ])
      .then(([documentPayload, lexicalResults]) => {
        const documents: Array<Record<string, unknown>> = [...(documentPayload.documents ?? [])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.resourceType === item.resourceType && candidate.resourceId === item.resourceId) === index)
          .map(
          (item) => ({ ...item, workspaceId })
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
        return window.askLedger!.start({
          question: effectiveQuestion,
          workspaceId,
          documents,
          lexicalResults,
          conversation: conversationRef.current ?? { id: conversationIdRef.current, previousQuestion: '', previousAnswer: '', previousSources: [], recentExchanges: [] },
          skillId: request.skillId,
          explicitContext: request.explicitContext,
        });
      })
      .then(({ requestId: localRequestId }) => {
        requestInitializingRef.current = false;
        if (requestId !== requestIdRef.current) return;
        activeRequestIdRef.current = localRequestId;
      })
      .catch(() => {
        requestInitializingRef.current = false;
        if (requestId === requestIdRef.current)
          setState({ status: 'error', request, message: localAIErrorMessage() });
      });
  };

  const cancel = () => {
    if (!activeRequestIdRef.current && !requestInitializingRef.current) return;
    requestIdRef.current += 1;
    if (activeRequestIdRef.current) void window.askLedger?.cancel(activeRequestIdRef.current);
    activeRequestIdRef.current = null;
    requestInitializingRef.current = false;
    if (state.status === 'streaming' && state.response.answer.trim()) {
      const interruptedMessage: AskLedgerMessage = {
        id: `ask-${++messageIdRef.current}`,
        role: 'assistant',
        content: `${state.response.answer}\n\nGeneration stopped before it finished.`,
        createdAt: new Date().toISOString(),
        sources: state.response.sources,
        interrupted: true,
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
    <div className={conversationActive ? 'flex min-h-[calc(100vh-160px)] flex-col' : 'mt-5'}>
      {conversationActive && (
        <section className="order-1 min-h-0 flex-1 space-y-10 pb-32 pt-8" aria-live="polite">
          {messages.map((message, messageIndex) => (
            <article key={message.id} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} className={message.role === 'user' ? 'flex justify-end' : 'group max-w-[640px]'}>
              {message.role === 'user' ? (
                <div className="flex max-w-[78%] flex-col items-end gap-1">
                  {message.skillId && <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ledger-text-muted)]"><Boxes size={12} />{skillCatalog.find((skill) => skill.id === message.skillId)?.name}</span>}
                  {message.attachments?.length ? <div className="flex max-w-full flex-wrap justify-end gap-1.5">{message.attachments.map((attachment, index) => attachment.kind === 'file' ? <button key={`${message.id}-file-${attachment.attachment.id}`} type="button" onClick={() => void window.askLedger?.openAttachment(attachment.attachment.id)} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]" aria-label={`Open ${attachment.attachment.name}`}><FileText size={12} className="shrink-0 text-[var(--ledger-text-muted)]" /><span className="shrink-0 text-[10px] text-[var(--ledger-text-muted)]">{attachmentKindLabel(attachment.attachment)}</span><span className="truncate">{attachmentDisplayName(attachment.attachment.name)}</span></button> : <button key={`${message.id}-resource-${index}`} type="button" onClick={() => openSource(attachment.resource)} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 py-1 text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]" aria-label={`Open ${attachment.resource.title}`}><span className="truncate">{attachment.resource.title}</span></button>)}</div> : null}
                  {message.content && <p className="w-fit rounded-lg bg-[var(--ledger-surface-hover)] px-3 py-2 text-sm leading-6 text-[var(--ledger-text-primary)]">{message.content}</p>}
                </div>
              ) : (
                <div>
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
                    <div className="mt-6">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ledger-text-muted)]">Sources · {message.sources.length}</p>
                      <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                        {(expandedSources[message.id] ? message.sources : message.sources.slice(0, 3)).map((source) => {
                          const Icon = sourceIconMap[source.type];
                          return <button key={source.id} type="button" onClick={() => openSource(source)} className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-1 py-2 text-left transition hover:bg-[var(--ledger-surface-hover)]"><Icon size={14} className="shrink-0 text-[var(--ledger-text-muted)]" /><span className="min-w-0 flex-1 truncate text-sm text-[var(--ledger-text-secondary)]">{source.title}</span><span className="shrink-0 text-[11px] text-[var(--ledger-text-muted)]">{source.sourceLabel ?? sourceTypeLabels[source.type]}</span></button>;
                        })}
                      </div>
                      {message.sources.length > 3 && <button type="button" onClick={() => setExpandedSources((current) => ({ ...current, [message.id]: !current[message.id] }))} className="mt-2 text-xs text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]">{expandedSources[message.id] ? 'Show less' : `Show all · ${message.sources.length}`}</button>}
                    </div>
                  )}
                  <div className="mt-4 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => void copyAnswer(message)} className="text-xs text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]">{copiedMessageId === message.id ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
              )}
            </article>
          ))}
          {(state.status === 'submitting' || state.status === 'streaming') && (
            <article className="max-w-[640px]">
              {state.request.skillId && <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--ledger-text-muted)]"><Boxes size={13} />{skillCatalog.find((skill) => skill.id === state.request.skillId)?.name}</div>}
              {state.status === 'streaming' && state.response.answer ? <div className="space-y-4 text-[15px] leading-7 text-[var(--ledger-text-secondary)]">{renderAnswerContent(state.response.answer)}</div> : <p className="text-sm text-[var(--ledger-text-muted)]">{askLedgerActivityLabel(activity ?? undefined) || 'Searching your workspace…'}</p>}
            </article>
          )}
          {state.status === 'error' && <article className="max-w-[640px] text-sm text-[var(--ledger-text-muted)]" role="alert"><p>Ledger couldn’t answer this question.</p><button type="button" onClick={retryLastQuestion} className="mt-2 text-xs text-[var(--ledger-text-primary)] underline-offset-2 hover:underline">Try again</button></article>}
        </section>
      )}
      {activeInitialContext && (
        <div className="mb-2 flex items-center gap-2 px-1 text-xs text-[var(--ledger-text-muted)]">
          <span>Context</span>
          <span className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-[var(--ledger-surface-muted)] px-2 py-1 text-[var(--ledger-text-secondary)]">
            <span className="truncate">{activeInitialContext.title}</span>
            <button type="button" onClick={removeInitialContext} aria-label="Remove Ask Ledger context" className="rounded p-0.5 hover:bg-[var(--ledger-surface-hover)]">×</button>
          </span>
        </div>
      )}
      <div
        ref={skillPickerRef}
        className={`${conversationActive ? 'order-2 sticky bottom-4 z-10 mt-auto min-h-[104px]' : 'min-h-[124px]'} relative flex w-full flex-col rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-4 py-3 shadow-[0_4px_18px_rgba(17,24,39,0.04)] transition focus-within:border-[color:var(--ledger-border-strong)] ${localAIUnavailable ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (localAIUnavailable) setSetupModalOpen(true);
        }}
      >
        {selectedSkill && (
          <div className="mb-2 flex items-center">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ledger-surface-hover)] px-2 py-1 text-xs text-[var(--ledger-text-secondary)]">
              <Boxes size={12} className="text-[var(--ledger-text-muted)]" />
              <span>{selectedSkill.name}</span>
              <button
                type="button"
                aria-label={`Remove ${selectedSkill.name}`}
                onClick={(event) => { event.stopPropagation(); setSelectedSkillId(null); pendingSkillIdRef.current = undefined; sessionSkillIdRef.current = undefined; inputRef.current?.focus(); }}
                className="ml-0.5 rounded p-0.5 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface)] hover:text-[var(--ledger-text-primary)]"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={question}
          readOnly={!localAIReady}
          onChange={(event) => {
            if (!localAIReady) return;
            setQuestion(event.target.value);
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
          className={`max-h-32 ${conversationActive ? 'min-h-[44px]' : 'min-h-[68px]'} min-w-0 flex-1 resize-none self-stretch bg-transparent text-sm leading-6 placeholder:text-[var(--ledger-placeholder)] focus:outline-none ${localAIUnavailable ? 'cursor-pointer text-[var(--ledger-text-secondary)]' : 'text-[var(--ledger-text-primary)]'}`}
        />
        {localAIUnavailable && <span id="ask-ledger-setup-help" className="sr-only">Set up Local AI to ask your workspace.</span>}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="relative">
            <button
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
            {skillPickerOpen && (
              <div
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
                className="absolute bottom-9 left-0 z-30 w-[280px] overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]"
              >
                {skillCatalog.map((skill, index) => {
                  const Icon = skillIconMap[skill.icon as keyof typeof skillIconMap] ?? Boxes;
                  const requirement = skillRequirementLabel(skill);
                  const available = !skill.requiresContext
                    || Boolean(activeInitialContext && skill.supportedContextTypes.includes(activeInitialContext.resourceType));
                  const reason = available ? null : activeInitialContext ? requirement : requirement;
                  return (
                    <button
                      key={skill.id}
                      ref={(element) => { skillOptionRefs.current[index] = element; }}
                      type="button"
                      role="option"
                      aria-selected={selectedSkillId === skill.id}
                      aria-disabled={!available}
                      disabled={!available}
                      onClick={() => { setSelectedSkillId(skill.id); pendingSkillIdRef.current = skill.id; sessionSkillIdRef.current = skill.id; setSkillPickerOpen(false); inputRef.current?.focus(); }}
                      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition enabled:hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[var(--ledger-text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[var(--ledger-text-primary)]">{skill.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--ledger-text-muted)]">{reason ?? skill.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {localAIUnavailable && (
              <button type="button" onClick={(event) => { event.stopPropagation(); setSetupModalOpen(true); }} aria-label="Set up Local AI" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><AlertCircle size={15} /></button>
            )}
            <button type="button" onClick={() => submit()} disabled={(!question.trim() && !selectedSkillId) || !localAIReady || isSubmitting} aria-label="Submit question" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)] disabled:opacity-35">
              {isSubmitting ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
            {isSubmitting && <button type="button" onClick={cancel} aria-label="Cancel generation" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><Square size={12} /></button>}
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

      {!conversationActive && (state.status === 'submitting' || (state.status === 'streaming' && activity)) && activity && (
        <div className="mt-8 px-1 text-sm text-[var(--ledger-text-muted)]" aria-live="polite">
          <p>{askLedgerActivityLabel(activity)}</p>
          {(activity.type === 'sources_found' || activity.type === 'reading_context') && activity.sources?.length ? (
            <div className="mt-2 flex max-w-[620px] flex-wrap gap-x-4 gap-y-1.5">
              {activity.sources.map((source) => {
                const type = sourceType(source.resourceType);
                return (
                  <span key={`${String(source.resourceType)}:${String(source.resourceId)}`} className="inline-flex max-w-[190px] items-center gap-1.5 truncate text-xs text-[var(--ledger-text-secondary)]">
                    {type && (() => { const Icon = sourceIconMap[type]; return <Icon size={13} className="shrink-0 text-[var(--ledger-text-muted)]" />; })()}
                    <span className="truncate">{String(source.title ?? 'Untitled')}</span>
                  </span>
                );
              })}
              {(activity.count ?? 0) > (activity.sources?.length ?? 0) && <span className="text-xs text-[var(--ledger-text-muted)]">+{(activity.count ?? 0) - (activity.sources?.length ?? 0)} more</span>}
            </div>
          ) : null}
        </div>
      )}

      {!conversationActive && (state.status === 'streaming' || state.status === 'answer') && (
        <section className="mt-10" aria-live="polite">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
            {displayedRequest}
          </p>
          <p className="mt-5 max-w-[620px] whitespace-pre-wrap text-[15px] leading-7 text-[var(--ledger-text-secondary)]">
            {state.response.answer || 'Generating…'}
          </p>
          {state.status === 'answer' && (
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
