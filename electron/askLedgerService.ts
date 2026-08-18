import { randomUUID } from 'node:crypto';
import { buildAskLedgerPrompt } from './askLedgerPrompt.ts';
import { ASK_LEDGER_ABSTENTION } from './askLedgerPrompt.ts';
import { LedgerContextBuilder } from './askLedgerContext.ts';
import { LocalAIService, type LocalAIStreamEvent } from './localAIService.ts';
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
import { buildSkillPromptContext, getAskLedgerSkill, validateSkillContext } from './askLedgerSkills.ts';
import type { AskLedgerSkillDefinition, AskLedgerSkillId } from '../src/types/askLedgerSkills.ts';
import { routeAskLedgerMessage } from '../src/types/askLedgerResponseMode.ts';
import { ASK_LEDGER_CAPABILITY_DESCRIPTION } from '../src/types/askLedgerCapabilities.ts';
import { AskLedgerAttachmentService, attachmentBlocksToContext } from './askLedgerAttachmentService.ts';
import { buildRetrievalPlan } from './askLedgerRetrievalPlan.ts';
import os from 'node:os';
import path from 'node:path';

const structuredAnswerFor = new Set(['team_members', 'projects', 'tasks', 'milestones', 'reminders', 'events', 'open_actions', 'deadlines', 'time_window', 'integration']);

const formatLedgerDate = (value?: string) => {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  const hasTime = /T\d{2}:\d{2}|\d{2}:\d{2}/.test(value);
  return hasTime
    ? parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

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

const formatStructuredAnswer = (kind: string, items: AskLedgerContextItem[]) => {
  const lines: string[] = [];
  const title = kind === 'team_members' ? 'Team members' : kind === 'projects' ? 'Projects' : kind === 'milestones' ? 'Milestones' : kind === 'events' ? 'Events' : kind === 'reminders' ? 'Reminders' : kind === 'deadlines' ? 'Deadlines' : kind === 'time_window' ? 'This week' : kind === 'integration' ? 'Integration context' : 'Open actions';
  lines.push(`${title}:`);
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const details = [
      item.status,
      item.taskHorizon ? `Horizon ${item.taskHorizon === 'long_term' ? 'long term' : item.taskHorizon}` : undefined,
      item.projectName,
      item.dueAt ? `Due ${formatLedgerDate(item.dueAt)}` : item.timestamp ? `At ${formatLedgerDate(item.timestamp)}` : undefined,
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

const formatPlanMyWeekFallback = (items: AskLedgerContextItem[]) => {
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
    ...(dated.length ? dated.map((item) => `- ${item.title} — ${item.dueAt ? `Due ${formatLedgerDate(item.dueAt)}` : `At ${formatLedgerDate(item.timestamp)}`}`) : ['- No dated commitments were supplied.']),
    '',
    'Risks or blockers:',
    ...(blocked.length ? blocked.map((item) => `- ${item.title}${item.status ? ` — ${item.status}` : ''}`) : ['- No explicit blockers were found in the supplied context.']),
    '',
    'Next steps:',
    ...(focus.slice(0, 3).map((item) => `- Start with ${item.title}.`)),
  ];
  return lines.join('\n');
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

const expandMeetingContext = (explicitItem: AskLedgerContextItem | undefined, candidates: AskLedgerContextItem[], documents: AskLedgerContextItem[]) => {
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
  const titleTokens = meetingContextTokens(`${explicitItem.title} ${explicitItem.content}`);
  const titleRelated = (item: AskLedgerContextItem) => {
    const overlap = [...meetingContextTokens(`${item.title} ${item.content}`)].filter((token) => titleTokens.has(token));
    const distinctiveAnchorTokens = [...titleTokens].filter((token) => !['meeting', 'work', 'golf', 'call', 'event'].includes(token));
    return overlap.length >= 2 || overlap.some((token) => distinctiveAnchorTokens.includes(token));
  };

  // The selected meeting is the anchor. Pull its note/transcript first, then
  // work records that explicitly point to the same meeting or project.
  documents
    .filter((item) => (noteId && (item.resourceId === noteId || item.parentResourceId === noteId)) || (projectId && item.projectId === projectId && ['note', 'transcript'].includes(item.resourceType)) || (['note', 'transcript'].includes(item.resourceType) && titleRelated(item)))
    .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
    .forEach(add);
  documents
    .filter((item) => ['task', 'reminder', 'milestone'].includes(item.resourceType))
    .filter((item) => (projectId && item.projectId === projectId) || titleRelated(item) || (explicitItem.title && `${item.provenance ?? ''} ${item.content}`.toLowerCase().includes(explicitItem.title.toLowerCase())))
    .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
    .forEach(add);
  // If the event has no linked note or project, a few recent notes/tasks make
  // the absence of meeting history visible and still give the skill something
  // grounded to compare against instead of returning an empty-context error.
  return [...selected.values()].slice(0, 16);
};

export type AskLedgerRetrievalRequest = {
  workspaceId: string;
  question: string;
  documents: AskLedgerContextItem[];
  lexicalResults: LexicalCandidate[];
  skillId?: AskLedgerSkillId;
  skillDefinition?: AskLedgerSkillDefinition;
  explicitContext?: AskLedgerInitialContext;
  attachmentIds?: string[];
  messageId?: string;
  conversation?: {
    id?: string;
    initialContext?: AskLedgerInitialContext;
    previousQuestion?: string;
    previousAnswer?: string;
    previousSources?: AskLedgerSource[];
    recentExchanges?: Array<{
      question?: string;
      answer?: string;
      sources?: AskLedgerSource[];
    }>;
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
  private readonly localAI: LocalAIService;
  private readonly attachments: AskLedgerAttachmentService;

  constructor(
    retrieval: LedgerRetrievalService,
    localAI: LocalAIService,
    attachments = new AskLedgerAttachmentService(path.join(os.tmpdir(), 'ledger-ask-ledger-attachments')),
  ) {
    this.retrieval = retrieval;
    this.localAI = localAI;
    this.attachments = attachments;
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
    const route = routeAskLedgerMessage(request.question, {
      previousQuestion: request.conversation?.previousQuestion,
      previousAnswer: request.conversation?.previousAnswer,
      previousSources: request.conversation?.previousSources,
      recentExchanges: request.conversation?.recentExchanges,
      explicitContext: request.explicitContext,
      hasSelectedSkill: Boolean(skill),
      attachmentCount: request.attachmentIds?.length,
    });
    const retrievalPlan = buildRetrievalPlan(request.question);
    if (request.conversation?.id) await this.restoreAttachments(request.workspaceId, request.conversation.id);
    await this.retrieval.indexWorkspace(request.workspaceId, request.documents);
    const retrievalQuestion = [
      request.question,
      skill ? buildSkillPromptContext(skill, request.explicitContext) : '',
      request.conversation?.initialContext ? `Current Ledger context: ${request.conversation.initialContext.title}` : '',
      ...(request.conversation?.recentExchanges ?? []).slice(-2).flatMap((exchange) => [
        exchange.question ? `Recent question: ${exchange.question.slice(0, 600)}` : '',
        exchange.sources?.length ? `Recent sources: ${exchange.sources.slice(0, 6).map((source) => source.title).join('; ')}` : '',
      ]),
      request.conversation?.previousQuestion && !request.conversation?.recentExchanges?.length ? `Previous question: ${request.conversation.previousQuestion}` : '',
      request.conversation?.previousAnswer && !request.conversation?.recentExchanges?.length ? `Previous grounded answer: ${request.conversation.previousAnswer.slice(0, 1200)}` : '',
      request.conversation?.previousSources?.length && !request.conversation?.recentExchanges?.length ? `Previous sources: ${request.conversation.previousSources.slice(0, 8).map((source) => source.title).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const explicitContext = request.explicitContext ?? request.conversation?.initialContext;
    const retrieval = await this.retrieval.retrieve(request.workspaceId, retrievalQuestion, request.lexicalResults, skill?.id === 'plan_my_week' ? 32 : 20, {
      conversationId: request.conversation?.id,
      plan: retrievalPlan,
      boostResourceKeys: explicitContext ? [`${explicitContext.resourceType}:${explicitContext.resourceId}`] : [],
    });
    const allowedItems = skill ? retrieval.items.filter((item) => skill.allowedContextTypes.includes(item.resourceType)) : retrieval.items;
    const explicitItem = explicitContext ? request.documents.find((item) => item.resourceType === explicitContext.resourceType && item.resourceId === explicitContext.resourceId) : undefined;
    const selectedItems = explicitItem && !allowedItems.some((item) => item.resourceType === explicitItem.resourceType && item.resourceId === explicitItem.resourceId)
      ? [explicitItem, ...allowedItems]
      : allowedItems;
    const normalized = new LedgerContextBuilder().normalize(selectedItems.slice(0, skill ? 10 : 8), {
      maxContextTokens: skill ? 2800 : 2400,
      maxItemTokens: 700,
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
      updatedAt: item.updatedAt,
      parentResourceId: item.parentResourceId,
      attachmentSource: item.attachmentSource,
    }));
    return {
      caseId: request.caseId,
      prompt: buildAskLedgerPrompt({
        question: request.question,
        context: normalized,
        primaryContext: retrieval.primaryItems,
        supportingContext: retrieval.relatedItems,
        recentConversation: request.conversation,
        skill,
        skillContext: skill ? buildSkillPromptContext(skill, explicitContext) : undefined,
        answerDepth: route.answerDepth,
      }),
      sources: [...sourceByKey.values()],
      contextItems: normalized.items,
      estimatedTokens: normalized.estimatedTokens,
    };
  }

  start(request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    if (request.skillId) return this.executeSkill(request, callbacks);
    const requestId = randomUUID();
    queueMicrotask(() => {
      void this.run(requestId, request, callbacks);
    });
    return requestId;
  }

  executeSkill(request: AskLedgerRetrievalRequest, callbacks: AskLedgerStreamCallbacks) {
    const skill = request.skillDefinition ?? getAskLedgerSkill(request.skillId);
    if (!skill) {
      const requestId = randomUUID();
      queueMicrotask(() => callbacks.onEvent({ type: 'error', requestId, error: { code: 'retrieval_failed', message: 'Unknown Ask Ledger skill.' } }));
      return requestId;
    }
    const context = request.explicitContext ?? request.conversation?.initialContext;
    const validationError = validateSkillContext(skill, context);
    if (validationError) {
      const requestId = randomUUID();
      queueMicrotask(() => callbacks.onEvent({ type: 'error', requestId, error: { code: 'retrieval_failed', message: validationError } }));
      return requestId;
    }
    const requestId = randomUUID();
    queueMicrotask(() => void this.run(requestId, { ...request, explicitContext: context }, callbacks));
    return requestId;
  }

  cancel(requestId: string) {
    return this.localAI.cancel(requestId);
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
    const emit = (event: LocalAIStreamEvent) => callbacks.onEvent(event.type === 'done'
      ? { ...event, metrics: { ...event.metrics, totalMs: Date.now() - startedAt } }
      : event);
    try {
      const skill = request.skillDefinition ?? getAskLedgerSkill(request.skillId);
      const route = routeAskLedgerMessage(request.question, {
        previousQuestion: request.conversation?.previousQuestion,
        previousAnswer: request.conversation?.previousAnswer,
        previousSources: request.conversation?.previousSources,
        recentExchanges: request.conversation?.recentExchanges,
        explicitContext: request.explicitContext,
        hasSelectedSkill: Boolean(skill),
        attachmentCount: request.attachmentIds?.length,
      });
      const retrievalPlan = buildRetrievalPlan(request.question);
      const hasFreshRetrievalIntent = retrievalPlan.primaryResourceTypes.length > 0 || Boolean(retrievalPlan.containerQuery || retrievalPlan.entityQuery);
      console.info('[local-ai] Ask Ledger routing', {
        messageId: request.messageId,
        mode: route.mode,
        retrievalRequired: route.retrievalRequired,
        followUp: route.mode === 'follow_up',
        reason: route.reason,
        reusedGroundedContext: route.reusePreviousGroundedContext,
        answerDepth: route.answerDepth,
        depthExplicit: route.depthExplicit,
        modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier,
      });
      if (!route.retrievalRequired) {
        const reusedSources = route.reusePreviousGroundedContext
          ? request.conversation?.previousSources ?? []
          : [];
        emit({ type: 'sources', requestId, sources: reusedSources });
        const previousContextItems = route.reusePreviousGroundedContext
          ? request.documents.filter((item) => (request.conversation?.previousSources ?? []).some((source) => source.resourceType === item.resourceType && source.resourceId === item.resourceId))
          : [];
        const normalized = new LedgerContextBuilder().normalize(previousContextItems, { maxContextTokens: 1800, maxItemTokens: 500 });
        this.localAI.start(
          { question: request.question, context: buildAskLedgerPrompt({ question: request.question, context: normalized, recentConversation: request.conversation, responseMode: route.mode, answerDepth: route.answerDepth, capabilityDescription: route.reason === 'capability_question' ? ASK_LEDGER_CAPABILITY_DESCRIPTION : undefined }), reasoningSignals: { answerDepth: route.answerDepth, retrievalRequired: route.retrievalRequired, sourceCount: normalized.items.length, attachmentCount: request.attachmentIds?.length, hasSkill: Boolean(skill), routeReason: route.reason } },
          { onEvent: emit },
          requestId,
        );
        return;
      }
      if (request.conversation?.id) await this.restoreAttachments(request.workspaceId, request.conversation.id);
      await this.retrieval.indexWorkspace(request.workspaceId, request.documents);
      emit({ type: 'activity', requestId, activity: { type: 'searching' } });
      const retrievalQuestion = [
        request.question,
        skill ? buildSkillPromptContext(skill, request.explicitContext) : '',
        request.conversation?.initialContext ? `Current Ledger context: ${request.conversation.initialContext.title}` : '',
        ...(request.conversation?.recentExchanges ?? []).slice(-2).flatMap((exchange) => [
          exchange.question ? `Recent question: ${exchange.question.slice(0, 600)}` : '',
          exchange.sources?.length ? `Recent sources: ${exchange.sources.slice(0, 6).map((source) => source.title).join('; ')}` : '',
        ]),
        request.conversation?.previousQuestion && !request.conversation?.recentExchanges?.length ? `Previous question: ${request.conversation.previousQuestion}` : '',
        request.conversation?.previousAnswer && !request.conversation?.recentExchanges?.length ? `Previous grounded answer: ${request.conversation.previousAnswer.slice(0, 1200)}` : '',
        request.conversation?.previousSources?.length && !request.conversation?.recentExchanges?.length ? `Previous sources: ${request.conversation.previousSources.slice(0, 8).map((source) => source.title).join('; ')}` : '',
      ].filter(Boolean).join('\n');
      const explicitContext = request.explicitContext ?? request.conversation?.initialContext;
      const intent = detectAskLedgerQueryIntent(request.question);
      const retrievalLimit = skill?.id === 'plan_my_week' || intent.kind === 'weekly_overview' ? 32 : 20;
      const retrieval = await this.retrieval.retrieve(request.workspaceId, retrievalQuestion, request.lexicalResults, retrievalLimit, {
        conversationId: request.conversation?.id,
        plan: retrievalPlan,
        boostResourceKeys: explicitContext
          ? [`${explicitContext.resourceType}:${explicitContext.resourceId}`]
          : [],
      });
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
      const selectedRetrievalItems = retrieval.primaryItems?.length
        ? [...retrieval.primaryItems, ...(retrieval.relatedItems ?? [])]
        : continuationItems.length
        ? continuationItems
        : (skill?.id === 'meeting_follow_up' || skill?.id === 'prepare_for_meeting') && explicitContext
        ? expandMeetingContext(explicitItem, skillItems, request.documents)
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
      const previewSources = (items: AskLedgerContextItem[]) => items.slice(0, 3).map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, route: item.route, projectId: item.projectId, projectName: item.projectName, sourceLabel: item.sourceLabel, updatedAt: item.updatedAt, parentResourceId: item.parentResourceId, attachmentSource: item.attachmentSource }));
      const normalized = new LedgerContextBuilder().normalize(selectedRetrievalItems, { maxContextTokens: skill ? 3200 : retrievalPlan.primaryResourceTypes.length ? 4200 : 2400, maxItemTokens: retrievalPlan.primaryResourceTypes.length ? 1000 : 700, sortByFreshness: retrievalPlan.primaryResourceTypes.length ? false : intent.kind === 'recent_updates' || intent.kind === 'meeting_prep' || intent.kind === 'integration' || intent.kind === 'weekly_overview' });
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
          updatedAt: item.updatedAt,
          parentResourceId: item.parentResourceId,
          attachmentSource: item.attachmentSource,
        }));
      const sources = [...sourceByKey.values()];
      console.info('[local-ai] Ask Ledger retrieval', {
        workspaceId: request.workspaceId,
        skillId: skill?.id,
        explicitContext: explicitContext ? { resourceType: explicitContext.resourceType, resourceId: explicitContext.resourceId } : undefined,
        question: request.question,
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
        },
        primaryResourceCount: retrieval.primaryItems?.length ?? 0,
        relatedCandidateCount: retrieval.relatedCandidateCount ?? 0,
        relatedResourceCount: retrieval.relatedItems?.length ?? 0,
      });
      emit({ type: 'sources', requestId, sources });
      if (!skill && structuredAnswerFor.has(intent.kind) && !retrieval.primaryItems?.length) {
        emit({ type: 'delta', requestId, text: normalized.items.length ? formatStructuredAnswer(intent.kind, normalized.items) : emptyStructuredAnswer(intent.kind) });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      emit({ type: 'activity', requestId, activity: { type: 'preparing_answer' } });
      const topScore = retrieval.debug[0]?.score ?? 0;
      const hasSignal = retrieval.debug[0]?.why.some((reason) => reason.startsWith('lexical:') || reason.startsWith('semantic:') || reason === 'title')
        || (intent.kind === 'recent_updates' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('recent:')))
        || (intent.kind === 'meeting_prep' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('meeting-prep-')));
      const hasPlannedPrimary = Boolean(retrieval.primaryItems?.length);
      if (!normalized.items.length || (!skill && !hasPlannedPrimary && (!retrieval.items.length || !hasSignal || topScore < 0.18))) {
        console.info('[local-ai] Ask Ledger grounding diagnostics', {
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
      const generationCallbacks = skill && ['plan_my_week', 'meeting_follow_up', 'prepare_for_meeting'].includes(skill.id)
        ? {
            onEvent: (event: LocalAIStreamEvent) => {
              if (event.type === 'delta' && typeof event.text === 'string') generatedSkillAnswer.push(event.text);
              if (event.type === 'done') {
                const generatedAnswer = generatedSkillAnswer.join('').trim();
                if (generatedAnswer === ASK_LEDGER_ABSTENTION && normalized.items.length) {
                  emit({ type: 'delta', requestId, text: skill.id === 'plan_my_week' ? formatPlanMyWeekFallback(normalized.items) : formatMeetingFollowUpFallback(normalized.items, skill.id) });
                } else if (generatedAnswer) {
                  emit({ type: 'delta', requestId, text: generatedAnswer });
                }
                emit(event);
                return;
              }
            },
          }
        : { onEvent: emit };
      this.localAI.start(
        { question: request.question, context: buildAskLedgerPrompt({ question: request.question, context: normalized, primaryContext: retrieval.primaryItems, supportingContext: retrieval.relatedItems, recentConversation: request.conversation, skill, skillContext: skill ? buildSkillPromptContext(skill, explicitContext) : undefined, responseMode: route.mode, answerDepth: route.answerDepth }), reasoningSignals: { answerDepth: route.answerDepth, retrievalRequired: route.retrievalRequired, sourceCount: normalized.items.length, attachmentCount: request.attachmentIds?.length, hasSkill: Boolean(skill), routeReason: route.reason } },
        generationCallbacks,
        requestId,
      );
    } catch (error) {
      emit({
        type: 'error',
        requestId,
        error: {
          code: 'retrieval_failed',
          message: error instanceof Error ? error.message : 'Ledger retrieval failed.',
        },
      });
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
