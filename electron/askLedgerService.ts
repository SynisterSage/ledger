import { randomUUID } from 'node:crypto';
import { buildAskLedgerPrompt, buildAskLedgerRepairPrompt } from './askLedgerPrompt.ts';
import { ASK_LEDGER_ABSTENTION } from './askLedgerPrompt.ts';
import { LedgerContextBuilder } from './askLedgerContext.ts';
import { LocalAIError, LocalAIService, type LocalAIStreamEvent } from './localAIService.ts';
import {
  EmbeddingIndexService,
  LedgerRetrievalService,
  LocalEmbeddingProvider,
  type LexicalCandidate,
} from './ledgerRetrievalService.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerSource } from '../src/types/askLedgerContext.ts';
import type { LocalAIAssetManager } from './localAIAssets.ts';
import { detectAskLedgerQueryIntent } from './askLedgerQueryIntent.ts';
import type { AskLedgerInitialContext } from '../src/types/askLedgerContext.ts';
import type { AskLedgerConversationState } from '../src/types/askLedgerConversationState.ts';
import { resolveAskLedgerConversation } from '../src/types/askLedgerConversationState.ts';
import { buildAskLedgerDocumentDiagnostics } from '../src/types/askLedgerResourceContract.ts';
import { buildSkillPromptContext, getAskLedgerSkill, validateSkillContext } from './askLedgerSkills.ts';
import type { AskLedgerSkillDefinition, AskLedgerSkillId } from '../src/types/askLedgerSkills.ts';
import { routeAskLedgerMessage } from '../src/types/askLedgerResponseMode.ts';
import { ASK_LEDGER_CAPABILITY_DESCRIPTION, ASK_LEDGER_CREATOR_DESCRIPTION, ASK_LEDGER_PRODUCT_DESCRIPTION, isLedgerCreatorQuestion, isLedgerProductQuestion } from '../src/types/askLedgerCapabilities.ts';
import { AskLedgerAttachmentService, attachmentBlocksToContext } from './askLedgerAttachmentService.ts';
import { buildRetrievalPlan } from './askLedgerRetrievalPlan.ts';
import { AskLedgerRetrievalOrchestrator } from './askLedgerRetrievalOrchestrator.ts';
import { compileAskLedgerEvidence } from './askLedgerEvidencePipeline.ts';
import { inferAskLedgerGenerationDepth } from '../src/types/askLedgerGenerationDepth.ts';
import { AskLedgerAnswerValidator, formatAskLedgerEvidenceLimitations, formatAskLedgerValidationFailures } from './askLedgerAnswerValidator.ts';
import os from 'node:os';
import path from 'node:path';
import { AskLedgerPerformanceTrace, performanceWarning } from './askLedgerPerformance.ts';
import { fastPathSource, resolveAskLedgerFastPath } from './askLedgerFastPath.ts';
import { diagnoseAskLedgerStructuredOutput, structuredValueLinesFor } from './askLedgerStructuredValues.ts';
import { sanitizeAskLedgerOutput, type AskLedgerOutputMapping } from '../src/types/askLedgerOutputGuard.ts';
import { formatAskLedgerProductHelp, formatAskLedgerProductOverview, productKnowledgeNodeIds, selectAskLedgerProductKnowledge, type AskLedgerProductKnowledgeSelection } from '../src/types/askLedgerProductKnowledge.ts';

const structuredAnswerFor = new Set(['team_members', 'projects', 'tasks', 'milestones', 'reminders', 'events', 'open_actions', 'deadlines', 'time_window', 'integration']);
const askLedgerDiagnostic = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') console.info(...args);
};

const formatLedgerDate = (value?: string, timeZone?: string) => {
  if (!value) return undefined;
  const item: AskLedgerContextItem = { resourceType: 'event', resourceId: 'display-date', title: 'Display date', content: '', ...(value.includes('T') ? { timestamp: value } : { dueAt: value }) };
  const display = structuredValueLinesFor(item, { timeZone }).display;
  return value.includes('T') ? display.displayTimestamp : display.displayDueDate;
};

const outputMappingsFor = (items: AskLedgerContextItem[], timeZone?: string, timeFormat?: '12h' | '24h'): AskLedgerOutputMapping[] => items.flatMap((item) => {
  const display = structuredValueLinesFor(item, { timeZone, timeFormat }).display;
  const mappings: AskLedgerOutputMapping[] = [];
  const add = (raw: string | undefined, value: string | undefined, anchor?: string) => {
    if (raw && value) mappings.push({ raw, display: value, kind: 'structured_value', ...(anchor ? { anchor } : {}) });
  };
  add(item.dueAt, display.displayDueDate);
  const dueDateOnly = item.dueAt?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dueDateOnly) {
    const [year, month, day] = dueDateOnly.slice(1);
    add(`${year}-${Number(month)}-${Number(day)}`, display.displayDueDate);
    add(`${year}-d-m`, display.displayDueDate, item.title);
    add(`${year}-m-d`, display.displayDueDate, item.title);
    add('YYYY-MM-DD', display.displayDueDate, item.title);
  }
  add(item.timestamp, display.displayTimestamp);
  add(item.endAt, display.displayEndAt);
  add(item.updatedAt, display.displayUpdatedAt);
  add(item.createdAt, display.displayCreatedAt);
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(item.resourceId)) mappings.push({ raw: item.resourceId, display: item.title, kind: 'resource_id' });
  return mappings;
});

const structuredGroupLabel = (resourceType: string) => ({
  project: 'Projects',
  task: 'Tasks',
  milestone: 'Milestones',
  reminder: 'Reminders',
  event: 'Events',
  person: 'People',
  team: 'Teams',
  note: 'Notes',
  transcript: 'Transcripts',
}[resourceType] ?? 'Resources');

const formatStructuredAnswer = (kind: string, items: AskLedgerContextItem[], timeZone?: string) => {
  const lines: string[] = [];
  const title = kind === 'team_members' ? 'Team members' : kind === 'projects' ? 'Projects' : kind === 'milestones' ? 'Milestones' : kind === 'events' ? 'Events' : kind === 'reminders' ? 'Reminders' : kind === 'deadlines' ? 'Deadlines' : kind === 'time_window' ? 'This week' : kind === 'integration' ? 'Integration context' : 'Open actions';
  lines.push(`${title}:`);
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const details = [
      ...structuredValueLinesFor(item, { timeZone }).lines,
      item.taskHorizon ? `Horizon ${item.taskHorizon === 'long_term' ? 'long term' : item.taskHorizon}` : undefined,
      item.projectName,
    ].filter(Boolean);
    const group = structuredGroupLabel(item.resourceType);
    if (!lines.includes(group)) lines.push(`\n${group}`);
    lines.push(`- ${item.title}${details.length ? ` — ${details.join(' · ')}` : ''}`);
  }
  return lines.join('\n');
};

const emptyStructuredAnswer = (kind: string) => {
  const label = kind === 'team_members' ? 'team members' : kind === 'projects' ? 'projects' : kind === 'milestones' ? 'milestones' : kind === 'events' ? 'events' : kind === 'reminders' ? 'reminders' : kind === 'deadlines' ? 'deadlines' : kind === 'time_window' ? 'dated items' : kind === 'integration' ? 'integration records' : 'open actions';
  return `I couldn't find any matching ${label} in this workspace.`;
};

const isTeamWorkloadQuestion = (question: string) => /\b(?:teamspaces?|teams?|circle)\b/i.test(question)
  && /\b(?:people|persons?|anyone|members?|tasks?|actions?|workload|active|open|what .* have)\b/i.test(question);

const formatTeamWorkloadAnswer = (items: AskLedgerContextItem[], timeZone?: string) => {
  const unique = [...new Map(items.map((item) => [`${item.resourceType}:${item.resourceId}`, item])).values()];
  const teams = unique.filter((item) => item.resourceType === 'team');
  const people = unique.filter((item) => item.resourceType === 'person');
  const work = unique
    .filter((item) => ['task', 'milestone', 'reminder'].includes(item.resourceType))
    .filter((item) => !['completed', 'complete', 'done', 'cancelled', 'canceled', 'dismissed'].includes(String(item.status ?? '').toLowerCase()))
    .sort((left, right) => {
      const leftDate = Date.parse(left.dueAt ?? left.updatedAt ?? left.createdAt ?? '') || Number.MAX_SAFE_INTEGER;
      const rightDate = Date.parse(right.dueAt ?? right.updatedAt ?? right.createdAt ?? '') || Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    })
    .slice(0, 8);
  const lines = ['## Teamspaces'];
  if (teams.length) {
    teams.forEach((team) => {
      const memberNames = people
        .filter((person) => person.relationships?.some((relationship) => relationship.resourceType === 'team' && relationship.resourceId === team.resourceId) || person.content.toLowerCase().includes(team.title.toLowerCase()))
        .map((person) => person.title);
      lines.push(`- **${team.title}**${memberNames.length ? ` — ${memberNames.join(', ')}` : ''}`);
    });
  } else lines.push('- No active teamspaces were found.');
  lines.push('', '## Recent open work');
  if (work.length) {
    work.forEach((item) => {
      const details = [
        item.resourceType === 'task' ? 'Task' : item.resourceType === 'milestone' ? 'Milestone' : 'Reminder',
        item.projectName,
        item.dueAt ? `Due ${formatLedgerDate(item.dueAt, timeZone)}` : undefined,
      ].filter(Boolean);
      lines.push(`- **${item.title}**${details.length ? ` — ${details.join(' · ')}` : ''}`);
    });
  } else lines.push('- No linked open tasks, milestones, or reminders were found.');
  return lines.join('\n');
};

const overviewFocusHandoff = (context?: AskLedgerInitialContext) => context?.handoff?.kind === 'overview_focus' ? context.handoff : undefined;
const overviewFocusHandoffText = (context?: AskLedgerInitialContext) => {
  const handoff = overviewFocusHandoff(context);
  if (!handoff) return '';
  const insights = handoff.insights.map((insight) => `- ${insight.title}: ${insight.summary}`).join('\n');
  const resources = handoff.resourceRefs.map((resource) => `${resource.resourceType}:${resource.resourceId} (${resource.title})`).join(', ');
  return `Overview Focus handoff for ${handoff.overviewDate}.\nSurfaced insights:\n${insights || '- none'}\nRelated Ledger resources: ${resources || 'none'}`;
};

const formatPlanMyWeekFallback = (items: AskLedgerContextItem[], timeZone?: string) => {
  const uniqueItems = [...new Map(items.map((item) => [`${item.resourceType}:${item.resourceId}`, item])).values()];
  const actionable = uniqueItems.filter((item) => ['task', 'milestone', 'reminder', 'event'].includes(item.resourceType));
  const dated = actionable.filter((item) => item.dueAt || item.timestamp).slice(0, 6);
  const blocked = actionable.filter((item) => /blocked|stuck|overdue|urgent|at risk/i.test(`${item.status ?? ''} ${item.content}`)).slice(0, 5);
  const focus = actionable.filter((item) => !['completed', 'complete', 'done', 'cancelled', 'canceled'].includes(String(item.status ?? '').toLowerCase())).slice(0, 5);
  const lines = [
    'Focus this week:',
    ...(focus.length ? focus.map((item) => `- ${item.title}${item.projectName ? ` · ${item.projectName}` : ''}`) : ['- No open work was supplied.']),
    '',
    'Deadlines and commitments:',
    ...(dated.length ? dated.map((item) => `- ${item.title} — ${item.dueAt ? `Due ${formatLedgerDate(item.dueAt, timeZone)}` : `At ${formatLedgerDate(item.timestamp, timeZone)}`}`) : ['- No dated commitments were supplied.']),
    '',
    'Risks or blockers:',
    ...(blocked.length ? blocked.map((item) => `- ${item.title}${item.status ? ` — ${item.status}` : ''}`) : ['- No explicit blockers were found in the supplied context.']),
    '',
    'Next steps:',
    ...(focus.slice(0, 3).map((item) => `- Start with ${item.title}.`)),
  ];
  return lines.join('\n');
};

const completePlanMyWeekSections = (answer: string, items: AskLedgerContextItem[]) => {
  if (!/next steps:\s*$/i.test(answer.trim())) return answer;
  const fallback = formatPlanMyWeekFallback(items);
  const fallbackNextSteps = fallback.match(/next steps:\s*([\s\S]*)$/i)?.[1]?.trim();
  return fallbackNextSteps ? `${answer.trim()}\n${fallbackNextSteps}` : answer;
};

const contextExcerpt = (value: string, maxLength = 260) => {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
};

const contextActionSentences = (items: AskLedgerContextItem[]) => {
  const actionPattern = /\b(?:action|follow[- ]?up|next step|need to|needs to|should|must|todo|to do|assign|send|review|confirm|finish|decide|decision|schedule|email|call|share|prepare)\b/i;
  return items
    .flatMap((item) => contextExcerpt(item.content, 900).split(/(?<=[.!?])\s+/).map((sentence) => ({ sentence: sentence.trim(), title: item.title })))
    .filter(({ sentence }) => sentence.length >= 20 && actionPattern.test(sentence))
    .map(({ sentence, title }) => `${sentence} (${title})`)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 5);
};

const completeTerminalSection = (answer: string, items: AskLedgerContextItem[]) => {
  const trimmed = answer.trim();
  const match = trimmed.match(/(?:^|\n)(?:\*\*)?([^*\n:]{2,48}):(?:\*\*)?\s*$/);
  if (!match) return trimmed;
  const section = match[1].trim().toLowerCase();
  if (!['next steps', 'action items', 'follow-ups', 'follow ups', 'recommended next step'].includes(section)) {
    return `${trimmed}\n- No additional supported details were provided.`;
  }
  const actions = contextActionSentences(items);
  const related = items.filter((item) => ['task', 'milestone', 'reminder'].includes(item.resourceType)).slice(0, 3).map((item) => item.title);
  const lines = actions.length ? actions.map((value) => `- ${value}`) : related.map((value) => `- Review ${value}.`);
  return lines.length ? `${trimmed}\n${lines.join('\n')}` : `${trimmed}\n- No explicit next step was supported by the supplied evidence.`;
};

const formatMeetingFollowUpFallback = (items: AskLedgerContextItem[], skillId: string) => {
  const anchor = items.find((item) => ['event', 'transcript', 'note'].includes(item.resourceType));
  const notes = items.filter((item) => ['note', 'transcript'].includes(item.resourceType));
  const actions = items.filter((item) => ['task', 'reminder', 'milestone'].includes(item.resourceType)).slice(0, 6);
  const noteSummaries = notes
    .map((item) => ({ title: item.title, excerpt: contextExcerpt(item.content) }))
    .filter((item) => item.excerpt)
    .slice(0, 3);
  const actionSentences = contextActionSentences(notes);
  const label = skillId === 'prepare_for_meeting' ? 'Meeting preparation' : 'Meeting follow-up';
  const lines = [
    `${label}: ${anchor?.title ?? 'Selected meeting'}`,
    '',
    noteSummaries.length
      ? `What the notes say:\n${noteSummaries.map((item) => `- ${item.title}: ${item.excerpt}`).join('\n')}`
      : 'What the notes say: No meeting note or transcript was linked.',
    '',
    actionSentences.length
      ? `Possible follow-ups from the notes:\n${actionSentences.map((sentence) => `- ${sentence}`).join('\n')}`
      : actions.length
        ? `Related Ledger work to confirm:\n${actions.map((item) => `- ${item.title}`).join('\n')}`
        : 'Follow-ups: No explicit tasks, reminders, or milestones were linked to this meeting.',
    '',
    notes.length || actions.length
      ? 'Recommended next step: Confirm the follow-ups above, then turn the confirmed items into tasks or reminders.'
      : 'Recommended next step: Add meeting notes or a transcript so Ledger can identify decisions and follow-ups.',
  ];
  return lines.join('\n');
};

const expandRelatedProjectContext = (items: AskLedgerContextItem[], documents: AskLedgerContextItem[]) => {
  const projectIds = new Set(
    items
      .map((item) => item.resourceType === 'project' ? item.resourceId : item.projectId)
      .filter((id): id is string => Boolean(id))
  );
  if (!projectIds.size) return items;
  const seen = new Set(items.map((item) => `${item.resourceType}:${item.resourceId}`));
  const related = documents.filter((item) => {
    if (!item.projectId || !projectIds.has(String(item.projectId))) return false;
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return ['project', 'milestone', 'task', 'note', 'event', 'reminder'].includes(item.resourceType);
  });
  return [...items, ...related].slice(0, 32);
};

const meetingContextTokens = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));

export const expandMeetingContext = (explicitItem: AskLedgerContextItem | undefined, candidates: AskLedgerContextItem[], documents: AskLedgerContextItem[], explicitContext?: AskLedgerInitialContext) => {
  if (!explicitItem) return candidates.slice(0, 10);
  const selected = new Map<string, AskLedgerContextItem>();
  const add = (item: AskLedgerContextItem | undefined) => {
    if (!item) return;
    selected.set(`${item.resourceType}:${item.resourceId}`, item);
  };
  add(explicitItem);

  const noteId = explicitItem.resourceType === 'event' || explicitItem.resourceType === 'transcript'
    ? explicitItem.parentResourceId
    : explicitItem.resourceType === 'note' ? explicitItem.resourceId : undefined;
  const projectId = explicitItem.projectId;
  const seriesId = explicitContext?.calendarSeriesId;
  const linkedProjectId = explicitContext?.linkedProjectId;
  const scopedDocuments = documents.filter((item) => !explicitContext?.workspaceId || !item.workspaceId || item.workspaceId === explicitContext.workspaceId);
  const seriesNoteIds = new Set(scopedDocuments.filter((item) => {
    const itemSeriesId = String(item.metadata?.calendarSeriesId ?? item.metadata?.calendar_series_id ?? item.metadata?.calendarSeriesKey ?? item.metadata?.calendar_series_key ?? '');
    return Boolean(seriesId && itemSeriesId === seriesId && item.resourceType === 'note');
  }).map((item) => item.resourceId));
  const titleTokens = meetingContextTokens(`${explicitItem.title} ${explicitItem.content}`);
  const titleRelated = (item: AskLedgerContextItem) => {
    const overlap = [...meetingContextTokens(`${item.title} ${item.content}`)].filter((token) => titleTokens.has(token));
    const distinctiveAnchorTokens = [...titleTokens].filter((token) => !['meeting', 'work', 'golf', 'call', 'event'].includes(token));
    return overlap.length >= 2 || overlap.some((token) => distinctiveAnchorTokens.includes(token));
  };

  // The selected meeting is the anchor. Pull its note/transcript first, then
  // work records that explicitly point to the same meeting or project.
  documents
    .filter((item) => {
      const itemSeriesId = String(item.metadata?.calendarSeriesId ?? item.metadata?.calendar_series_id ?? item.metadata?.calendarSeriesKey ?? item.metadata?.calendar_series_key ?? '');
      const sameSeries = Boolean(seriesId && itemSeriesId && itemSeriesId === seriesId);
      return (noteId && (item.resourceId === noteId || item.parentResourceId === noteId)) || (seriesNoteIds.has(item.parentResourceId ?? '') && item.resourceType === 'transcript') || (linkedProjectId && item.projectId === linkedProjectId && ['note', 'transcript'].includes(item.resourceType)) || (projectId && item.projectId === projectId && ['note', 'transcript'].includes(item.resourceType)) || sameSeries || (!seriesId && ['note', 'transcript'].includes(item.resourceType) && titleRelated(item));
    })
    .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
    .forEach(add);
  documents
    .filter((item) => ['task', 'reminder', 'milestone'].includes(item.resourceType))
    .filter((item) => {
      const itemSeriesId = String(item.metadata?.calendarSeriesId ?? item.metadata?.calendar_series_id ?? item.metadata?.calendarSeriesKey ?? item.metadata?.calendar_series_key ?? '');
      return (linkedProjectId && item.projectId === linkedProjectId) || (projectId && item.projectId === projectId) || (seriesId && itemSeriesId === seriesId) || (!seriesId && titleRelated(item)) || (explicitItem.title && `${item.provenance ?? ''} ${item.content}`.toLowerCase().includes(explicitItem.title.toLowerCase()));
    })
    .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
    .forEach(add);
  // If the event has no linked note or project, a few recent notes/tasks make
  // the absence of meeting history visible and still give the skill something
  // grounded to compare against instead of returning an empty-context error.
  return [...selected.values()].filter((item) => !explicitContext?.workspaceId || !item.workspaceId || item.workspaceId === explicitContext.workspaceId).slice(0, 16);
};

export type AskLedgerRetrievalRequest = {
  requestId?: string;
  workspaceId: string;
  question: string;
  documents: AskLedgerContextItem[];
  lexicalResults: LexicalCandidate[];
  skillId?: AskLedgerSkillId;
  skillDefinition?: AskLedgerSkillDefinition;
  explicitContext?: AskLedgerInitialContext;
  attachmentIds?: string[];
  reasoningMode?: 'off' | 'thinking';
  timeZone?: string;
  timeFormat?: '12h' | '24h';
  messageId?: string;
  conversation?: {
    id?: string;
    initialContext?: AskLedgerInitialContext;
    previousQuestion?: string;
    previousAnswer?: string;
    previousSources?: AskLedgerSource[];
    previousExecutionMode?: import('../src/types/askLedgerResponseMode.ts').AskLedgerExecutionMode;
    productArea?: string;
    productFeature?: string;
    previousSkill?: string;
    recentExchanges?: Array<{
      question?: string;
      answer?: string;
      sources?: AskLedgerSource[];
    }>;
    state?: AskLedgerConversationState;
  };
};

export type AskLedgerBenchmarkCaseRequest = AskLedgerRetrievalRequest & {
  caseId?: string;
};

export type PreparedAskLedgerBenchmarkCase = {
  caseId?: string;
  prompt: string;
  sources: AskLedgerSource[];
  contextItems: AskLedgerContextItem[];
  estimatedTokens: number;
};

type AskLedgerStreamCallbacks = {
  onEvent: (event: LocalAIStreamEvent) => void;
};

export class AskLedgerService {
  private readonly retrieval: LedgerRetrievalService;
  private readonly orchestrator: AskLedgerRetrievalOrchestrator;
  private readonly localAI: LocalAIService;
  private readonly answerValidator = new AskLedgerAnswerValidator();
  private readonly repairRequestIds = new Map<string, string>();
  private readonly cancelledRequestIds = new Set<string>();
  private readonly activeConversationRequests = new Map<string, string>();
  private readonly attachments: AskLedgerAttachmentService;

  constructor(
    retrieval: LedgerRetrievalService,
    localAI: LocalAIService,
    attachments = new AskLedgerAttachmentService(path.join(os.tmpdir(), 'ledger-ask-ledger-attachments')),
  ) {
    this.retrieval = retrieval;
    this.orchestrator = new AskLedgerRetrievalOrchestrator(retrieval);
    this.localAI = localAI;
    this.attachments = attachments;
  }

  getRetrievalService() {
    return this.retrieval;
  }

  async ingestAttachments(workspaceId: string, conversationId: string, paths: string[], existing?: { count?: number; sizeBytes?: number }) {
    const documents = await this.attachments.ingest(paths, conversationId, workspaceId, existing);
    await this.retrieval.indexAttachments(conversationId, workspaceId, documents.flatMap(attachmentBlocksToContext));
    return documents.map(({ attachment }) => attachment);
  }

  async restoreAttachments(workspaceId: string, conversationId: string) {
    const documents = await this.attachments.restoreConversation(conversationId);
    if (documents.length) await this.retrieval.indexAttachments(conversationId, workspaceId, documents.flatMap(attachmentBlocksToContext));
    return documents.map(({ attachment }) => attachment);
  }

  async persistAttachments(conversationId: string, messageId: string, attachmentIds: string[]) {
    await this.attachments.persist(conversationId, messageId, attachmentIds);
  }

  attachmentPath(id: string) { return this.attachments.pathFor(id); }

  async removeAttachments(conversationId: string, attachmentIds: string[]) {
    await this.retrieval.deleteAttachments(conversationId, attachmentIds.length ? attachmentIds : undefined);
    if (attachmentIds.length) await this.attachments.cleanup(attachmentIds);
    else await this.attachments.cleanupConversation(conversationId);
  }

  /**
   * Development benchmark seam. Retrieval and normalization happen once here;
   * the returned production prompt can then be replayed against each model.
   */
  async prepareBenchmarkCase(request: AskLedgerBenchmarkCaseRequest): Promise<PreparedAskLedgerBenchmarkCase> {
    const skill = request.skillDefinition ?? getAskLedgerSkill(request.skillId);
    const conversationResolution = resolveAskLedgerConversation(request.question, request.conversation?.state, request.workspaceId);
    const route = routeAskLedgerMessage(request.question, {
      previousQuestion: request.conversation?.previousQuestion,
      previousAnswer: request.conversation?.previousAnswer,
      previousSources: request.conversation?.previousSources,
      recentExchanges: request.conversation?.recentExchanges,
      explicitContext: request.explicitContext,
      hasSelectedSkill: Boolean(skill),
      attachmentCount: request.attachmentIds?.length,
    });
    if (request.conversation?.id) await this.restoreAttachments(request.workspaceId, request.conversation.id);
    await this.retrieval.indexWorkspace(request.workspaceId, request.documents);
    const retrievalQuestion = [
      request.question,
      skill ? buildSkillPromptContext(skill, request.explicitContext) : '',
      request.conversation?.initialContext ? `Current Ledger context: ${request.conversation.initialContext.title}` : '',
      overviewFocusHandoffText(request.explicitContext ?? request.conversation?.initialContext),
      ...(request.conversation?.recentExchanges ?? []).slice(-2).flatMap((exchange) => [
        exchange.question ? `Recent question: ${exchange.question.slice(0, 600)}` : '',
        exchange.sources?.length ? `Recent sources: ${exchange.sources.slice(0, 6).map((source) => source.title).join('; ')}` : '',
      ]),
      request.conversation?.previousQuestion && !request.conversation?.recentExchanges?.length ? `Previous question: ${request.conversation.previousQuestion}` : '',
      request.conversation?.previousSources?.length && !request.conversation?.recentExchanges?.length ? `Previous sources: ${request.conversation.previousSources.slice(0, 8).map((source) => source.title).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const explicitContext = request.explicitContext ?? request.conversation?.initialContext;
    const isCustomSkill = Boolean(skill && !getAskLedgerSkill(skill.id));
    const retrievalQuery = request.question.trim() || (skill ? skill.instructions : request.question);
    const retrieval = await this.orchestrator.retrieve(request.workspaceId, retrievalQuery, request.lexicalResults, skill?.id === 'plan_my_week' ? 32 : 20, {
      conversationId: request.conversation?.id,
      documents: request.documents,
      retrievalQuestion,
      skillId: skill?.id,
      ...(isCustomSkill ? { customSkillResourceTypes: skill?.executionContract?.resources } : {}),
      boostResourceKeys: [...(explicitContext ? [`${explicitContext.resourceType}:${explicitContext.resourceId}`] : []), ...(overviewFocusHandoff(explicitContext ?? request.conversation?.initialContext)?.resourceRefs.map((resource) => `${resource.resourceType}:${resource.resourceId}`) ?? []), ...conversationResolution.resourceKeys],
      resolvedResourceKeys: [
        ...conversationResolution.resourceKeys,
        ...(request.explicitContext?.resourceType === 'project'
          ? [`project:${request.explicitContext.projectId ?? request.explicitContext.resourceId}`]
          : []),
      ],
    });
    const allowedItems = skill ? retrieval.items.filter((item) => skill.allowedContextTypes.includes(item.resourceType)) : retrieval.items;
    const explicitItem = explicitContext ? request.documents.find((item) => item.resourceType === explicitContext.resourceType && item.resourceId === explicitContext.resourceId) : undefined;
    const selectedItems = explicitItem && !allowedItems.some((item) => item.resourceType === explicitItem.resourceType && item.resourceId === explicitItem.resourceId)
      ? [explicitItem, ...allowedItems]
      : allowedItems;
    const evidence = compileAskLedgerEvidence({ question: request.question, result: retrieval, items: selectedItems, timeZone: request.timeZone, timeFormat: request.timeFormat });
    const generationDepth = inferAskLedgerGenerationDepth({ question: request.question, routeDepth: route.answerDepth, retrievalMode: retrieval.mode, orchestration: retrieval.orchestration });
    const normalized = new LedgerContextBuilder().normalize(evidence.selectedItems, {
      maxContextTokens: skill ? 2800 : 2400,
      maxItemTokens: 700,
      timeZone: request.timeZone,
      timeFormat: request.timeFormat,
      sortByFreshness: false,
    });
    const sourceByKey = new Map<string, AskLedgerSource>();
    normalized.items.forEach((item) => sourceByKey.set(`${item.resourceType}:${item.resourceId}`, {
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      title: item.title,
      route: item.route,
      projectId: item.projectId,
      projectName: item.projectName,
      sourceLabel: item.sourceLabel,
      integrationProvider: item.integrationProvider,
      integrationResourceType: item.integrationResourceType,
      externalId: item.externalId,
      explicitIntegrationLink: item.explicitIntegrationLink,
      updatedAt: item.updatedAt,
      parentResourceId: item.parentResourceId,
      relationships: item.relationships,
      attachmentSource: item.attachmentSource,
    }));
    return {
      caseId: request.caseId,
      prompt: buildAskLedgerPrompt({
        question: [request.question, overviewFocusHandoffText(request.explicitContext ?? request.conversation?.initialContext)].filter(Boolean).join('\n\n'),
        context: normalized,
        primaryContext: retrieval.primaryItems,
        supportingContext: retrieval.relatedItems,
        recentConversation: request.conversation,
        skill,
        skillContext: skill ? buildSkillPromptContext(skill, explicitContext) : undefined,
        answerDepth: route.answerDepth,
        generationDepth: generationDepth.depth,
        generationDepthReason: generationDepth.reason,
        executionMode: route.executionMode,
        timeZone: request.timeZone,
        timeFormat: request.timeFormat,
        evidencePackage: evidence.package,
      }),
      sources: [...sourceByKey.values()],
      contextItems: normalized.items,
      estimatedTokens: normalized.estimatedTokens,
    };
  }

  start(request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    if (request.skillId) return this.executeSkill(request, callbacks);
    const requestId = request.requestId ?? randomUUID();
    this.supersedeConversationRequest(request, requestId);
    const conversationKey = this.conversationRequestKey(request);
    if (conversationKey) this.activeConversationRequests.set(conversationKey, requestId);
    queueMicrotask(() => {
      void this.run(requestId, request, callbacks);
    });
    return requestId;
  }

  executeSkill(request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    const skill = request.skillDefinition ?? getAskLedgerSkill(request.skillId);
    if (!skill) {
      const requestId = request.requestId ?? randomUUID();
      queueMicrotask(() => callbacks.onEvent({ type: 'error', requestId, error: { code: 'retrieval_failed', message: 'Unknown Ask Ledger skill.' } }));
      return requestId;
    }
    const context = request.explicitContext ?? request.conversation?.initialContext;
    const validationError = validateSkillContext(skill, context);
    if (validationError) {
      const requestId = request.requestId ?? randomUUID();
      queueMicrotask(() => callbacks.onEvent({ type: 'error', requestId, error: { code: 'retrieval_failed', message: validationError } }));
      return requestId;
    }
    const requestId = request.requestId ?? randomUUID();
    this.supersedeConversationRequest(request, requestId);
    const conversationKey = this.conversationRequestKey(request);
    if (conversationKey) this.activeConversationRequests.set(conversationKey, requestId);
    queueMicrotask(() => void this.run(requestId, { ...request, explicitContext: context }, callbacks));
    return requestId;
  }

  cancel(requestId: string) {
    this.cancelledRequestIds.add(requestId);
    const result = this.localAI.cancel(requestId);
    const repairRequestId = this.repairRequestIds.get(requestId);
    if (repairRequestId) this.localAI.cancel(repairRequestId);
    return result;
  }

  async shutdown() {
    await this.retrieval.shutdown();
    await this.localAI.shutdown();
    await this.attachments.cleanupAll();
  }

  async shutdownRuntimes() {
    await this.retrieval.shutdown();
    await this.localAI.shutdown();
    await this.attachments.cleanupAll();
  }

  private async run(requestId: string, request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    const startedAt = Date.now();
    const performanceTrace = new AskLedgerPerformanceTrace({ requestId, messageId: request.messageId, skillId: request.skillId });
    performanceTrace.mark('serviceRunStarted');
    const routingStartedAt = Date.now();
    let routingMs = 0;
    let indexingMs = 0;
    let retrievalMs = 0;
    let evidenceMs = 0;
    let validationMs = 0;
    let repairMs = 0;
    let performanceSnapshot: Record<string, unknown> | undefined;
    let modelRouting: ReturnType<LocalAIService['getModelRouting']> | undefined;
    let activeGenerationDepth: ReturnType<typeof inferAskLedgerGenerationDepth> | undefined;
    const throwIfCancelled = () => {
      if (this.cancelledRequestIds.has(requestId)) throw new LocalAIError('cancelled', 'Ask Ledger request cancelled.');
    };
    const emit = (event: LocalAIStreamEvent) => {
      if (event.type === 'delta') performanceTrace.mark('firstDeltaForwarded');
      if (event.type === 'done') {
        performanceTrace.mark('serviceDonePrepared');
        performanceSnapshot = {
          ...performanceSnapshot,
          ...event.metrics?.performance,
          generationMs: event.metrics?.totalMs,
          outputTokens: event.metrics?.predictedTokens,
          validationMs: validationMs || undefined,
          repairMs: repairMs || undefined,
          totalMs: Date.now() - startedAt,
          firstForwardedDeltaMs: performanceTrace.get('firstDeltaForwarded'),
        };
        const warnings = performanceWarning(performanceSnapshot);
        askLedgerDiagnostic('[local-ai] Ask Ledger performance', { ...performanceSnapshot, warnings: warnings.length ? warnings : undefined });
      }
      const enrichedEvent = event.type === 'done'
        ? { ...event, metrics: { ...event.metrics, totalMs: Date.now() - startedAt, performance: performanceSnapshot ?? event.metrics?.performance } }
        : event;
      if (enrichedEvent.type === 'done' && activeGenerationDepth) {
        askLedgerDiagnostic('[local-ai] Ask Ledger generation complete', {
          messageId: request.messageId,
          answerDepth: activeGenerationDepth.depth,
          depthReason: activeGenerationDepth.reason,
          outputTokens: enrichedEvent.metrics?.predictedTokens,
          generationMs: enrichedEvent.metrics?.totalMs,
          truncated: enrichedEvent.metrics?.finishReason === 'length',
        });
      }
      if (enrichedEvent.type === 'done' || enrichedEvent.type === 'error') {
        this.cancelledRequestIds.delete(requestId);
        this.repairRequestIds.delete(requestId);
        const conversationKey = this.conversationRequestKey(request);
        if (conversationKey && this.activeConversationRequests.get(conversationKey) === requestId) this.activeConversationRequests.delete(conversationKey);
      }
      callbacks.onEvent(enrichedEvent);
    };
    try {
      throwIfCancelled();
      performanceTrace.mark('routingStarted');
      const skill = request.skillDefinition ?? getAskLedgerSkill(request.skillId);
      const conversationResolution = resolveAskLedgerConversation(request.question, request.conversation?.state, request.workspaceId);
      const embeddedContextOnly = Boolean(request.explicitContext?.initialQuestion && !request.conversation?.previousQuestion && !request.conversation?.recentExchanges?.length);
      const routed = routeAskLedgerMessage(request.question, {
        previousQuestion: request.conversation?.previousQuestion,
        previousAnswer: request.conversation?.previousAnswer,
        previousSources: request.conversation?.previousSources,
        recentExchanges: request.conversation?.recentExchanges,
        explicitContext: request.explicitContext,
        hasSelectedSkill: Boolean(skill),
        attachmentCount: request.attachmentIds?.length,
        previousExecutionMode: request.conversation?.previousExecutionMode,
        previousProductArea: request.conversation?.productArea,
        previousProductFeature: request.conversation?.productFeature,
        previousSkill: request.conversation?.previousSkill,
      });
      const route = embeddedContextOnly
        ? { ...routed, retrievalRequired: false, answerDepth: 'standard' as const, reason: 'embedded_context' }
        : routed;
      const conversationForCurrentTurn = route.diagnostics.contextReset || route.executionMode === 'ledger_product_help'
        ? undefined
        : request.conversation;
      const productKnowledge: AskLedgerProductKnowledgeSelection | undefined = route.executionMode === 'ledger_product_help'
        ? selectAskLedgerProductKnowledge(request.question, {
          previousQuestion: request.conversation?.previousQuestion,
          previousAnswer: request.conversation?.previousAnswer,
          recentExchanges: request.conversation?.recentExchanges,
          previousExecutionMode: request.conversation?.previousExecutionMode,
          previousProductArea: request.conversation?.productArea,
          previousProductFeature: request.conversation?.productFeature,
        })
        : undefined;
      if (productKnowledge) {
        route.diagnostics.productArea = productKnowledge.area;
        route.diagnostics.productFeature = productKnowledge.feature;
        route.diagnostics.productKnowledgeIds = productKnowledgeNodeIds(productKnowledge);
        route.diagnostics.productKnowledgeTokens = productKnowledge.tokenCount;
        route.diagnostics.productResolutionConfidence = productKnowledge.resolutionConfidence;
        route.diagnostics.productResolutionReason = productKnowledge.resolutionReason;
      }
      performanceTrace.mark('routingCompleted');
      performanceTrace.set('route', route.mode);
      performanceTrace.set('executionMode', route.executionMode);
      performanceTrace.set('retrievalRequired', route.retrievalRequired);
      performanceTrace.set('answerDepth', route.answerDepth);
      const previousSourcesForReuse = request.conversation?.recentExchanges?.slice(-1)[0]?.sources?.length
        ? request.conversation.recentExchanges.slice(-1)[0].sources
        : request.conversation?.previousSources;
      const reuseRequested = route.reusePreviousGroundedContext;
      // An empty source list means there are no workspace facts to validate;
      // it must not turn an otherwise conversational follow-up into retrieval.
      // When sources exist, every referenced resource must still be present in
      // the current workspace corpus before grounded context can be reused.
      const reusableContextAvailable = !reuseRequested || !previousSourcesForReuse?.length || previousSourcesForReuse.every((source) => request.documents.some((item) => item.resourceType === source.resourceType && item.resourceId === source.resourceId));
      const shouldRetrieve = route.retrievalRequired || (reuseRequested && !reusableContextAvailable);
      performanceTrace.set('retrievalRequired', shouldRetrieve);
      if (route.executionMode === 'ledger_product_help') {
        const productPerformance = { indexingMs: 0, embeddingStartupMs: 0, retrievalMs: 0, workspaceEvidence: 0, workspaceSources: 0 };
        performanceTrace.set('indexingMs', 0);
        performanceTrace.set('embeddingStartupMs', 0);
        performanceTrace.set('retrievalMs', 0);
        performanceTrace.set('workspaceEvidence', 0);
        performanceTrace.set('workspaceSources', 0);
        askLedgerDiagnostic('[local-ai] Ask Ledger product help', {
          requestId,
          executionMode: route.executionMode,
          routingDiagnostics: route.diagnostics,
          retrievalRequired: false,
          ...productPerformance,
        });
      }
      if (route.executionMode === 'ledger_product_help' && isLedgerProductQuestion(request.question)) {
        emit({ type: 'sources', requestId, sources: [] });
        emit({ type: 'delta', requestId, text: productKnowledge?.nodes.length ? formatAskLedgerProductOverview(productKnowledge) : `# What Ledger does\n\n${ASK_LEDGER_PRODUCT_DESCRIPTION}` });
        emit({ type: 'done', requestId, metrics: { totalMs: 0, performance: performanceTrace.snapshot({ indexingMs: 0, embeddingStartupMs: 0, retrievalMs: 0, workspaceEvidence: 0, workspaceSources: 0 }) } });
        return;
      }
      if ((route.executionMode === 'ledger_product_help' || route.reason === 'capability_question') && isLedgerCreatorQuestion(request.question)) {
        emit({ type: 'sources', requestId, sources: [] });
        emit({ type: 'delta', requestId, text: ASK_LEDGER_CREATOR_DESCRIPTION });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      if (route.executionMode === 'ledger_product_help' && productKnowledge?.nodes.length) {
        emit({ type: 'sources', requestId, sources: [] });
        emit({ type: 'delta', requestId, text: formatAskLedgerProductHelp(productKnowledge) });
        emit({ type: 'done', requestId, metrics: { totalMs: 0, performance: performanceTrace.snapshot({ indexingMs: 0, embeddingStartupMs: 0, retrievalMs: 0, workspaceEvidence: 0, workspaceSources: 0 }) } });
        return;
      }
      performanceTrace.set('existingGroundedContextReusable', reusableContextAvailable);
      const generationTimeoutMs = skill
        ? 120_000
        : route.executionMode === 'conversation'
        ? 30_000
        : route.executionMode === 'workspace_lookup'
        ? route.answerDepth === 'detailed' ? 120_000 : 60_000
        : route.executionMode === 'workspace_synthesis'
        ? 120_000
        : 120_000;
      performanceTrace.set('timeoutMs', generationTimeoutMs);
      if (reuseRequested && !reusableContextAvailable) {
        askLedgerDiagnostic('[local-ai] Ask Ledger grounded context invalidated', {
          requestId,
          messageId: request.messageId,
          reason: 'source_missing_from_current_workspace_context',
          workspaceId: request.workspaceId,
          previousSourceCount: previousSourcesForReuse?.length ?? 0,
        });
      }
      const retrievalPlan = buildRetrievalPlan(request.question);
      routingMs = Date.now() - routingStartedAt;
      const fastPath = route.executionMode !== 'ledger_product_help' && !skill && !request.explicitContext && !request.attachmentIds?.length && !request.conversation?.previousQuestion && !request.conversation?.recentExchanges?.length
        ? resolveAskLedgerFastPath(request.question, request.documents)
        : undefined;
      const fastPathResolved = fastPath && (fastPath.resolution === 'resolved' || fastPath.resolution === 'not_found');
      if (fastPath && !fastPathResolved) {
        performanceTrace.set('fastPathKind', fastPath.kind);
        performanceTrace.set('fastPathResolution', fastPath.resolution);
        askLedgerDiagnostic('[local-ai] Ask Ledger fast path escalation', {
          messageId: request.messageId,
          fastPathKind: fastPath.kind,
          fastPathResolution: fastPath.resolution,
          fallback: 'bounded_retrieval',
        });
      }
      if (fastPath && fastPathResolved) {
        performanceTrace.mark('fastPathCompleted');
        performanceTrace.set('fastPath', fastPath.kind);
        performanceTrace.set('fastPathKind', fastPath.kind);
        performanceTrace.set('fastPathResolution', fastPath.resolution);
        const performance = performanceTrace.snapshot({
          executionMode: 'workspace_lookup',
          retrievalRequired: false,
          retrievalMode: 'deterministic',
          fastPathKind: fastPath.kind,
          fastPathResolution: fastPath.resolution,
        });
        askLedgerDiagnostic('[local-ai] Ask Ledger routing', {
          messageId: request.messageId,
          mode: route.mode,
          executionMode: 'workspace_lookup',
          routingDiagnostics: route.diagnostics,
          fastPath: fastPath.kind,
          fastPathResolution: fastPath.resolution,
          retrievalRequired: false,
        });
        const sources = fastPath.items.map(fastPathSource);
        emit({ type: 'sources', requestId, sources });
        emit({ type: 'delta', requestId, text: fastPath.answer });
        emit({ type: 'done', requestId, metrics: { totalMs: performance.totalMs as number, performance } });
        return;
      }
      const hasFreshRetrievalIntent = retrievalPlan.primaryResourceTypes.length > 0 || Boolean(retrievalPlan.containerQuery || retrievalPlan.entityQuery) || conversationResolution.mode === 'refresh_state' || conversationResolution.mode === 'switch_provider' || conversationResolution.mode === 'switch_entity';
      askLedgerDiagnostic('[local-ai] Ask Ledger routing', {
        messageId: request.messageId,
        mode: route.mode,
        executionMode: route.executionMode,
        routingDiagnostics: route.diagnostics,
        retrievalRequired: route.retrievalRequired,
        followUp: route.mode === 'follow_up',
        reason: route.reason,
        reusedGroundedContext: route.reusePreviousGroundedContext,
        answerDepth: route.answerDepth,
        depthExplicit: route.depthExplicit,
        modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier,
      });
      routingMs = Date.now() - routingStartedAt;
      if (!shouldRetrieve) {
        const reusedSources = route.reusePreviousGroundedContext
          ? request.conversation?.previousSources ?? []
          : [];
        emit({ type: 'sources', requestId, sources: reusedSources });
        const embeddedItem = request.explicitContext
          ? request.documents.find((item) => item.resourceType === request.explicitContext?.resourceType && item.resourceId === request.explicitContext?.resourceId)
          : undefined;
        const previousContextItems = route.reusePreviousGroundedContext
          ? request.documents.filter((item) => (request.conversation?.previousSources ?? []).some((source) => source.resourceType === item.resourceType && source.resourceId === item.resourceId))
          : [];
        const normalized = new LedgerContextBuilder().normalize([...((embeddedItem ? [embeddedItem] : [])), ...previousContextItems], { maxContextTokens: 1800, maxItemTokens: 500, timeZone: request.timeZone, timeFormat: request.timeFormat });
        const generationDepth = inferAskLedgerGenerationDepth({ question: request.question, routeDepth: route.answerDepth, retrievalMode: 'quick' });
        activeGenerationDepth = generationDepth;
        const promptConversation = route.reason === 'casual_conversation' ? undefined : conversationForCurrentTurn;
        this.localAI.start(
          { question: request.question, context: buildAskLedgerPrompt({ question: [request.question, request.explicitContext?.resourceType === 'project' ? `Selected project anchor: "${request.explicitContext.title}". Answer this request about this project and its directly linked records only.` : '', overviewFocusHandoffText(request.explicitContext ?? conversationForCurrentTurn?.initialContext)].filter(Boolean).join('\n\n'), context: normalized, recentConversation: promptConversation, responseMode: route.mode, executionMode: route.executionMode, productKnowledgeContext: productKnowledge?.context, timeZone: request.timeZone, timeFormat: request.timeFormat, answerDepth: route.answerDepth, generationDepth: generationDepth.depth, generationDepthReason: generationDepth.reason, capabilityDescription: route.reason === 'capability_question' ? ASK_LEDGER_CAPABILITY_DESCRIPTION : undefined }), timeoutMs: generationTimeoutMs, reasoningSignals: { reasoningMode: request.reasoningMode, answerDepth: route.answerDepth, generationDepth: generationDepth.depth, retrievalRequired: shouldRetrieve, sourceCount: normalized.items.length, attachmentCount: request.attachmentIds?.length, hasSkill: Boolean(skill), skillReasoningPolicy: skill?.reasoningPolicy, routeReason: route.reason }, performance: performanceTrace },
          { onEvent: emit },
          requestId,
        );
        return;
      }
      if (request.conversation?.id) await this.restoreAttachments(request.workspaceId, request.conversation.id);
      const structuredSkillRetrieval = skill?.executionContract?.retrieval === 'structured';
      const structuredLookup = route.executionMode === 'workspace_lookup'
        && retrievalPlan.operation === 'lookup'
        && retrievalPlan.primaryResourceTypes.length > 0
        && !retrievalPlan.expandRelatedContext;
      const semanticIndexRequired = !structuredSkillRetrieval && !structuredLookup && route.mode !== 'follow_up' && !['conversation', 'ledger_product_help', 'workspace_lookup'].includes(route.executionMode);
      performanceTrace.set('semanticIndexRequired', semanticIndexRequired);
      if (!semanticIndexRequired) performanceTrace.set('semanticIndexSkippedReason', structuredSkillRetrieval ? 'skill_structured_contract' : structuredLookup ? 'structured_lookup' : 'route_does_not_require_semantic_retrieval');
      const indexingStartedAt = Date.now();
      performanceTrace.mark('indexingStarted');
      if (semanticIndexRequired) {
        await this.retrieval.indexWorkspace(request.workspaceId, request.documents, { performance: performanceTrace, semantic: true });
      } else {
        performanceTrace.set('indexingSkipped', true);
        performanceTrace.set('indexingSkippedReason', structuredSkillRetrieval ? 'skill_structured_contract' : structuredLookup ? 'structured_lookup' : 'semantic_retrieval_not_required');
      }
      performanceTrace.mark('indexingCompleted');
      indexingMs = semanticIndexRequired ? Date.now() - indexingStartedAt : 0;
      emit({ type: 'activity', requestId, activity: { type: 'searching' } });
      const explicitContext = request.explicitContext ?? request.conversation?.initialContext;
      const projectAnchorInstruction = explicitContext?.resourceType === 'project'
        ? `Selected project anchor: "${explicitContext.title}" (${explicitContext.projectId ?? explicitContext.resourceId}). Use this project and records explicitly linked to its project ID as the authoritative scope. Do not use similarly titled or unrelated workspace records as project work.`
        : '';
      const meetingAnchorInstruction = explicitContext?.contextType === 'meeting'
        ? `Selected meeting anchor: "${explicitContext.title}". Scope meeting questions to the current meeting note, explicit calendar series, linked project, confirmed attendees, related meeting records, and their exact transcript evidence. Transcript answers what was said; current task/project state answers what is true now. Never use a same-title meeting from another series or workspace.`
        : '';
      const retrievalQuestion = [
        request.question,
        meetingAnchorInstruction,
        skill ? buildSkillPromptContext(skill, request.explicitContext) : '',
        conversationForCurrentTurn?.initialContext ? `Current Ledger context: ${conversationForCurrentTurn.initialContext.title}` : '',
        projectAnchorInstruction,
        overviewFocusHandoffText(request.explicitContext ?? conversationForCurrentTurn?.initialContext),
        ...(conversationForCurrentTurn?.recentExchanges ?? []).slice(-2).flatMap((exchange) => [
          exchange.question ? `Recent question: ${exchange.question.slice(0, 600)}` : '',
          exchange.sources?.length ? `Recent sources: ${exchange.sources.slice(0, 6).map((source) => source.title).join('; ')}` : '',
        ]),
        conversationForCurrentTurn?.previousQuestion && !conversationForCurrentTurn?.recentExchanges?.length ? `Previous question: ${conversationForCurrentTurn.previousQuestion}` : '',
        conversationForCurrentTurn?.previousSources?.length && !conversationForCurrentTurn?.recentExchanges?.length ? `Previous sources: ${conversationForCurrentTurn.previousSources.slice(0, 8).map((source) => source.title).join('; ')}` : '',
      ].filter(Boolean).join('\n');
      // Attachment-routed turns are already scoped to the user-selected file.
      // Keep them out of workspace research objectives even when the wording
      // is conversational, e.g. "look through this".
      const genericAttachmentQuestion = Boolean(request.attachmentIds?.length || route.reason === 'attachment');
      const attachmentFocusKeys = genericAttachmentQuestion
        ? request.documents.filter((item) => item.resourceType === 'attachment').map((item) => `${item.resourceType}:${item.resourceId}`)
        : [];
      const isCustomSkill = Boolean(skill && !getAskLedgerSkill(skill.id));
      const intent = detectAskLedgerQueryIntent(request.question);
      const retrievalLimit = skill?.id === 'plan_my_week' || intent.kind === 'weekly_overview' ? 32 : 20;
      // The renderer's document snapshot can be intentionally small (for
      // example, a project handoff may contain only the selected project).
      // Project questions must read the workspace index as well so exact
      // tasks, milestones, reminders, and events are available. The index is
      // still workspace-scoped by LedgerRetrievalService.
      const projectAnchoredRequest = Boolean(explicitContext?.resourceType === 'project');
      const retrievalDocuments = semanticIndexRequired || projectAnchoredRequest ? undefined : request.documents;
      const retrievalStartedAt = Date.now();
      performanceTrace.mark('retrievalStarted');
      // Custom skills can intentionally submit an empty question. Give the
      // retrieval planner the skill's own bounded purpose in that case so it
      // does not fall into the generic empty-query quick path (which defaults
      // to whichever resource type happens to rank first).
      const retrievalQuery = request.question.trim() || (skill ? skill.instructions : request.question);
      const retrieval = await this.orchestrator.retrieve(request.workspaceId, retrievalQuery, request.lexicalResults, retrievalLimit, {
        conversationId: request.conversation?.id,
        documents: retrievalDocuments,
        retrievalQuestion,
        skillId: skill?.id,
        ...(isCustomSkill ? { customSkillResourceTypes: skill?.executionContract?.resources } : {}),
        boostResourceKeys: [...(explicitContext ? [`${explicitContext.resourceType}:${explicitContext.resourceId}`] : []), ...(overviewFocusHandoff(explicitContext ?? request.conversation?.initialContext)?.resourceRefs.map((resource) => `${resource.resourceType}:${resource.resourceId}`) ?? []), ...conversationResolution.resourceKeys, ...attachmentFocusKeys],
        attachmentFocus: genericAttachmentQuestion,
        skipSemantic: genericAttachmentQuestion || route.mode === 'follow_up' || route.executionMode === 'workspace_lookup',
        resolvedResourceKeys: [
          ...conversationResolution.resourceKeys,
          ...(explicitContext?.resourceType === 'project'
            ? [`project:${explicitContext.projectId ?? explicitContext.resourceId}`]
            : []),
        ],
        onObjectiveTiming: (timing) => askLedgerDiagnostic('[local-ai] Ask Ledger retrieval objective', { requestId, messageId: request.messageId, skillId: skill?.id, ...timing }),
      });
      performanceTrace.mark('retrievalCompleted');
      throwIfCancelled();
      retrievalMs = Date.now() - retrievalStartedAt;
      const allowedSkillItems = skill
        ? retrieval.items.filter((item) => skill.allowedContextTypes.includes(item.resourceType))
        : retrieval.items;
      const explicitItem = explicitContext
        ? request.documents.find((item) => item.resourceType === explicitContext.resourceType && item.resourceId === explicitContext.resourceId)
        : undefined;
      const skillItems = explicitItem && !allowedSkillItems.some((item) => item.resourceId === explicitItem.resourceId && item.resourceType === explicitItem.resourceType)
        ? [explicitItem, ...allowedSkillItems]
        : allowedSkillItems;
      const previousSources = request.conversation?.recentExchanges?.slice(-1)[0]?.sources?.length
        ? request.conversation.recentExchanges.slice(-1)[0].sources
        : request.conversation?.previousSources;
      const previousSourceKeys = new Set((previousSources ?? []).map((source) => `${source.resourceType}:${source.resourceId}`));
      const previousContextItems = request.documents.filter((item) => previousSourceKeys.has(`${item.resourceType}:${item.resourceId}`));
      const continuationItems = route.mode === 'follow_up' && route.reusePreviousGroundedContext && !hasFreshRetrievalIntent && previousContextItems.length
        ? previousContextItems
        : [];
      const meetingNotes = intent.kind === 'meeting_prep'
        ? request.documents
          .filter((item) => item.resourceType === 'note')
          .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
          .slice(0, 3)
        : [];
      const projectScopedSkillItems = projectAnchoredRequest && explicitContext
        ? [
          ...(explicitItem ? [explicitItem] : []),
          ...skillItems.filter((item) => item.resourceType === 'project'
            ? item.resourceId === (explicitContext.projectId ?? explicitContext.resourceId)
            : item.projectId === (explicitContext.projectId ?? explicitContext.resourceId)),
        ].filter((item, index, all) => all.findIndex((candidate) => candidate.resourceType === item.resourceType && candidate.resourceId === item.resourceId) === index)
        : skillItems;
      const meetingScopedRequest = explicitContext?.contextType === 'meeting';
      const selectedRetrievalItems = retrieval.mode === 'research'
        ? projectAnchoredRequest
          ? expandRelatedProjectContext(projectScopedSkillItems, request.documents)
          : skill?.id === 'meeting_follow_up' || skill?.id === 'prepare_for_meeting'
            ? expandMeetingContext(explicitItem, skillItems, request.documents, explicitContext)
          : meetingScopedRequest
            ? expandMeetingContext(explicitItem, skillItems, request.documents, explicitContext)
          : skill?.id === 'project_health_check'
            ? expandRelatedProjectContext(skillItems, request.documents)
            : skillItems
        : meetingScopedRequest
        ? expandMeetingContext(explicitItem, skillItems, request.documents, explicitContext)
        : retrieval.primaryItems?.length
        ? [...retrieval.primaryItems, ...(retrieval.relatedItems ?? [])]
        : continuationItems.length
        ? continuationItems
        : projectAnchoredRequest
        ? expandRelatedProjectContext(projectScopedSkillItems, request.documents)
        : (skill?.id === 'meeting_follow_up' || skill?.id === 'prepare_for_meeting') && explicitContext
        ? expandMeetingContext(explicitItem, skillItems, request.documents, explicitContext)
        : (intent.kind === 'blockers' || intent.kind === 'status')
        ? expandRelatedProjectContext(skillItems.slice(0, 8), request.documents)
        : intent.kind === 'project_review'
          ? expandRelatedProjectContext(skillItems.filter((item) => item.resourceType === 'project').slice(0, 8), request.documents)
        : intent.kind === 'recent_updates'
          ? skillItems.slice(0, 16)
        : intent.kind === 'meeting_prep'
          ? [...meetingNotes, ...skillItems.filter((item) => item.resourceType !== 'note').slice(0, 13)]
        : intent.kind === 'integration'
          ? skillItems.slice(0, 16)
        : intent.kind === 'weekly_overview'
          ? skillItems.slice(0, 20)
        : skillItems.slice(0, skill ? 10 : 8);
      const previewSources = (items: AskLedgerContextItem[]) => items.slice(0, 3).map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, route: item.route, projectId: item.projectId, projectName: item.projectName, sourceLabel: item.sourceLabel, integrationProvider: item.integrationProvider, integrationResourceType: item.integrationResourceType, externalId: item.externalId, explicitIntegrationLink: item.explicitIntegrationLink, updatedAt: item.updatedAt, parentResourceId: item.parentResourceId, relationships: item.relationships, attachmentSource: item.attachmentSource }));
      const evidenceStartedAt = Date.now();
      performanceTrace.mark('evidenceBuildStarted');
      const customSkill = Boolean(skill && !skill.outputSections);
      const evidenceBudget = {
        maxResources: customSkill ? 6 : skill ? 10 : projectAnchoredRequest ? 10 : retrieval.mode === 'research' ? 12 : 10,
        maxTokens: customSkill ? 1200 : skill ? 1800 : projectAnchoredRequest ? 1200 : retrieval.mode === 'research' ? 2600 : 2200,
        maxItemTokens: customSkill ? 240 : skill ? 300 : projectAnchoredRequest ? 360 : 520,
      };
      const evidence = compileAskLedgerEvidence({ question: request.question, result: retrieval, items: selectedRetrievalItems, budget: evidenceBudget, timeZone: request.timeZone, timeFormat: request.timeFormat });
      performanceTrace.mark('evidenceBuildCompleted');
      evidenceMs = Date.now() - evidenceStartedAt;
      const generationDepth = inferAskLedgerGenerationDepth({ question: request.question, routeDepth: route.answerDepth, retrievalMode: retrieval.mode, orchestration: retrieval.orchestration });
      performanceTrace.set('retrievalMode', retrieval.mode);
      performanceTrace.set('evidenceBudgetTokens', evidenceBudget.maxTokens);
      performanceTrace.set('retrievalRounds', retrieval.orchestration?.retrievalRounds);
      performanceTrace.set('requestedTier', this.localAI.getGenerationRuntimeState?.().selectedTier);
      activeGenerationDepth = generationDepth;
      modelRouting = this.localAI.getModelRouting?.({
        answerDepth: generationDepth.depth,
        researchRoute: retrieval.mode === 'research',
        objectiveCount: retrieval.orchestration?.objectives.length,
        evidenceCount: evidence.selectedItems.length,
        evidenceTokens: evidence.package.stats.estimatedTokens,
        resourceTypeCount: new Set(evidence.selectedItems.map((item) => item.resourceType)).size,
        entityCount: new Set(evidence.selectedItems.map((item) => item.projectId ?? (item.resourceType === 'project' ? item.resourceId : undefined)).filter(Boolean)).size,
        providerCount: new Set(evidence.selectedItems.map((item) => item.integrationProvider).filter(Boolean)).size,
        crossResource: new Set(evidence.selectedItems.map((item) => item.resourceType)).size > 1,
        question: request.question,
        skillReasoningPolicy: skill?.reasoningPolicy,
      });
      const normalized = new LedgerContextBuilder().normalize(evidence.selectedItems, { maxContextTokens: customSkill ? 1600 : skill ? 2200 : projectAnchoredRequest ? 1200 : retrievalPlan.primaryResourceTypes.length ? 4200 : 2400, maxItemTokens: customSkill ? 300 : projectAnchoredRequest ? 360 : retrievalPlan.primaryResourceTypes.length ? 1000 : 700, sortByFreshness: retrievalPlan.primaryResourceTypes.length ? false : intent.kind === 'recent_updates' || intent.kind === 'meeting_prep' || intent.kind === 'integration' || intent.kind === 'weekly_overview', timeZone: request.timeZone, timeFormat: request.timeFormat });
      emit({ type: 'activity', requestId, activity: { type: 'sources_found', count: normalized.items.length, sources: previewSources(normalized.items) } });
      emit({ type: 'activity', requestId, activity: { type: 'reading_context', count: normalized.items.length, sources: previewSources(normalized.items) } });
      const sourceByKey = new Map<string, AskLedgerSource>();
      normalized.items.forEach((item) => sourceByKey.set(`${item.resourceType}:${item.resourceId}`, {
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          title: item.title,
          route: item.route,
          projectId: item.projectId,
          projectName: item.projectName,
          sourceLabel: item.sourceLabel,
          integrationProvider: item.integrationProvider,
          integrationResourceType: item.integrationResourceType,
          externalId: item.externalId,
          explicitIntegrationLink: item.explicitIntegrationLink,
          updatedAt: item.updatedAt,
          parentResourceId: item.parentResourceId,
          relationships: item.relationships,
          attachmentSource: item.attachmentSource,
        }));
      const sources = [...sourceByKey.values()];
      const indexedResources = typeof (this.retrieval as LedgerRetrievalService & { indexedResources?: unknown }).indexedResources === 'function'
        ? this.retrieval.indexedResources(request.workspaceId, request.conversation?.id)
        : request.documents;
      const documentDiagnostics = buildAskLedgerDocumentDiagnostics({
        available: request.documents,
        indexed: indexedResources,
        retrieved: retrieval.items,
        selected: normalized.items,
      });
      const activityInventory = request.documents.filter((item) => item.resourceType === 'activity').length;
      const notificationInventory = request.documents.filter((item) => item.resourceType === 'notification').length;
      const activityRetrieved = retrieval.items.filter((item) => item.resourceType === 'activity').length;
      const notificationRetrieved = retrieval.items.filter((item) => item.resourceType === 'notification').length;
      const activitySelected = normalized.items.filter((item) => item.resourceType === 'activity').length;
      const notificationSelected = normalized.items.filter((item) => item.resourceType === 'notification').length;
      const notificationState = retrieval.items.filter((item) => item.resourceType === 'notification').reduce((state, item) => { item.read ? state.read += 1 : state.unread += 1; return state; }, { unread: 0, read: 0 });
      const attention = { activityInventory, notificationInventory, activityRetrieved, notificationRetrieved, activitySelected, notificationSelected, notificationState, alertState: retrieval.items.filter((item) => item.resourceType === 'activity' || item.resourceType === 'notification').reduce((state, item) => { const value = String(item.priority ?? item.severity ?? '').toLowerCase(); if (['high', 'urgent', 'critical'].includes(value)) state.highPriority += 1; else state.standard += 1; return state; }, { highPriority: 0, standard: 0 }), duplicateActivityNotificationCollapses: evidence.diagnostics.duplicateActivityNotificationCollapses ?? 0, temporalFilter: Object.keys(retrievalPlan.structuredConstraints).some((key) => ['dueAfter', 'dueBefore'].includes(key)) ? `${retrievalPlan.structuredConstraints.dueAfter ?? ''}..${retrievalPlan.structuredConstraints.dueBefore ?? ''}` : undefined, teamspaceFilter: retrievalPlan.structuredConstraints.sourceLabel ?? undefined };
      const previousKeys = new Set(request.conversation?.state?.previousEvidenceSourceIds ?? []);
      const conversationDiagnostics = { followUp: route.mode === 'follow_up', mode: conversationResolution.mode, resolvedReferences: conversationResolution.resolvedReferences, reusedEntities: conversationResolution.reusedEntities.map((entity) => `${entity.resourceType}:${entity.resourceId}`), freshRetrieval: normalized.items.filter((item) => !previousKeys.has(`${item.resourceType}:${item.resourceId}`)).map((item) => `${item.resourceType}:${item.resourceId}`).slice(0, 12), previousSourcesReused: normalized.items.filter((item) => previousKeys.has(`${item.resourceType}:${item.resourceId}`)).length, unresolvedReferences: conversationResolution.unresolvedReferences, contextReset: conversationResolution.contextReset };
      const performance = {
        routingMs,
        indexingMs,
        retrievalMs,
        orchestrationMs: retrieval.orchestration ? retrievalMs : undefined,
        evidenceMs,
        evidenceTokens: evidence.package.stats.estimatedTokens,
        retrievalRounds: retrieval.orchestration?.retrievalRounds,
        graphResources: retrieval.graphExpansion ? Object.values(retrieval.graphExpansion.depthCounts).reduce((total, count) => total + Object.values(count).reduce((nestedTotal, nestedCount) => nestedTotal + nestedCount, 0), 0) : 0,
        providerCalls: retrieval.integrationRetrieval?.remoteAttempts ?? 0,
        cacheHits: 0,
      };
      performanceSnapshot = performance;
      const diagnostics = retrieval.graphExpansion
        ? { ...documentDiagnostics, graphExpansion: retrieval.graphExpansion, hybridRetrieval: retrieval.hybridRetrieval, orchestration: retrieval.orchestration, evidence: evidence.diagnostics, attention, conversation: conversationDiagnostics, integrationRetrieval: retrieval.integrationRetrieval, generation: { answerDepth: generationDepth.depth, depthReason: generationDepth.reason, evidenceResources: evidence.selectedItems.length, evidenceTokens: evidence.package.stats.estimatedTokens, modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier, modelRouting, performance, truncated: evidence.package.coverage.truncated.length > 0, missingEvidence: evidence.package.coverage.missing } }
        : { ...documentDiagnostics, hybridRetrieval: retrieval.hybridRetrieval, orchestration: retrieval.orchestration, evidence: evidence.diagnostics, attention, conversation: conversationDiagnostics, integrationRetrieval: retrieval.integrationRetrieval, generation: { answerDepth: generationDepth.depth, depthReason: generationDepth.reason, evidenceResources: evidence.selectedItems.length, evidenceTokens: evidence.package.stats.estimatedTokens, modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier, modelRouting, performance, truncated: evidence.package.coverage.truncated.length > 0, missingEvidence: evidence.package.coverage.missing } };
      askLedgerDiagnostic('[local-ai] Ask Ledger retrieval', {
        workspaceId: request.workspaceId,
        skillId: skill?.id,
        explicitContext: explicitContext ? { resourceType: explicitContext.resourceType, resourceId: explicitContext.resourceId } : undefined,
        question: request.question,
        documentInventory: diagnostics,
        candidates: retrieval.debug,
        selectedContext: normalized.items.map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title })),
        droppedContext: Math.max(0, retrieval.items.length - normalized.items.length),
        promptTokens: normalized.estimatedTokens,
        retrievalPlan: {
          operation: retrievalPlan.operation,
          primaryResourceTypes: retrievalPlan.primaryResourceTypes,
          entityQuery: retrievalPlan.entityQuery,
          containerQuery: retrievalPlan.containerQuery,
          resolvedContainer: retrieval.plan?.resolvedContainer,
          ordering: retrievalPlan.ordering,
          requestedCount: retrievalPlan.requestedCount,
          expandRelatedContext: retrievalPlan.expandRelatedContext,
          retrievalStrategies: retrievalPlan.retrievalStrategies,
          structuredConstraints: retrievalPlan.structuredConstraints,
        },
        primaryResourceCount: retrieval.primaryItems?.length ?? 0,
        relatedCandidateCount: retrieval.relatedCandidateCount ?? 0,
        relatedResourceCount: retrieval.relatedItems?.length ?? 0,
      });
      emit({ type: 'sources', requestId, sources, diagnostics });
      if (!skill && isTeamWorkloadQuestion(request.question)) {
        emit({ type: 'delta', requestId, text: formatTeamWorkloadAnswer(normalized.items, request.timeZone) });
        emit({ type: 'done', requestId, metrics: { totalMs: 0, performance: performanceTrace.snapshot({ indexingMs: 0, embeddingStartupMs: 0, retrievalMs: 0, workspaceEvidence: normalized.items.length, workspaceSources: sources.length }) } });
        return;
      }
      const directMilestoneLookup = !skill
        && intent.kind === 'milestones'
        && normalized.items.some((item) => item.resourceType === 'milestone');
      if (!skill && (structuredAnswerFor.has(intent.kind) && !retrieval.primaryItems?.length || directMilestoneLookup)) {
        const structuredItems = directMilestoneLookup
          ? normalized.items.filter((item) => item.resourceType === 'milestone')
          : normalized.items;
        emit({ type: 'delta', requestId, text: structuredItems.length ? formatStructuredAnswer(intent.kind, structuredItems, request.timeZone) : emptyStructuredAnswer(intent.kind) });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      emit({ type: 'activity', requestId, activity: { type: 'preparing_answer' } });
      performanceTrace.set('promptTokens', normalized.estimatedTokens);
      askLedgerDiagnostic('[local-ai] Ask Ledger generation', {
        messageId: request.messageId,
        answerDepth: generationDepth.depth,
        depthReason: generationDepth.reason,
        evidenceResources: evidence.selectedItems.length,
        evidenceTokens: evidence.package.stats.estimatedTokens,
        coverage: evidence.package.coverage,
        modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier,
      });
      const topScore = retrieval.debug[0]?.score ?? 0;
      const hasSignal = retrieval.debug.some((candidate) => candidate.why.some((reason) => reason.startsWith('lexical:') || reason.startsWith('lexical-score:') || reason.startsWith('backend-lexical:') || reason.startsWith('semantic:') || reason === 'title' || reason === 'explicit-context'))
        || (intent.kind === 'recent_updates' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('recent:')))
        || (intent.kind === 'meeting_prep' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('meeting-prep-')));
      const hasPlannedPrimary = Boolean(retrieval.primaryItems?.length);
      const hasExplicitContextEvidence = Boolean(explicitContext && normalized.items.some((item) => item.resourceType === explicitContext.resourceType && item.resourceId === explicitContext.resourceId));
      const hasAttachmentEvidence = genericAttachmentQuestion && retrieval.debug[0]?.resourceType === 'attachment' && retrieval.debug[0]?.why.includes('explicit-context');
      if (!normalized.items.length || (!skill && !hasPlannedPrimary && !hasExplicitContextEvidence && !hasAttachmentEvidence && (!retrieval.items.length || !hasSignal || topScore < 0.18))) {
        askLedgerDiagnostic('[local-ai] Ask Ledger grounding diagnostics', {
          messageId: request.messageId,
          responseMode: route.mode,
          groundingRequired: route.retrievalRequired,
          sourceRequirement: 'required',
          abstentionTriggered: true,
          reusedPreviousAnswer: route.reusePreviousGroundedContext,
        });
        emit({ type: 'delta', requestId, text: ASK_LEDGER_ABSTENTION });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      const generatedSkillAnswer: string[] = [];
      const generatedAnswerChunks: string[] = [];
      const outputMappings = outputMappingsFor(normalized.items, request.timeZone, request.timeFormat);
      const defaultSkillBudget = skill?.id === 'plan_my_week'
        ? 768
        : generationDepth.depth === 'deep' || generationDepth.explicit
          ? 512
          : 448;
      // A custom skill's execution contract is its intentional output
      // allowance. Do not accidentally clamp it with the generic grounded
      // answer default; LocalAI still applies the tier-specific safety ceiling.
      const answerGenerationBudget = skill
        ? skill.executionContract?.maxOutput ?? defaultSkillBudget
        : 512;
      const generationCallbacks = skill && ['plan_my_week', 'meeting_follow_up', 'prepare_for_meeting'].includes(skill.id)
        ? {
            onEvent: (event: LocalAIStreamEvent) => {
              if (event.type === 'delta' && typeof event.text === 'string') {
                generatedSkillAnswer.push(event.text);
                emit(event);
              }
              if (event.type === 'done') {
                const rawGeneratedAnswer = generatedSkillAnswer.join('').trim();
                const sectionCompletedAnswer = skill.id === 'plan_my_week' ? completePlanMyWeekSections(rawGeneratedAnswer, normalized.items) : rawGeneratedAnswer;
                const generatedAnswer = sanitizeAskLedgerOutput(completeTerminalSection(sectionCompletedAnswer, normalized.items), outputMappings).answer;
                if (generatedAnswer !== rawGeneratedAnswer) {
                  askLedgerDiagnostic('[local-ai] Ask Ledger skill completion guard', { skillId: skill.id, reason: 'required_section_empty' });
                  emit({ type: 'replace', requestId, text: generatedAnswer });
                }
                if (generatedAnswer === ASK_LEDGER_ABSTENTION && normalized.items.length) {
                  emit({ type: 'replace', requestId, text: skill.id === 'plan_my_week' ? formatPlanMyWeekFallback(normalized.items, request.timeZone) : formatMeetingFollowUpFallback(normalized.items, skill.id) });
                }
                emit(event);
              }
              if (event.type === 'error') emit(event);
            },
          }
        : {
            onEvent: (event: LocalAIStreamEvent) => {
              if (event.type === 'delta') {
                if (typeof event.text === 'string') {
                  generatedAnswerChunks.push(event.text);
                  // Custom skills are validated and may be repaired before
                  // the final answer is known. Buffer their deltas so a late
                  // model fallback cannot briefly flash in the renderer.
                  if (!skill || isCustomSkill) emit(event);
                }
                return;
              }
              if (event.type !== 'done') {
                emit(event);
                return;
              }
              const rawGeneratedAnswer = generatedAnswerChunks.join('');
              const generatedAnswer = sanitizeAskLedgerOutput(completeTerminalSection(rawGeneratedAnswer, normalized.items), outputMappings).answer;
              if (generatedAnswer !== rawGeneratedAnswer) emit({ type: 'replace', requestId, text: generatedAnswer });
              if (!generatedAnswer.trim()) {
                emit({ ...event, requestId });
                return;
              }
              const validation = this.answerValidator.validate({ question: request.question, answer: generatedAnswer, evidencePackage: evidence.package, depth: generationDepth.depth, enforceCoverage: !skill });
              validationMs += validation.durationMs;
              const baseValidationDiagnostics = {
                validationTriggered: true,
                validationReason: validation.repairRecommended ? formatAskLedgerValidationFailures(validation) : undefined,
                repairRequired: validation.repairRecommended,
                passed: validation.passed,
                coverageIssues: validation.coverageIssues.length,
                groundednessIssues: validation.groundednessIssues.length,
                contradictionIssues: validation.contradictionIssues.length,
                missingEvidenceIssues: validation.missingEvidenceIssues.length,
                repairAttempted: false,
                sourcesUsed: validation.sourceReferences.length,
                durationMs: validation.durationMs,
              };
              let repairTokens: number | undefined;
              const finish = (answer: string, finalValidation: typeof validation, repairAttempted: boolean, repairDurationMs?: number) => {
                const guarded = sanitizeAskLedgerOutput(answer, outputMappings);
                answer = guarded.answer;
                validationMs += finalValidation === validation ? 0 : finalValidation.durationMs;
                repairMs = repairDurationMs ?? 0;
                const validationDiagnostics = { ...baseValidationDiagnostics, passed: finalValidation.passed, coverageIssues: finalValidation.coverageIssues.length, groundednessIssues: finalValidation.groundednessIssues.length, contradictionIssues: finalValidation.contradictionIssues.length, missingEvidenceIssues: finalValidation.missingEvidenceIssues.length, repairAttempted, repairSucceeded: repairAttempted ? finalValidation.passed : undefined, sourcesUsed: finalValidation.sourceReferences.length, durationMs: finalValidation.durationMs, repairDurationMs, repairGenerationMs: repairDurationMs, repairTokens };
                const structuredPresentation = diagnoseAskLedgerStructuredOutput(answer, normalized.items, { timeZone: request.timeZone, timeFormat: request.timeFormat });
                Object.assign(validationDiagnostics, { structuredPresentation, outputGuard: guarded.diagnostics });
                askLedgerDiagnostic('[local-ai] Ask Ledger answer validation', { ...validationDiagnostics, failures: formatAskLedgerValidationFailures(finalValidation) });
                // Retrieval diagnostics belong in development telemetry, not
                // in the user-facing answer. Skills have their own bounded
                // structure and should return a clean grounded fallback or
                // abstention when validation fails.
                const evidenceLimitations = !skill && !finalValidation.passed ? formatAskLedgerEvidenceLimitations(evidence.package) : '';
                if (answer.trim()) emit({ type: 'replace', requestId, text: `${answer}${evidenceLimitations}` });
                emit({ ...event, requestId, validation: validationDiagnostics });
              };
              if (validation.repairRecommended) {
                if (validation.contradictionIssues.length || validation.groundednessIssues.length) {
                  // A bounded skill response can legitimately stop at the
                  // visible output limit. Preserve useful streamed content
                  // rather than replacing it with an abstention; the
                  // validator diagnostics remain available for evaluation.
                  if (skill && event.metrics?.finishReason === 'length' && generatedAnswer.trim()) {
                    finish(generatedAnswer, validation, false);
                    return;
                  }
                  // A contradictory answer should not trigger another long
                  // model pass. Replace it with the safe grounded response;
                  // coverage-only failures may still use the bounded repair.
                  finish(ASK_LEDGER_ABSTENTION, validation, false, 0);
                  return;
                }
                const repairRequestId = `${requestId}:repair`;
                const repairStartedAt = Date.now();
                this.repairRequestIds.set(requestId, repairRequestId);
                const repairChunks: string[] = [];
                this.localAI.start(
                  { question: request.question, context: buildAskLedgerRepairPrompt({ question: request.question, evidencePackage: evidence.package, answer: generatedAnswer, validationFailures: formatAskLedgerValidationFailures(validation), executionMode: route.executionMode, presentationProfile: skill?.presentationProfile }), generationBudget: Math.min(answerGenerationBudget, 256), timeoutMs: Math.min(generationTimeoutMs, 30_000), reasoningSignals: { answerDepth: 'brief', generationDepth: 'standard', retrievalRequired: route.retrievalRequired, sourceCount: normalized.items.length, attachmentCount: request.attachmentIds?.length, hasSkill: Boolean(skill), skillReasoningPolicy: 'off', routeReason: 'answer_validation_repair' } },
                  { onEvent: (repairEvent) => {
                    if (repairEvent.type === 'delta' && typeof repairEvent.text === 'string') repairChunks.push(repairEvent.text);
                    else if (repairEvent.type === 'activity') emit(repairEvent);
                    else if (repairEvent.type === 'error') {
                      this.repairRequestIds.delete(requestId);
                      if (repairEvent.error?.code === 'cancelled') emit(repairEvent);
                      else finish(generatedAnswer, validation, true, Date.now() - repairStartedAt);
                    }
                    else if (repairEvent.type === 'done') {
                      this.repairRequestIds.delete(requestId);
                      repairTokens = repairEvent.metrics?.predictedTokens;
                      const repairedAnswer = sanitizeAskLedgerOutput(repairChunks.join(''), outputMappings).answer;
                      const repairedValidation = this.answerValidator.validate({ question: request.question, answer: repairedAnswer, evidencePackage: evidence.package, depth: generationDepth.depth, enforceCoverage: !skill });
                      finish(repairedAnswer.trim() ? repairedAnswer : generatedAnswer, repairedValidation, true, Date.now() - repairStartedAt);
                    }
                  } },
                  repairRequestId,
                );
                return;
              }
              finish(generatedAnswer, validation, false);
            },
          };
      this.localAI.start(
        { question: request.question, context: buildAskLedgerPrompt({ question: [request.question, projectAnchorInstruction, meetingAnchorInstruction, overviewFocusHandoffText(request.explicitContext ?? conversationForCurrentTurn?.initialContext)].filter(Boolean).join('\n\n'), context: normalized, evidencePackage: evidence.package, primaryContext: retrieval.primaryItems, supportingContext: retrieval.relatedItems, recentConversation: conversationForCurrentTurn, skill, skillContext: skill ? buildSkillPromptContext(skill, explicitContext) : undefined, responseMode: route.mode, executionMode: route.executionMode, presentationProfile: skill?.presentationProfile, timeZone: request.timeZone, timeFormat: request.timeFormat, answerDepth: route.answerDepth, generationDepth: generationDepth.depth, generationDepthReason: generationDepth.reason }), generationBudget: answerGenerationBudget, timeoutMs: generationTimeoutMs, reasoningSignals: { reasoningMode: request.reasoningMode, answerDepth: route.answerDepth, generationDepth: generationDepth.depth, retrievalRequired: route.retrievalRequired, sourceCount: normalized.items.length, attachmentCount: request.attachmentIds?.length, hasSkill: Boolean(skill), skillReasoningPolicy: skill?.reasoningPolicy, routeReason: route.reason }, performance: performanceTrace },
        generationCallbacks,
        requestId,
      );
    } catch (error) {
      const cancelled = this.cancelledRequestIds.has(requestId) || (error instanceof LocalAIError && error.code === 'cancelled');
      emit({
        type: 'error',
        requestId,
        error: {
          code: cancelled ? 'cancelled' : 'retrieval_failed',
          message: cancelled ? 'Ask Ledger request cancelled.' : error instanceof Error ? error.message : 'Ledger retrieval failed.',
        },
      });
    }
  }

  private conversationRequestKey(request: AskLedgerRetrievalRequest) {
    return request.conversation?.id ? `${request.workspaceId}:${request.conversation.id}` : undefined;
  }

  private supersedeConversationRequest(request: AskLedgerRetrievalRequest, nextRequestId: string) {
    const key = this.conversationRequestKey(request);
    const previousRequestId = key ? this.activeConversationRequests.get(key) : undefined;
    if (previousRequestId && previousRequestId !== nextRequestId) {
      askLedgerDiagnostic('[local-ai] Ask Ledger request superseded', {
        previousRequestId,
        nextRequestId,
        workspaceId: request.workspaceId,
        conversationId: request.conversation?.id,
      });
      this.cancel(previousRequestId);
    }
  }
}

export const createAskLedgerService = (localAI: LocalAIService, assets?: LocalAIAssetManager, attachmentRoot?: string) => {
  const provider = (assets || process.env.LEDGER_LOCAL_AI_EMBEDDING_URL?.trim() || process.env.LEDGER_LOCAL_AI_EMBEDDING_MODEL_PATH?.trim())
    ? new LocalEmbeddingProvider(assets)
    : undefined;
  const index = new EmbeddingIndexService(provider);
  const retrieval = new LedgerRetrievalService(index, provider);
  return new AskLedgerService(retrieval, localAI, new AskLedgerAttachmentService(attachmentRoot ?? path.join(os.tmpdir(), 'ledger-ask-ledger-attachments')));
};
