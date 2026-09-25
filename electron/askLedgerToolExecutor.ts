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
  timeZone?: string;
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

  if (/\b(?:free time|free slots?|open slots?|available time|availability|when can i fit|where can i fit|make room for|block out)\b/i.test(value)) {
    const duration = value.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours?|hrs?)\b/i);
    const days = value.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/i);
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const parse = (match: RegExpMatchArray | null, fallback: number) => match ? words[match[1].toLowerCase()] ?? Number(match[1]) : fallback;
    return { name: 'find_weekly_availability', arguments: { durationMinutes: parse(duration, 2) * 60, days: parse(days, 1) } };
  }

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

const localParts = (value: Date, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
};

const dateKey = (parts: { year: number; month: number; day: number }) => `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
const addDays = (date: Date, amount: number) => { const result = new Date(date); result.setDate(result.getDate() + amount); return result; };
const formatClock = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
};

const findWeeklyAvailability = (args: Record<string, unknown>, context: AskLedgerToolExecutionContext): AskLedgerToolExecutionResult => {
  const durationMinutes = Math.max(30, Math.min(480, Number(args.durationMinutes) || 120));
  const requestedDays = Math.max(1, Math.min(7, Number(args.days) || 1));
  const now = context.now ?? new Date();
  const today = localParts(now, context.timeZone);
  const todayKey = dateKey(today);
  const currentMinutes = today.hour * 60 + today.minute;
  const sunday = new Date(today.year, today.month - 1, today.day);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekKeys = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(sunday, index);
    return dateKey({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
  });
  const futureKeys = new Set(weekKeys.filter((key) => key >= todayKey));
  const blockers = new Map<string, Array<{ start: number; end: number }>>();
  const sourceItems: AskLedgerContextItem[] = [];
  for (const item of context.items) {
    if (!['event', 'reminder'].includes(item.resourceType) || (!item.timestamp && !item.dueAt)) continue;
    const parsed = Date.parse(item.timestamp ?? item.dueAt ?? '');
    if (!Number.isFinite(parsed)) continue;
    const startParts = localParts(new Date(parsed), context.timeZone);
    const key = dateKey(startParts);
    if (!futureKeys.has(key)) continue;
    const start = startParts.hour * 60 + startParts.minute;
    const endParsed = item.endAt ? Date.parse(item.endAt) : Number.NaN;
    const endParts = Number.isFinite(endParsed) ? localParts(new Date(endParsed), context.timeZone) : undefined;
    const end = endParts && dateKey(endParts) === key ? endParts.hour * 60 + endParts.minute : start + (item.timestamp ? 60 : 30);
    const entries = blockers.get(key) ?? [];
    entries.push({ start, end: Math.max(start + 1, end) });
    blockers.set(key, entries);
    sourceItems.push(item);
  }
  const slots: Array<{ date: string; day: string; start: string; end: string; durationMinutes: number }> = [];
  for (const key of weekKeys) {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 0 || date.getDay() === 6 || !futureKeys.has(key)) continue;
    const dayStart = key === todayKey ? Math.min(1020, Math.max(540, Math.ceil(currentMinutes / 30) * 30)) : 540;
    const intervals = (blockers.get(key) ?? []).map(({ start, end }) => ({ start: Math.max(dayStart, start), end: Math.min(1020, end) })).filter(({ start, end }) => end > start).sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push(interval);
    }
    const occupied = [{ start: dayStart, end: dayStart }, ...merged, { start: 1020, end: 1020 }];
    for (let index = 0; index < occupied.length - 1; index += 1) {
      const start = occupied[index].end;
      const end = occupied[index + 1].start;
      if (end - start >= durationMinutes) {
        slots.push({ date: key, day: date.toLocaleDateString('en-US', { weekday: 'long' }), start: formatClock(start), end: formatClock(start + durationMinutes), durationMinutes });
        break;
      }
    }
  }
  return {
    toolName: 'find_weekly_availability',
    kind: 'compute',
    data: { requestedDurationMinutes: durationMinutes, requestedDays, workingHoursAssumption: 'Weekdays, 9:00 AM–5:00 PM', slots: slots.slice(0, requestedDays), foundRequestedDays: slots.length >= requestedDays, consideredCalendarItems: sourceItems.length },
    sourceRefs: sourceItems.map(sourceRef),
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
  if (call.name === 'find_weekly_availability') return findWeeklyAvailability(args, context);
  if (call.name === 'find_project_blockers') return findProjectBlockers(args, context);
  throw new Error(`No deterministic executor is registered for ${call.name}.`);
};
