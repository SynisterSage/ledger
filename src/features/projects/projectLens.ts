import type { AskLedgerContextItem } from '../../types/askLedgerContext.ts';
import type { ProjectIntelligenceContext } from './projectIntelligenceContext.ts';
import type { ProjectSignal } from './projectSignals.ts';

export type ProjectLensResourceType = 'project' | 'task' | 'milestone' | 'note' | 'event' | 'reminder' | 'activity';
export type ProjectResourceRef = { resourceType: ProjectLensResourceType; resourceId: string };
export type ProjectLensAction = 'catch_up' | 'find_blockers' | 'next_steps' | 'prepare_actions' | 'find_context';
export type ProposedProjectAction = { title: string; description?: string; suggestedDueDate?: string; reason: string; sourceRefs: ProjectResourceRef[] };
export type ProjectChangeProposal =
  | { type: 'create_action'; title: string; description?: string; dueDate?: string; sourceRefs: ProjectResourceRef[] }
  | { type: 'link_resource'; resource: ProjectResourceRef }
  | { type: 'create_reminder'; title: string; description?: string; dueAt?: string; sourceRefs: ProjectResourceRef[] };
export type ProjectLensActionResult = {
  action: ProjectLensAction;
  summary: string;
  items?: Array<{ text: string; sources: ProjectResourceRef[] }>;
  blockers?: Array<{ text: string; kind: 'confirmed' | 'possible'; sources: ProjectResourceRef[] }>;
  proposedActions?: ProposedProjectAction[];
  relatedResources?: ProjectResourceRef[];
  sources: ProjectResourceRef[];
};
export type ProjectLensResult = {
  summary: string;
  attention?: { text: string; sources: ProjectResourceRef[] };
  nextStep?: { text: string; sources: ProjectResourceRef[] };
  sources: ProjectResourceRef[];
};
export type ProjectLensTiming = {
  contextBuildMs?: number;
  retrievalMs?: number;
  timeToFirstTokenMs?: number;
  generationMs?: number;
  totalMs?: number;
  modelTier?: 'balanced' | 'fast' | 'retrieval';
  cache?: 'hit' | 'miss';
  evidenceCount?: number;
  promptChars?: number;
};
export type ProjectLensRequest = {
  project: { title: string; objective: string; status: string; progress: number; startDate: string | null; endDate: string | null };
  signals: Array<Pick<ProjectSignal, 'kind' | 'severity' | 'title' | 'detail' | 'projectId' | 'resourceType' | 'resourceId' | 'date' | 'count'>>;
  currentWork: {
    activeTasks: Array<{ id: string; title: string; status?: string | null; dueDate?: string | null; priority?: string | null }>;
    overdueTasks: Array<{ id: string; title: string; dueDate?: string | null }>;
    milestones: Array<{ id: string; title: string; date?: string | null; completed?: boolean | null }>;
    upcomingEvents: Array<{ id: string; title: string; date?: string | null; kind: 'event' | 'reminder' }>;
  };
  recentContext: Array<{ resourceType: ProjectLensResourceType; resourceId: string; title: string; content: string; updatedAt?: string | null }>;
  semanticEvidence: Array<{ resourceType: ProjectLensResourceType; resourceId: string; title: string; content: string; contextScope: 'linked_project_context' | 'workspace_related_context'; updatedAt?: string | null }>;
};
export type ProjectLensValidation = { result: ProjectLensResult | null; rejectionReasons: string[] };

const allowedResourceType = (value: unknown): value is ProjectLensResourceType =>
  value === 'project' || value === 'task' || value === 'milestone' || value === 'note' || value === 'event' || value === 'reminder' || value === 'activity';
const text = (value: unknown, max = 420) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const refKey = (ref: ProjectResourceRef) => `${ref.resourceType}:${ref.resourceId}`;
const sourceFromItem = (item: AskLedgerContextItem): ProjectResourceRef | null =>
  allowedResourceType(item.resourceType) && item.resourceId ? { resourceType: item.resourceType, resourceId: item.resourceId } : null;

export const buildProjectLensRequest = (context: ProjectIntelligenceContext): ProjectLensRequest => {
  const activeTasks = context.tasks.filter((task) => !/^(completed|complete|done|cancelled|canceled|dismissed)$/i.test(String(task.status ?? '')));
  const overdueTaskIds = new Set(context.signals.filter((signal) => signal.kind === 'overdue_action').flatMap((signal) => Array.isArray(signal.metadata?.resourceIds) ? signal.metadata.resourceIds.map(String) : [signal.resourceId]));
  const contextItems = [
    ...context.linkedNotes,
    ...context.linkedResources,
    ...context.recentActivity.map((item) => ({ resourceType: 'activity' as const, resourceId: item.id, title: 'Project activity', content: item.at ?? item.updated_at ?? item.created_at ?? '', updatedAt: item.at ?? item.updated_at ?? item.created_at ?? null })),
  ];
  const semanticEvidence = context.semanticContext.slice(0, 8).flatMap((item) => {
    const resource = sourceFromItem(item);
    if (!resource) return [];
    const contextScope = item.metadata?.context_scope === 'workspace_related_context' ? 'workspace_related_context' as const : 'linked_project_context' as const;
    return [{ ...resource, title: text(item.title, 180), content: text(item.content, 700), contextScope, updatedAt: item.updatedAt ?? null }];
  });
  return {
    project: { title: text(context.project.name, 180), objective: text(context.project.description, 500), status: text(context.project.status ?? 'Not started', 80), progress: Math.max(0, Math.min(100, Number(context.project.completeness ?? 0) || 0)), startDate: context.project.start_date ?? null, endDate: context.project.end_date ?? null },
    signals: context.signals.filter((signal) => signal.kind !== 'project_state').slice(0, 12).map(({ kind, severity, title, detail, projectId, resourceType, resourceId, date, count }) => ({ kind, severity, title, detail, projectId, resourceType, resourceId, date, count })),
    currentWork: {
      activeTasks: activeTasks.slice(0, 12).map((task) => ({ id: task.id, title: text(task.title, 180), status: task.status, dueDate: task.due_date, priority: task.priority })),
      overdueTasks: activeTasks.filter((task) => overdueTaskIds.has(task.id)).slice(0, 6).map((task) => ({ id: task.id, title: text(task.title, 180), dueDate: task.due_date })),
      milestones: context.milestones.slice(0, 8).map((milestone) => ({ id: milestone.id, title: text(milestone.title, 180), date: milestone.milestone_date, completed: milestone.completed })),
      upcomingEvents: [...context.events.slice(0, 6).map((event) => ({ id: event.id, title: text(event.title, 180), date: event.start_at, kind: 'event' as const })), ...context.reminders.slice(0, 6).map((reminder) => ({ id: reminder.id, title: text(reminder.title, 180), date: reminder.remind_at, kind: 'reminder' as const }))].slice(0, 8),
    },
    recentContext: contextItems.slice(0, 8).flatMap((item) => {
      const resource = sourceFromItem(item as AskLedgerContextItem);
      return resource ? [{ ...resource, title: text((item as AskLedgerContextItem).title, 180), content: text((item as AskLedgerContextItem).content, 700), updatedAt: (item as AskLedgerContextItem).updatedAt ?? null }] : [];
    }),
    semanticEvidence,
  };
};

const resourceCatalog = (context: ProjectIntelligenceContext) => {
  const refs: ProjectResourceRef[] = [{ resourceType: 'project', resourceId: context.project.id }];
  const add = (item: { resourceType?: string; resourceId?: string }) => { if (allowedResourceType(item.resourceType) && item.resourceId) refs.push({ resourceType: item.resourceType, resourceId: item.resourceId }); };
  context.tasks.forEach((item) => add({ resourceType: 'task', resourceId: item.id }));
  context.milestones.forEach((item) => add({ resourceType: 'milestone', resourceId: item.id }));
  context.events.forEach((item) => add({ resourceType: 'event', resourceId: item.id }));
  context.reminders.forEach((item) => add({ resourceType: 'reminder', resourceId: item.id }));
  context.linkedNotes.forEach(add); context.linkedResources.forEach(add); context.recentActivity.forEach((item) => add({ resourceType: 'activity', resourceId: item.id })); context.semanticContext.forEach(add);
  return new Set(refs.map(refKey));
};

const parseJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? value.trim();
  try { return JSON.parse(fenced) as unknown; } catch {}
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)) as unknown; } catch { return null; }
};

const positiveClaim = (value: string, term: RegExp) => term.test(value) && !new RegExp(`(?:no|not|without|none|isn't|is not)\\s+(?:\\w+\\s+){0,2}${term.source}`, 'i').test(value);
const violatesStructuredFacts = (result: ProjectLensResult, request: ProjectLensRequest) => {
  const combined = `${result.summary} ${result.attention?.text ?? ''} ${result.nextStep?.text ?? ''}`.toLowerCase();
  if (!/completed|complete|done/.test(request.project.status.toLowerCase()) && positiveClaim(combined, /\bcompleted\b|\bfinished\b/)) return true;
  if (!request.signals.some((signal) => signal.kind === 'overdue_action' || signal.kind === 'overdue_milestone') && positiveClaim(combined, /\boverdue\b|\bpast due\b/)) return true;
  if (!request.signals.some((signal) => signal.kind === 'blocked') && positiveClaim(combined, /\bblocked\b|\bstuck\b/)) return true;
  const percentages = [...combined.matchAll(/\b(\d{1,3})%/g)].map((match) => Number(match[1]));
  return percentages.some((percentage) => percentage !== request.project.progress);
};

export const validateProjectLensResult = (value: unknown, request: ProjectLensRequest, context: ProjectIntelligenceContext): ProjectLensValidation => {
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
  if (!parsed || typeof parsed !== 'object') return { result: null, rejectionReasons: ['invalid_result'] };
  const raw = parsed as Record<string, unknown>; const summary = text(raw.summary, 520);
  if (!summary) return { result: null, rejectionReasons: ['missing_summary'] };
  const allowed = resourceCatalog(context);
  const sourceArrayHasUnsupportedRef = (candidate: unknown) => Array.isArray(candidate) && candidate.some((source) => {
    if (!source || typeof source !== 'object') return true;
    const item = source as Record<string, unknown>; const resourceType = item.resourceType; const resourceId = text(item.resourceId, 180);
    return !allowedResourceType(resourceType) || !resourceId || !allowed.has(`${resourceType}:${resourceId}`);
  });
  const attentionRaw = raw.attention && typeof raw.attention === 'object' ? (raw.attention as Record<string, unknown>).sources : undefined;
  const nextStepRaw = raw.nextStep && typeof raw.nextStep === 'object' ? (raw.nextStep as Record<string, unknown>).sources : undefined;
  if (sourceArrayHasUnsupportedRef(raw.sources) || sourceArrayHasUnsupportedRef(attentionRaw) || sourceArrayHasUnsupportedRef(nextStepRaw)) return { result: null, rejectionReasons: ['unsupported_source'] };
  const parseSection = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const section = candidate as Record<string, unknown>; const sectionText = text(section.text, 300);
    if (!sectionText) return undefined;
    const sources = Array.isArray(section.sources) ? section.sources.flatMap((source) => {
      if (!source || typeof source !== 'object') return [];
      const item = source as Record<string, unknown>; const resourceType = item.resourceType; const resourceId = text(item.resourceId, 180);
      return allowedResourceType(resourceType) && resourceId && allowed.has(`${resourceType}:${resourceId}`) ? [{ resourceType, resourceId }] : [];
    }).slice(0, 4) : [];
    return { text: sectionText, sources };
  };
  const sources = Array.isArray(raw.sources) ? raw.sources.flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    const item = source as Record<string, unknown>; const resourceType = item.resourceType; const resourceId = text(item.resourceId, 180);
    return allowedResourceType(resourceType) && resourceId && allowed.has(`${resourceType}:${resourceId}`) ? [{ resourceType, resourceId }] : [];
  }).slice(0, 8) : [];
  const result: ProjectLensResult = { summary, attention: parseSection(raw.attention), nextStep: parseSection(raw.nextStep), sources };
  return violatesStructuredFacts(result, request) ? { result: null, rejectionReasons: ['structured_fact_conflict'] } : { result, rejectionReasons: [] };
};

const refFor = (resourceType: ProjectLensResourceType, resourceId: string): ProjectResourceRef => ({ resourceType, resourceId });
export const buildProjectLensFallback = (context: ProjectIntelligenceContext): ProjectLensResult => {
  const project = context.project; const signals = context.signals.filter((signal) => signal.kind !== 'project_state'); const attentionSignal = signals.find((signal) => signal.severity === 'critical') ?? signals.find((signal) => signal.kind === 'missing_next_action') ?? signals.find((signal) => signal.severity === 'warning'); const activeTasks = context.tasks.filter((task) => !/^(completed|complete|done|cancelled|canceled|dismissed)$/i.test(String(task.status ?? ''))); const projectRef = refFor('project', project.id);
  if (!activeTasks.length && !context.milestones.length) return { summary: 'There is no active next action or milestone yet, so the project has no clear path forward.', nextStep: { text: 'Add the first action or milestone to establish momentum.', sources: [projectRef] }, sources: [projectRef] };
  const attentionRef = refFor(attentionSignal?.resourceType ?? 'project', attentionSignal?.resourceId ?? project.id); const nextText = attentionSignal?.kind === 'missing_next_action' ? 'Add the first next action or milestone.' : attentionSignal?.kind === 'blocked' ? 'Resolve the explicitly blocked item or record its dependency.' : attentionSignal?.kind === 'overdue_action' ? 'Resolve or reschedule that work before taking on anything new.' : attentionSignal ? `Review ${attentionSignal.title.toLowerCase()}.` : 'Continue the next active action.';
  const sources = [projectRef, attentionRef].filter((ref, index, all) => index === all.findIndex((item) => refKey(item) === refKey(ref)));
  return { summary: attentionSignal?.detail ?? 'The active work is moving without a stronger signal that needs attention right now.', attention: attentionSignal ? { text: attentionSignal.detail, sources: [attentionRef] } : undefined, nextStep: { text: nextText, sources: [attentionRef] }, sources };
};

export const buildProjectLensPrompt = (request: ProjectLensRequest) => [
  'SYSTEM / PROJECT LENS',
  'Answer: What should I know about this project right now?',
  'Return JSON only: {"summary":"1-2 compact sentences of interpretation","attention":{"text":"one primary observation","sources":[{"resourceType":"task","resourceId":"EXACT_ID"}]},"nextStep":{"text":"one distinct recommended next move","sources":[{"resourceType":"task","resourceId":"EXACT_ID"}]},"sources":[{"resourceType":"project","resourceId":"EXACT_ID"}]}',
  'Write like a thoughtful project note, not a dashboard recap. Identify the most important thing to notice, explain why it matters, and suggest the clearest next move when useful. Do not routinely repeat the project title, status, progress percentage, owner, dates, or task counts because those are already visible in the page. Mention a visible property only when it materially contributes to the insight. Prefer direct language such as "Two exhibition tasks are past due" over "The project has two overdue actions." Avoid robotic phrases like "The project is..." and avoid naming the project unless needed for clarity. If a date genuinely matters, use a natural month and day (for example, October 24), never an ISO date. Do not repeat the same fact in both the observation and next step; each sentence should add something different. Keep the result to 1-2 short paragraphs. Never invent resource IDs, blockers, deadlines, decisions, progress, or events. Exact structured Ledger facts are authoritative and semantic evidence cannot override them. Workspace-related semantic evidence is possibly related context, not established project fact. Recommendations must be grounded in visible project state.',
  `AUTHORITATIVE STRUCTURED PROJECT FACTS:\n${JSON.stringify({ project: request.project, signals: request.signals, currentWork: request.currentWork })}`,
  `LINKED PROJECT CONTEXT:\n${JSON.stringify(request.recentContext)}`,
  `SEMANTIC EVIDENCE:\n${JSON.stringify(request.semanticEvidence)}`,
].join('\n\n');

export const buildProjectLensActionPrompt = (action: ProjectLensAction, request: ProjectLensRequest) => [
  'SYSTEM / PROJECT LENS ACTION',
  `Action: ${action}`,
  'Return JSON only. Exact structured Ledger facts are authoritative. Never invent blockers, dates, decisions, completed work, or resource IDs.',
  'Linked project context is established context. Workspace-related semantic evidence is only possibly related and must remain labeled that way.',
  'Go directly to the requested action result. Do not restate the project title, status, progress, dates, or counts unless one is necessary to explain the result. Never use ISO dates in visible text; use a natural month and day only when timing matters. Keep the writing concise, specific, and grounded in the provided resources.',
  action === 'catch_up' ? 'Focus on meaningful recent changes and unresolved items since the last activity, not a full project summary. Explain what changed and what is now worth watching.' : '',
  action === 'find_blockers' ? 'Separate confirmed blockers from possible blockers. Use "confirmed" only for direct structured evidence; label inferences as "possible". Never present an inferred blocker as confirmed.' : '',
  action === 'next_steps' ? 'Return no more than three prioritized, read-only recommendations. Each should name a concrete action and briefly explain why it matters. Do not add generic filler about reviewing the project or aligning objectives.' : '',
  action === 'prepare_actions' ? 'Return suggestions only. Nothing is created or modified. Make each suggestion specific and avoid duplicating existing active actions.' : '',
  action === 'find_context' ? 'Return only high-confidence possibly related resources that are not already linked to this project. Explain the connection briefly when useful.' : '',
  action === 'find_blockers'
    ? '{"action":"find_blockers","summary":"...","blockers":[{"text":"...","kind":"confirmed|possible","sources":[]}],"sources":[]}'
    : action === 'prepare_actions'
      ? '{"action":"prepare_actions","summary":"...","proposedActions":[{"title":"...","description":"...","suggestedDueDate":"YYYY-MM-DD","reason":"...","sourceRefs":[]}],"sources":[]}'
      : action === 'find_context'
        ? '{"action":"find_context","summary":"...","relatedResources":[],"sources":[]}'
        : '{"action":"' + action + '","summary":"...","items":[{"text":"...","sources":[]}],"sources":[]}',
  `AUTHORITATIVE STRUCTURED FACTS:\n${JSON.stringify({ project: request.project, signals: request.signals, currentWork: request.currentWork })}`,
  `LINKED PROJECT CONTEXT:\n${JSON.stringify(request.recentContext)}`,
  `SEMANTIC EVIDENCE:\n${JSON.stringify(request.semanticEvidence)}`,
].filter(Boolean).join('\n\n');

const actionSourceRefs = (value: unknown, allowed: Set<string>): ProjectResourceRef[] | null => {
  if (!Array.isArray(value)) return [];
  const refs: ProjectResourceRef[] = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    const resourceType = item.resourceType;
    const resourceId = text(item.resourceId, 180);
    if (!allowedResourceType(resourceType) || !resourceId || !allowed.has(`${resourceType}:${resourceId}`)) return null;
    refs.push({ resourceType, resourceId });
  }
  return refs;
};

export const validateProjectLensActionResult = (value: unknown, action: ProjectLensAction, context: ProjectIntelligenceContext): { result: ProjectLensActionResult | null; rejectionReasons: string[] } => {
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
  if (!parsed || typeof parsed !== 'object') return { result: null, rejectionReasons: ['invalid_result'] };
  const raw = parsed as Record<string, unknown>;
  const summary = text(raw.summary, 520);
  const allowed = resourceCatalog(context);
  const sources = actionSourceRefs(raw.sources, allowed);
  if (!summary || !sources) return { result: null, rejectionReasons: ['invalid_output'] };
  const result: ProjectLensActionResult = { action, summary, sources };
  if (action === 'find_blockers') {
    if (!Array.isArray(raw.blockers)) return { result: null, rejectionReasons: ['invalid_output'] };
    const blockers: NonNullable<ProjectLensActionResult['blockers']> = [];
    for (const rawBlocker of raw.blockers.slice(0, 5)) {
      if (!rawBlocker || typeof rawBlocker !== 'object') return { result: null, rejectionReasons: ['invalid_output'] };
      const blocker = rawBlocker as Record<string, unknown>;
      const refs = actionSourceRefs(blocker.sources, allowed);
      if (!refs || typeof blocker.text !== 'string' || (blocker.kind !== 'confirmed' && blocker.kind !== 'possible')) return { result: null, rejectionReasons: ['invalid_output'] };
      blockers.push({ text: text(blocker.text, 400), kind: blocker.kind, sources: refs });
    }
    result.blockers = blockers;
  } else if (action === 'prepare_actions') {
    if (!Array.isArray(raw.proposedActions)) return { result: null, rejectionReasons: ['invalid_output'] };
    const proposedActions: ProposedProjectAction[] = [];
    for (const rawProposal of raw.proposedActions.slice(0, 3)) {
      if (!rawProposal || typeof rawProposal !== 'object') return { result: null, rejectionReasons: ['invalid_output'] };
      const proposal = rawProposal as Record<string, unknown>;
      const refs = actionSourceRefs(proposal.sourceRefs, allowed);
      if (!refs || typeof proposal.title !== 'string' || typeof proposal.reason !== 'string') return { result: null, rejectionReasons: ['invalid_output'] };
      proposedActions.push({ title: text(proposal.title, 240), reason: text(proposal.reason, 400), ...(typeof proposal.description === 'string' ? { description: text(proposal.description, 500) } : {}), ...(typeof proposal.suggestedDueDate === 'string' ? { suggestedDueDate: text(proposal.suggestedDueDate, 20) } : {}), sourceRefs: refs });
    }
    result.proposedActions = proposedActions;
  } else if (action === 'find_context') {
    const refs = actionSourceRefs(raw.relatedResources, allowed);
    if (!refs) return { result: null, rejectionReasons: ['invalid_output'] };
    result.relatedResources = refs.filter((ref) => context.semanticContext.some((item) => item.resourceType === ref.resourceType && item.resourceId === ref.resourceId && item.metadata?.context_scope === 'workspace_related_context'));
  } else {
    if (!Array.isArray(raw.items)) return { result: null, rejectionReasons: ['invalid_output'] };
    const items: NonNullable<ProjectLensActionResult['items']> = [];
    for (const rawItem of raw.items.slice(0, action === 'next_steps' ? 3 : 6)) {
      if (!rawItem || typeof rawItem !== 'object') return { result: null, rejectionReasons: ['invalid_output'] };
      const item = rawItem as Record<string, unknown>;
      const refs = actionSourceRefs(item.sources, allowed);
      if (!refs || typeof item.text !== 'string') return { result: null, rejectionReasons: ['invalid_output'] };
      items.push({ text: text(item.text, 400), sources: refs });
    }
    result.items = items;
  }
  return { result, rejectionReasons: [] };
};

export const validateProjectChangeProposals = (proposals: ProjectChangeProposal[], context: ProjectIntelligenceContext): ProjectChangeProposal[] => {
  const allowed = resourceCatalog(context);
  const validRef = (ref: ProjectResourceRef) => allowed.has(`${ref.resourceType}:${ref.resourceId}`);
  return proposals.filter((proposal) => {
    if (proposal.type === 'link_resource') return ['note', 'event', 'reminder', 'task'].includes(proposal.resource.resourceType) && validRef(proposal.resource);
    if (!proposal.title.trim() || proposal.title.length > 240) return false;
    if (proposal.type === 'create_action' && proposal.sourceRefs.every(validRef)) return true;
    if (proposal.type === 'create_reminder' && proposal.sourceRefs.every(validRef)) return true;
    return false;
  }).slice(0, 3);
};
