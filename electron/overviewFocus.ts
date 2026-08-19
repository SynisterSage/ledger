import type { LocalAIService, LocalAIStreamEvent } from './localAIService.ts';
import type { OverviewFocusInsight, OverviewFocusResourceType, OverviewFocusResult, OverviewFocusSnapshot } from '../src/types/overviewFocus.ts';
export { buildOverviewFocusSnapshot } from '../src/types/overviewFocus.ts';
export type { OverviewFocusInsight, OverviewFocusResourceType, OverviewFocusResult, OverviewFocusSnapshot } from '../src/types/overviewFocus.ts';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const resourceKey = (type: OverviewFocusResourceType, id: string) => `${type}:${id}`;
const parseFocusDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59.999Z`) : Date.parse(value);

export type OverviewFocusSignal = {
  kind: 'overdue_task' | 'approaching_deadline' | 'deadline_cluster' | 'project_concentration' | 'project_deadline_progress' | 'event_workload';
  resourceRefs: Array<{ type: OverviewFocusResourceType; id: string }>;
  detail: string;
};

export const deriveOverviewFocusSignals = (snapshot: OverviewFocusSnapshot, now = new Date()): OverviewFocusSignal[] => {
  const nowMs = now.getTime();
  const openTasks = snapshot.tasks.filter((task) => !/^(completed|complete|done|cancelled|canceled)$/i.test(task.status));
  const signals: OverviewFocusSignal[] = [];
  for (const task of openTasks) {
    const lowImportance = /^(low|minor|none)$/i.test(task.priority ?? '');
    const dueMs = task.dueAt ? parseFocusDate(task.dueAt) : NaN;
    if (Number.isFinite(dueMs) && dueMs < nowMs && (!lowImportance || task.projectId)) signals.push({ kind: 'overdue_task', resourceRefs: [{ type: 'task', id: task.id }], detail: `${task.title} is past its due date.` });
    else if (Number.isFinite(dueMs) && dueMs - nowMs <= 48 * 60 * 60 * 1000) signals.push({ kind: 'approaching_deadline', resourceRefs: [{ type: 'task', id: task.id }], detail: `${task.title} is due within two days.` });
  }
  const dueSoon = openTasks.filter((task) => {
    const dueMs = task.dueAt ? parseFocusDate(task.dueAt) : NaN;
    return Number.isFinite(dueMs) && dueMs >= nowMs && dueMs - nowMs <= 48 * 60 * 60 * 1000;
  });
  const dueByDay = new Map<string, typeof dueSoon>();
  dueSoon.forEach((task) => {
    const day = task.dueAt?.slice(0, 10) ?? '';
    if (day) dueByDay.set(day, [...(dueByDay.get(day) ?? []), task]);
  });
  for (const [day, tasks] of dueByDay) {
    if (tasks.length >= 2) {
      const today = now.toISOString().slice(0, 10);
      const tomorrow = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dayLabel = day === today ? 'today' : day === tomorrow ? 'tomorrow' : day;
      signals.push({ kind: 'deadline_cluster', resourceRefs: tasks.map((task) => ({ type: 'task' as const, id: task.id })), detail: `${tasks.length} unfinished tasks are due ${dayLabel}.` });
    }
  }
  const byProject = new Map<string, typeof openTasks>();
  openTasks.forEach((task) => { if (task.projectId) byProject.set(task.projectId, [...(byProject.get(task.projectId) ?? []), task]); });
  for (const [projectId, tasks] of byProject) {
    if (tasks.length >= 2) signals.push({ kind: 'project_concentration', resourceRefs: [{ type: 'project', id: projectId }, ...tasks.map((task) => ({ type: 'task' as const, id: task.id }))], detail: `${tasks.length} unfinished tasks are connected to the same project.` });
  }
  for (const project of snapshot.projects) {
    const dueMs = project.dueAt ? parseFocusDate(project.dueAt) : NaN;
    const nearDeadline = Number.isFinite(dueMs) && dueMs >= nowMs && dueMs - nowMs <= 7 * 24 * 60 * 60 * 1000;
    const overdue = Number.isFinite(dueMs) && dueMs < nowMs;
    if (project.dueAt && project.progress !== undefined && project.progress < 50 && (nearDeadline || overdue)) signals.push({ kind: 'project_deadline_progress', resourceRefs: [{ type: 'project', id: project.id }], detail: `${project.title} has a nearby deadline and is only ${project.progress}% complete.` });
  }
  return signals.slice(0, 32);
};

export type OverviewFocusValidationRejection = 'invalid_result' | 'missing_resource' | 'completed_resource' | 'weak_observation' | 'unsupported_urgency' | 'duplicate' | 'too_long' | 'too_many';
export type OverviewFocusValidation = { result: OverviewFocusResult; rawInsightCount: number; rejectionReasons: OverviewFocusValidationRejection[] };
export type OverviewFocusGenerationOptions = { previousResult?: OverviewFocusResult };

export const buildOverviewFocusPrompt = (snapshot: OverviewFocusSnapshot, now = new Date(), previousResult?: OverviewFocusResult) => {
  const signals = deriveOverviewFocusSignals(snapshot, now);
  const relevantKeys = new Set(signals.flatMap((signal) => signal.resourceRefs.map((ref) => resourceKey(ref.type, ref.id))));
  const relevantTasks = snapshot.tasks.filter((item) => relevantKeys.has(resourceKey('task', item.id)));
  const relevantProjects = snapshot.projects.filter((item) => relevantKeys.has(resourceKey('project', item.id)));
  const relevantEvents = snapshot.events.filter((item) => relevantKeys.has(resourceKey('event', item.id)));
  const relevantNotes = snapshot.recentNotes.filter((item) => relevantKeys.has(resourceKey('note', item.id)));
  const clean = (value: string | undefined) => (value ?? '').replace(/[|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  const taskLines = relevantTasks.map((item) => ['task', item.id, item.title, item.status, item.dueAt, item.priority, item.projectId, item.projectTitle].map(clean).join('|')).join('\n') || '(none)';
  const projectLines = relevantProjects.map((item) => ['project', item.id, item.title, item.status, item.dueAt, item.progress === undefined ? '' : String(item.progress)].map(clean).join('|')).join('\n') || '(none)';
  const eventLines = relevantEvents.map((item) => ['event', item.id, item.title, item.startsAt, item.endsAt].map(clean).join('|')).join('\n') || '(none)';
  const noteLines = relevantNotes.map((item) => ['note', item.id, item.title, item.updatedAt].map(clean).join('|')).join('\n') || '(none)';
  const previous = previousResult?.insights?.slice(0, 3).map((insight) => `${insight.title} — ${insight.summary}`).join('\n') || '(none)';
  return `SYSTEM / OVERVIEW FOCUS\nFind 0-3 non-obvious things that genuinely deserve attention in this Ledger Overview.\nReturn one compact JSON line only, with this shape: {"insights":[{"id":"focus-1","title":"","summary":"","importance":"normal","resourceRefs":[{"type":"task","id":"EXACT_ID"}]}]}.\nUse 0 insights when no meaningful signal exists. If there are multiple distinct meaningful signal categories, prefer 2-3 separate insights instead of merging everything into one. Every insight must include at least one resourceRefs entry copied exactly from the resource lists below. Never invent IDs. Keep title <80 chars and summary <160 chars.\nPrefer overdue/time-sensitive unfinished work, related tasks, deadline/progress mismatch, and concentrated workload. Suppress counters, routine events, completed work, weak observations, and generic advice.\nUse calm factual wording such as “past due”, “due tomorrow”, “29% complete”, or “needs attention”. Never use urgent, critical, emergency, crisis, ASAP, immediate, immediately, or “must act now”; ordinary overdue work is not automatically urgent. Never copy ISO date strings into titles; say today, tomorrow, or use a natural month/day date.\nIf prior Focus insights are provided below, look for a different useful angle when possible. Do not repeat them word-for-word; retain them only if they remain the strongest supported signals.\n\nPrior Focus insights:\n${previous}\n\nSignals:\n${signals.map((signal) => `- ${signal.kind}: ${signal.detail} refs=${signal.resourceRefs.map((ref) => `${ref.type}:${ref.id}`).join(',')}`).join('\n') || '- none'}\n\nResources are pipe-delimited: type|id|title|status|due/time|priority-or-progress|project-id|project-title.\nTasks:\n${taskLines}\nProjects:\n${projectLines}\nEvents:\n${eventLines}\nNotes:\n${noteLines}\nNow: ${now.toISOString()}`;
};

const isResourceType = (value: unknown): value is OverviewFocusResourceType => value === 'task' || value === 'project' || value === 'event' || value === 'note';

const tokenize = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
const overlap = (left: Set<string>, right: Set<string>) => {
  let shared = 0;
  left.forEach((token) => { if (right.has(token)) shared += 1; });
  return shared / Math.max(1, Math.min(left.size, right.size));
};

export const validateOverviewFocusResultWithDiagnostics = (value: unknown, snapshot: OverviewFocusSnapshot): OverviewFocusValidation => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { insights?: unknown }).insights)) return { result: { insights: [] }, rawInsightCount: 0, rejectionReasons: ['invalid_result'] };
  const rawInsights = (value as { insights: unknown[] }).insights;
  const allowed = new Set<string>([
    ...snapshot.tasks.map((item) => resourceKey('task', item.id)),
    ...snapshot.projects.map((item) => resourceKey('project', item.id)),
    ...snapshot.events.map((item) => resourceKey('event', item.id)),
    ...snapshot.recentNotes.map((item) => resourceKey('note', item.id)),
  ]);
  const taskById = new Map(snapshot.tasks.map((item) => [item.id, item]));
  const projectById = new Map(snapshot.projects.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const acceptedText: Set<string>[] = [];
  const insights: OverviewFocusInsight[] = [];
  const rejectionReasons: OverviewFocusValidationRejection[] = [];
  for (const raw of rawInsights) {
    if (insights.length >= 3) { rejectionReasons.push('too_many'); continue; }
    if (!raw || typeof raw !== 'object') { rejectionReasons.push('invalid_result'); continue; }
    const item = raw as Record<string, unknown>;
    const title = text(item.title);
    const summary = text(item.summary);
    if (title.length > 100 || summary.length > 280) { rejectionReasons.push('too_long'); continue; }
    const refs = Array.isArray(item.resourceRefs) ? item.resourceRefs.flatMap((ref) => {
      if (!ref || typeof ref !== 'object') return [];
      const type = (ref as Record<string, unknown>).type;
      const id = text((ref as Record<string, unknown>).id);
      return isResourceType(type) && allowed.has(resourceKey(type, id)) ? [{ type, id }] : [];
    }) : [];
    if (!title || !summary || !refs.length) { rejectionReasons.push('missing_resource'); continue; }
    if (refs.some((ref) => ref.type === 'task' && /^(completed|complete|done|cancelled|canceled)$/i.test(taskById.get(ref.id)?.status ?? '') || ref.type === 'project' && (/^(completed|complete|done|cancelled|canceled)$/i.test(projectById.get(ref.id)?.status ?? '') || (projectById.get(ref.id)?.progress ?? 0) >= 100))) { rejectionReasons.push('completed_resource'); continue; }
    const lowerText = `${title} ${summary}`.toLowerCase();
    if (/\b(urgent|critical|emergency|crisis|catastrophic|must act now|immediate(?:ly)?|asap|right now)\b/.test(lowerText)) { rejectionReasons.push('unsupported_urgency'); continue; }
    const meaningful = /\b(overdue|past due|due|deadline|unfinished|incomplete|behind|progress|connected|related|same project|tomorrow|concentrat|stalled|blocked|needs? attention|near deadline)\b/i.test(lowerText);
    const countOnly = /^\s*(you have|there are|there's)\s+\d+\s+(tasks?|projects?|events?|notes?)\b/i.test(lowerText) && !meaningful;
    if (!meaningful || countOnly) { rejectionReasons.push('weak_observation'); continue; }
    const textTokens = tokenize(lowerText);
    const duplicateKey = `${title.toLowerCase()}|${summary.toLowerCase()}`;
    if (seen.has(duplicateKey) || acceptedText.some((candidate) => overlap(candidate, textTokens) >= 0.8)) { rejectionReasons.push('duplicate'); continue; }
    seen.add(duplicateKey);
    acceptedText.push(textTokens);
    insights.push({ id: text(item.id) || `focus-${insights.length + 1}`, title, summary, importance: item.importance === 'attention' ? 'attention' : 'normal', resourceRefs: refs.slice(0, 8) });
  }
  return { result: { insights }, rawInsightCount: rawInsights.length, rejectionReasons };
};

export const validateOverviewFocusResult = (value: unknown, snapshot: OverviewFocusSnapshot): OverviewFocusResult => validateOverviewFocusResultWithDiagnostics(value, snapshot).result;

export const buildOverviewFocusFallbackResult = (snapshot: OverviewFocusSnapshot): OverviewFocusResult => {
  const signals = deriveOverviewFocusSignals(snapshot);
  const taskTitles = new Map(snapshot.tasks.map((task) => [task.id, task.title]));
  const projectTitles = new Map(snapshot.projects.map((project) => [project.id, project.title]));
  const insights: OverviewFocusInsight[] = [];
  const add = (title: string, summary: string, resourceRefs: OverviewFocusInsight['resourceRefs']) => {
    if (!resourceRefs.length || insights.length >= 3) return;
    insights.push({ id: `focus-fallback-${insights.length + 1}`, title: title.slice(0, 80), summary: summary.slice(0, 160), importance: 'attention', resourceRefs: resourceRefs.slice(0, 8) });
  };
  const overdue = signals.filter((signal) => signal.kind === 'overdue_task');
  if (overdue.length) {
    const refs = overdue.flatMap((signal) => signal.resourceRefs).filter((ref, index, all) => all.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) === index);
    const titles = refs.filter((ref) => ref.type === 'task').map((ref) => taskTitles.get(ref.id)).filter(Boolean).slice(0, 2);
    add(overdue.length > 1 ? `${overdue.length} unfinished tasks are overdue` : `${titles[0] ?? 'An unfinished task'} is overdue`, titles.length > 1 ? `${titles.join(' and ')} are past their due dates.` : `${titles[0] ?? 'This task'} is past its due date.`, refs);
  }
  const clusters = signals.filter((signal) => signal.kind === 'deadline_cluster');
  clusters.forEach((signal) => {
    const detail = signal.detail.replace(/^\d+\s+unfinished tasks are /i, '').replace(/\.$/, '');
    const refs = signal.resourceRefs;
    const titles = refs.filter((ref) => ref.type === 'task').map((ref) => taskTitles.get(ref.id)).filter(Boolean).slice(0, 2);
    add(`Multiple tasks are ${detail}`, titles.length ? `${titles.join(' and ')} ${titles.length === 1 ? 'is' : 'are'} ${detail}.` : signal.detail, refs);
  });
  signals.filter((signal) => signal.kind === 'project_concentration').forEach((signal) => {
    const projectRef = signal.resourceRefs.find((ref) => ref.type === 'project');
    const taskRefs = signal.resourceRefs.filter((ref) => ref.type === 'task');
    const projectTitle = projectRef ? projectTitles.get(projectRef.id) : undefined;
    add(`${projectTitle ?? 'A project'} has multiple unfinished tasks`, `${taskRefs.length} unfinished tasks are connected to the same project.`, signal.resourceRefs);
  });
  signals.filter((signal) => signal.kind === 'project_deadline_progress').forEach((signal) => {
    const projectRef = signal.resourceRefs.find((ref) => ref.type === 'project');
    add(`${projectRef ? projectTitles.get(projectRef.id) ?? 'A project' : 'A project'} needs attention`, signal.detail, signal.resourceRefs);
  });
  if (!insights.length) {
    const approaching = signals.filter((signal) => signal.kind === 'approaching_deadline');
    const refs = approaching.flatMap((signal) => signal.resourceRefs);
    const titles = refs.map((ref) => taskTitles.get(ref.id)).filter(Boolean).slice(0, 2);
    add('Upcoming unfinished work needs attention', titles.length ? `${titles.join(' and ')} are due soon.` : approaching[0]?.detail ?? '', refs);
  }
  return { insights };
};

const parseJson = (answer: string) => {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? answer;
  try { return JSON.parse(fenced); } catch { return null; }
};

export class OverviewFocusService {
  private readonly localAI: LocalAIService;

  constructor(localAI: LocalAIService) { this.localAI = localAI; }

  async generate(snapshot: OverviewFocusSnapshot, options: OverviewFocusGenerationOptions = {}): Promise<OverviewFocusResult> {
    if (!snapshot.workspaceId) return { insights: [] };
    if (deriveOverviewFocusSignals(snapshot).length === 0) return { insights: [] };
    const previousResult = options.previousResult ? validateOverviewFocusResult(options.previousResult, snapshot) : undefined;
    try {
      const route = this.localAI.getModelRouting?.({
        answerDepth: 'standard',
        evidenceCount: Math.max(6, snapshot.tasks.length + snapshot.projects.length + snapshot.events.length),
        resourceTypeCount: 2,
        crossResource: false,
      });
      if (route?.shouldSwitch && this.localAI.switchGenerationTier) await this.localAI.switchGenerationTier(route.recommendedTier);
    } catch {
      return { insights: [] };
    }
    const startedAt = Date.now();
    const prompt = buildOverviewFocusPrompt(snapshot, new Date(), previousResult);
    return new Promise((resolve) => {
      let answer = '';
      let settled = false;
      const finish = (result: OverviewFocusResult) => { if (settled) return; settled = true; resolve(result); };
      const requestId = `overview-focus-${Date.now()}`;
      const timeout = setTimeout(() => { this.localAI.cancel(requestId); if (process.env.NODE_ENV !== 'production' && !process.execArgv.includes('--test')) console.warn('[overview-focus] generation timed out'); finish({ insights: [] }); }, 95_000);
      this.localAI.start({ question: 'Generate Overview Focus insights.', context: prompt, generationBudget: 768, reasoningSignals: { answerDepth: 'brief', generationDepth: 'standard', retrievalRequired: false, routeReason: 'overview_focus' } }, {
        onEvent: (event: LocalAIStreamEvent) => {
          if (event.type === 'delta') answer += event.text ?? '';
          if (event.type === 'done' || event.type === 'error') {
            clearTimeout(timeout);
            const validation = event.type === 'error' ? { result: { insights: [] }, rawInsightCount: 0, rejectionReasons: ['invalid_result' as const] } : validateOverviewFocusResultWithDiagnostics(parseJson(answer), snapshot);
            const priorInsights = previousResult?.insights ?? [];
            const acceptedText = validation.result.insights.map((insight) => tokenize(`${insight.title} ${insight.summary}`));
            const retainedPrior = priorInsights.filter((insight) => {
              const tokens = tokenize(`${insight.title} ${insight.summary}`);
              return !acceptedText.some((candidate) => overlap(candidate, tokens) >= 0.8);
            });
            const fallback = validation.result.insights.length === 0 && validation.rawInsightCount > 0 ? buildOverviewFocusFallbackResult(snapshot) : { insights: [] };
            const result = { insights: [...(validation.result.insights.length ? validation.result.insights : fallback.insights), ...retainedPrior].slice(0, 3) };
            if (process.env.NODE_ENV !== 'production' && !process.execArgv.includes('--test')) console.info('[overview-focus] generation complete', { modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier, snapshot: { tasks: snapshot.tasks.length, projects: snapshot.projects.length, events: snapshot.events.length, notes: snapshot.recentNotes.length }, promptChars: prompt.length, answerChars: answer.length, durationMs: Date.now() - startedAt, modelDurationMs: event.type === 'done' ? event.metrics?.totalMs : undefined, rawInsightCount: validation.rawInsightCount, acceptedInsightCount: result.insights.length, fallbackUsed: fallback.insights.length > 0, retainedPriorCount: retainedPrior.length, rejectionReasons: validation.rejectionReasons });
            finish(result);
          }
        },
      }, requestId);
    });
  }
}
