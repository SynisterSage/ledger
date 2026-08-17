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
import { AskLedgerAttachmentService, attachmentBlocksToContext } from './askLedgerAttachmentService.ts';
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

const formatMeetingFollowUpFallback = (items: AskLedgerContextItem[], skillId: string) => {
  const anchor = items.find((item) => ['event', 'transcript', 'note'].includes(item.resourceType));
  const notes = items.filter((item) => ['note', 'transcript'].includes(item.resourceType));
  const actions = items.filter((item) => ['task', 'reminder', 'milestone'].includes(item.resourceType)).slice(0, 6);
  const label = skillId === 'prepare_for_meeting' ? 'Meeting preparation' : 'Meeting follow-up';
  const lines = [
    `${label}: ${anchor?.title ?? 'Selected meeting'}`,
    '',
    notes.length ? `Context found:\n${notes.slice(0, 3).map((item) => `- ${item.title}`).join('\n')}` : 'Context found: No meeting note or transcript was linked.',
    '',
    actions.length
      ? `Possible related work:\n${actions.map((item) => `- ${item.title}`).join('\n')}`
      : 'Follow-ups: No explicit tasks, reminders, or milestones were linked to this meeting.',
    '',
    notes.length || actions.length
      ? 'Next step: Review the supplied context and confirm which items belong to this meeting.'
      : 'Next step: Add meeting notes or a transcript so Ledger can identify decisions and follow-ups.',
  ];
  return lines.join('\n');
};

const askLedgerGreetings = [
  'Hey — good to see you. What would you like to work through in Ledger?',
  'Hello! I’m here and ready to help you find what matters next.',
  'Hi there — what’s on your mind?',
  'Good to see you. What should we look at together?',
];

const casualResponseFor = (question: string) => {
  const normalized = question.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/how are you|how is it going/.test(normalized)) return 'I’m doing well and ready to help. What are we working on?';
  if (/how have you been|hows your day|how is your day|you good|you okay/.test(normalized)) return 'I’m doing well — thanks for asking. What would you like to work through?';
  if (/whats up|nothing much|not much/.test(normalized)) return 'Not much — I’m here and ready when you are. What’s on your mind?';
  if (/whats on (your|ur) mind/.test(normalized)) return 'Mostly helping you make sense of what’s in Ledger. What’s on your mind?';
  if (/are you there|can you hear me/.test(normalized)) return 'I’m here. What do you need?';
  if (/who are you|what are you|tell me about yourself|are you ai|are you real|are you a robot/.test(normalized)) return 'I’m Ledger — your local workspace companion. I can help you find context, plan work, and figure out what comes next.';
  if (/what can you do|what do you do/.test(normalized)) return 'I can search your Ledger context, connect notes with tasks and projects, review what changed, and help you plan what comes next.';
  if (/can you help me|could you help me|i need help|help me please|help please/.test(normalized)) return 'Absolutely. Tell me what you’re trying to figure out, and I’ll help you work through it.';
  if (/bye|goodbye|good bye|see you|talk to you later|later|catch you later/.test(normalized)) return 'See you later. I’ll be here when you’re ready to pick things back up.';
  if (/thanks|thank you|thx|appreciate it|much appreciated/.test(normalized)) return 'You’re welcome. Want to keep going?';
  if (/im good|im doing well|cool|nice|okay|ok|got it|sounds good|great|awesome|perfect|alright|all right|haha|lol/.test(normalized)) return 'Good to hear it. What should we tackle next?';
  return askLedgerGreetings[Math.floor(Math.random() * askLedgerGreetings.length)];
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
      if (detectAskLedgerQueryIntent(request.question).kind === 'greeting') {
        emit({ type: 'sources', requestId, sources: [] });
        const greeting = casualResponseFor(request.question);
        emit({ type: 'delta', requestId, text: greeting });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
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
      const retrieval = await this.retrieval.retrieve(request.workspaceId, retrievalQuestion, request.lexicalResults, skill?.id === 'plan_my_week' ? 32 : 20, {
        conversationId: request.conversation?.id,
        boostResourceKeys: explicitContext
          ? [`${explicitContext.resourceType}:${explicitContext.resourceId}`]
          : [],
      });
      const intent = detectAskLedgerQueryIntent(request.question);
      const allowedSkillItems = skill
        ? retrieval.items.filter((item) => skill.allowedContextTypes.includes(item.resourceType))
        : retrieval.items;
      const explicitItem = explicitContext
        ? request.documents.find((item) => item.resourceType === explicitContext.resourceType && item.resourceId === explicitContext.resourceId)
        : undefined;
      const skillItems = explicitItem && !allowedSkillItems.some((item) => item.resourceId === explicitItem.resourceId && item.resourceType === explicitItem.resourceType)
        ? [explicitItem, ...allowedSkillItems]
        : allowedSkillItems;
      const meetingNotes = intent.kind === 'meeting_prep'
        ? request.documents
          .filter((item) => item.resourceType === 'note')
          .sort((left, right) => Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? ''))
          .slice(0, 3)
        : [];
      const selectedRetrievalItems = (skill?.id === 'meeting_follow_up' || skill?.id === 'prepare_for_meeting') && explicitContext
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
        : skillItems.slice(0, skill ? 10 : 8);
      const previewSources = (items: AskLedgerContextItem[]) => items.slice(0, 3).map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, route: item.route, projectId: item.projectId, projectName: item.projectName, sourceLabel: item.sourceLabel, updatedAt: item.updatedAt, parentResourceId: item.parentResourceId, attachmentSource: item.attachmentSource }));
      const normalized = new LedgerContextBuilder().normalize(selectedRetrievalItems, { maxContextTokens: skill ? 2800 : 2400, maxItemTokens: 700, sortByFreshness: intent.kind === 'recent_updates' || intent.kind === 'meeting_prep' || intent.kind === 'integration' });
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
      });
      emit({ type: 'sources', requestId, sources });
      if (!skill && structuredAnswerFor.has(intent.kind)) {
        emit({ type: 'delta', requestId, text: normalized.items.length ? formatStructuredAnswer(intent.kind, normalized.items) : emptyStructuredAnswer(intent.kind) });
        emit({ type: 'done', requestId, metrics: { totalMs: 0 } });
        return;
      }
      emit({ type: 'activity', requestId, activity: { type: 'preparing_answer' } });
      const topScore = retrieval.debug[0]?.score ?? 0;
      const hasSignal = retrieval.debug[0]?.why.some((reason) => reason.startsWith('lexical:') || reason.startsWith('semantic:') || reason === 'title')
        || (intent.kind === 'recent_updates' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('recent:')))
        || (intent.kind === 'meeting_prep' && retrieval.debug[0]?.why.some((reason) => reason.startsWith('meeting-prep-')));
      if (!normalized.items.length || (!skill && (!retrieval.items.length || !hasSignal || topScore < 0.18))) {
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
        { question: request.question, context: buildAskLedgerPrompt({ question: request.question, context: normalized, recentConversation: request.conversation, skill, skillContext: skill ? buildSkillPromptContext(skill, explicitContext) : undefined }) },
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
