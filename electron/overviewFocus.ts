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
    if (tasks.length >= 2) signals.push({ kind: 'deadline_cluster', resourceRefs: tasks.map((task) => ({ type: 'task' as const, id: task.id })), detail: `${tasks.length} unfinished tasks are due on ${day}.` });
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

export const buildOverviewFocusPrompt = (snapshot: OverviewFocusSnapshot, now = new Date()) => {
  const allowedIds = [...snapshot.tasks.map((item) => resourceKey('task', item.id)), ...snapshot.projects.map((item) => resourceKey('project', item.id)), ...snapshot.events.map((item) => resourceKey('event', item.id)), ...snapshot.recentNotes.map((item) => resourceKey('note', item.id))];
  const signals = deriveOverviewFocusSignals(snapshot, now);
  return `SYSTEM / OVERVIEW FOCUS\nYou identify only the few things in a Ledger workspace that genuinely deserve attention.\n\nRules:\n- Return JSON only: {"insights": []}.\n- Return 0 to 3 insights maximum; zero is preferred over filler.\n- Prefer overdue work, approaching deadlines, multiple related unfinished tasks, deadline/progress mismatches, and concentrated upcoming workload.\n- Interpret relationships; do not repeat visible counters or give generic productivity advice.\n- Routine calendar activity, completed work, low-importance isolated items, and ordinary busy days are not insights.\n- Do not manufacture urgency. Never call ordinary work critical, urgent, or an emergency.\n- Do not infer facts outside the snapshot. Do not repeat substantially similar insights.\n- Each resourceRefs entry must use one of these exact type:id values: ${allowedIds.join(', ') || '(none)'}.\n- Keep titles under 100 characters and summaries under 280 characters.\n- importance is only normal or attention.\n\nDeterministic signals to interpret (not facts beyond the snapshot):\n${signals.map((signal) => `- ${signal.kind}: ${signal.detail}`).join('\n') || '- none'}\n\nCurrent time: ${now.toISOString()}\nSnapshot:\n${JSON.stringify(snapshot)}\n`;
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
    if (/\b(urgent|critical|emergency|crisis|catastrophic|must act now|immediately|asap|right now)\b/.test(lowerText)) { rejectionReasons.push('unsupported_urgency'); continue; }
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

const parseJson = (answer: string) => {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? answer;
  try { return JSON.parse(fenced); } catch { return null; }
};

export class OverviewFocusService {
  private readonly localAI: LocalAIService;

  constructor(localAI: LocalAIService) { this.localAI = localAI; }

  async generate(snapshot: OverviewFocusSnapshot): Promise<OverviewFocusResult> {
    if (!snapshot.workspaceId) return { insights: [] };
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
    const prompt = buildOverviewFocusPrompt(snapshot);
    return new Promise((resolve) => {
      let answer = '';
      let settled = false;
      const finish = (result: OverviewFocusResult) => { if (settled) return; settled = true; resolve(result); };
      const requestId = `overview-focus-${Date.now()}`;
      const timeout = setTimeout(() => { this.localAI.cancel(requestId); if (process.env.NODE_ENV !== 'production' && !process.execArgv.includes('--test')) console.warn('[overview-focus] generation timed out'); finish({ insights: [] }); }, 95_000);
      this.localAI.start({ question: 'Generate Overview Focus insights.', context: prompt, reasoningSignals: { answerDepth: 'brief', generationDepth: 'standard', retrievalRequired: false, routeReason: 'overview_focus' } }, {
        onEvent: (event: LocalAIStreamEvent) => {
          if (event.type === 'delta') answer += event.text ?? '';
          if (event.type === 'done' || event.type === 'error') {
            clearTimeout(timeout);
            const validation = event.type === 'error' ? { result: { insights: [] }, rawInsightCount: 0, rejectionReasons: ['invalid_result' as const] } : validateOverviewFocusResultWithDiagnostics(parseJson(answer), snapshot);
            if (process.env.NODE_ENV !== 'production' && !process.execArgv.includes('--test')) console.info('[overview-focus] generation complete', { modelTier: this.localAI.getGenerationRuntimeState?.().selectedTier, snapshot: { tasks: snapshot.tasks.length, projects: snapshot.projects.length, events: snapshot.events.length, notes: snapshot.recentNotes.length }, promptChars: prompt.length, answerChars: answer.length, durationMs: Date.now() - startedAt, modelDurationMs: event.type === 'done' ? event.metrics?.totalMs : undefined, rawInsightCount: validation.rawInsightCount, acceptedInsightCount: validation.result.insights.length, rejectionReasons: validation.rejectionReasons });
            finish(validation.result);
          }
        },
      }, requestId);
    });
  }
}
