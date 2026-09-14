import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerInitialContext } from '../src/types/askLedgerContext.ts';
import { getAskLedgerTool } from '../src/shared/askLedger/tools.ts';

export type AskLedgerDeterministicToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type AskLedgerToolExecutionContext = {
  workspaceId: string;
  items: AskLedgerContextItem[];
  now?: Date;
};

export type AskLedgerToolExecutionResult = {
  toolName: string;
  kind: 'compute';
  data: Record<string, unknown>;
  sourceRefs: Array<{
    resourceType: AskLedgerContextItem['resourceType'];
    resourceId: string;
    title: string;
  }>;
};

/** Keep the first intent bridge explicit until model-facing tool calls have audit and confirmation semantics. */
export const resolveDeterministicAskLedgerToolCall = (
  question: string,
  explicitContext?: AskLedgerInitialContext
): AskLedgerDeterministicToolCall | undefined => {
  const value = question.toLowerCase().replace(/[’']/g, '').trim();
  const asksForTodayPlan =
    /\b(?:plan my day|priorit(?:y|ies) for today|what should i do today|what do i need to do today|todays? focus|set my focus)\b/i.test(
      value
    ) ||
    (/\btoday\b/i.test(value) && /\b(?:plan|priorit(?:y|ies)|focus|next actions?)\b/i.test(value));
  if (asksForTodayPlan) return { name: 'compute_daily_plan', arguments: { maxFocusItems: 3 } };

  const projectId =
    explicitContext?.resourceType === 'project'
      ? explicitContext.projectId ?? explicitContext.resourceId
      : undefined;
  if (
    projectId &&
    /\b(?:blockers?|blocking|blocked|stuck|at risk|holding us up|waiting on)\b/i.test(value)
  ) {
    return { name: 'find_project_blockers', arguments: { projectId } };
  }
  return undefined;
};

const text = (item: AskLedgerContextItem) =>
  `${item.title} ${item.status ?? ''} ${item.content}`.toLowerCase();
const open = (item: AskLedgerContextItem) =>
  !/^(completed|complete|done|cancelled|canceled)$/i.test(item.status?.trim() ?? '');
const key = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) =>
  `${item.resourceType}:${item.resourceId}`;
const sourceRef = (item: AskLedgerContextItem) => ({
  resourceType: item.resourceType,
  resourceId: item.resourceId,
  title: item.title,
});

const parseLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  return Math.max(1, Math.min(max, parsed));
};

const ensureArguments = (call: AskLedgerDeterministicToolCall) => {
  if (call.arguments && (typeof call.arguments !== 'object' || Array.isArray(call.arguments)))
    throw new Error('Tool arguments must be an object.');
  return call.arguments ?? {};
};

const computeDailyPlan = (
  args: Record<string, unknown>,
  context: AskLedgerToolExecutionContext
): AskLedgerToolExecutionResult => {
  const limit = parseLimit(args.maxFocusItems, 3, 3);
  const now = context.now ?? new Date();
  const nowTime = now.getTime();
  const candidates = context.items
    .filter((item) => ['task', 'milestone', 'reminder'].includes(item.resourceType) && open(item))
    .map((item) => {
      const dueTime = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
      const overdue = Number.isFinite(dueTime) && dueTime < nowTime;
      const dueSoon = Number.isFinite(dueTime) && dueTime - nowTime <= 2 * 86400000;
      const priority = /urgent|high/i.test(item.priority ?? '')
        ? 2
        : /medium/i.test(item.priority ?? '')
        ? 1
        : 0;
      const score =
        (overdue ? 5 : dueSoon ? 3 : 0) + priority + (item.resourceType === 'task' ? 1 : 0);
      return { item, score, overdue, dueSoon };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (Date.parse(left.item.dueAt ?? '') || Number.MAX_SAFE_INTEGER) -
          (Date.parse(right.item.dueAt ?? '') || Number.MAX_SAFE_INTEGER) ||
        left.item.title.localeCompare(right.item.title)
    );
  const selected = candidates.slice(0, limit);
  return {
    toolName: 'compute_daily_plan',
    kind: 'compute',
    data: {
      date: typeof args.date === 'string' ? args.date : now.toISOString().slice(0, 10),
      focus: selected.map(({ item, overdue, dueSoon }) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        title: item.title,
        projectId: item.projectId,
        dueAt: item.dueAt,
        reason: overdue ? 'overdue' : dueSoon ? 'due soon' : 'open work',
      })),
      consideredCount: candidates.length,
    },
    sourceRefs: selected.map(({ item }) => sourceRef(item)),
  };
};

const findProjectBlockers = (
  args: Record<string, unknown>,
  context: AskLedgerToolExecutionContext
): AskLedgerToolExecutionResult => {
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  if (!projectId) throw new Error('projectId is required.');
  const projectItems = context.items.filter(
    (item) =>
      (item.resourceId === projectId && item.resourceType === 'project') ||
      item.projectId === projectId
  );
  const blockers = projectItems.filter(
    (item) =>
      open(item) && /blocked|blocking|stuck|overdue|at risk|waiting on|dependency/i.test(text(item))
  );
  const openWork = projectItems.filter(
    (item) => open(item) && ['task', 'milestone', 'reminder'].includes(item.resourceType)
  );
  const refs = [
    ...new Map(
      [...blockers, ...openWork.slice(0, 3)].map((item) => [key(item), sourceRef(item)])
    ).values(),
  ];
  return {
    toolName: 'find_project_blockers',
    kind: 'compute',
    data: {
      projectId,
      blockers: blockers.slice(0, 8).map((item) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        title: item.title,
        status: item.status,
      })),
      missingNextAction: openWork.length === 0,
      consideredCount: projectItems.length,
    },
    sourceRefs: refs,
  };
};

export const executeDeterministicAskLedgerTool = (
  call: AskLedgerDeterministicToolCall,
  context: AskLedgerToolExecutionContext
): AskLedgerToolExecutionResult => {
  if (!context.workspaceId.trim()) throw new Error('A workspace is required.');
  const tool = getAskLedgerTool(call.name);
  if (!tool) throw new Error(`Unknown Ledger tool: ${call.name}.`);
  if (tool.kind !== 'compute' || tool.implementation !== 'deterministic_planned')
    throw new Error(`Tool ${call.name} is not available to the deterministic executor.`);
  const args = ensureArguments(call);
  if (call.name === 'compute_daily_plan') return computeDailyPlan(args, context);
  if (call.name === 'find_project_blockers') return findProjectBlockers(args, context);
  throw new Error(`No deterministic executor is registered for ${call.name}.`);
};
