import type { AskLedgerContextItem, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import { getAskLedgerTool } from '../src/shared/askLedger/tools.ts';

export type AskLedgerReadToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type AskLedgerReadToolContext = {
  workspaceId: string;
  items: AskLedgerContextItem[];
  now?: Date;
};

export type AskLedgerReadToolResult = {
  toolName: string;
  kind: 'read';
  data: Record<string, unknown>;
  sourceRefs: Array<{
    resourceType: AskLedgerResourceType;
    resourceId: string;
    title: string;
  }>;
};

const key = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) =>
  `${item.resourceType}:${item.resourceId}`;
const sourceRef = (item: AskLedgerContextItem) => ({
  resourceType: item.resourceType,
  resourceId: item.resourceId,
  title: item.title,
});
const parseLimit = (value: unknown, fallback = 20) => {
  const parsed = typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  return Math.max(1, Math.min(50, parsed));
};
const stringArg = (args: Record<string, unknown>, name: string) =>
  typeof args[name] === 'string' ? args[name].trim() : '';
const argsFor = (call: AskLedgerReadToolCall) => {
  if (call.arguments && (typeof call.arguments !== 'object' || Array.isArray(call.arguments))) {
    throw new Error('Tool arguments must be an object.');
  }
  return call.arguments ?? {};
};
const itemDate = (item: AskLedgerContextItem) => (item.dueAt ?? item.timestamp ?? '').slice(0, 10);
const open = (item: AskLedgerContextItem) =>
  !/^(completed|complete|done|cancelled|canceled)$/i.test(item.status?.trim() ?? '');
const boundedItem = (item: AskLedgerContextItem, includeContent = true) => ({
  resourceType: item.resourceType,
  resourceId: item.resourceId,
  title: item.title,
  ...(includeContent ? { content: item.content.slice(0, 2000) } : {}),
  projectId: item.projectId,
  status: item.status,
  dueAt: item.dueAt,
  timestamp: item.timestamp,
  endAt: item.endAt,
  priority: item.priority,
  updatedAt: item.updatedAt,
  route: item.route,
});

const scopedItems = (context: AskLedgerReadToolContext) => {
  if (!context.workspaceId.trim()) throw new Error('A workspace is required.');
  return context.items.filter(
    (item) => !item.workspaceId || item.workspaceId === context.workspaceId
  );
};

const resultFor = (
  toolName: string,
  data: Record<string, unknown>,
  items: AskLedgerContextItem[]
): AskLedgerReadToolResult => ({
  toolName,
  kind: 'read',
  data,
  sourceRefs: [...new Map(items.map((item) => [key(item), sourceRef(item)])).values()],
});

export const executeReadAskLedgerTool = (
  call: AskLedgerReadToolCall,
  context: AskLedgerReadToolContext
): AskLedgerReadToolResult => {
  const tool = getAskLedgerTool(call.name);
  if (!tool || tool.kind !== 'read')
    throw new Error(`Tool ${call.name} is not an approved read tool.`);
  const args = argsFor(call);
  const items = scopedItems(context);
  const limit = parseLimit(args.limit);

  if (call.name === 'search_workspace') {
    const query = stringArg(args, 'query').toLowerCase();
    if (!query) throw new Error('query is required.');
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = items
      .map((item) => {
        const haystack = `${item.title} ${item.content} ${item.status ?? ''} ${
          item.projectName ?? ''
        }`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title)
      );
    const selected = matches.slice(0, limit).map(({ item }) => item);
    return resultFor(
      call.name,
      { query, results: selected.map((item) => boundedItem(item)), count: selected.length },
      selected
    );
  }

  if (call.name === 'get_today') {
    const day = stringArg(args, 'date') || (context.now ?? new Date()).toISOString().slice(0, 10);
    const selected = items
      .filter(
        (item) =>
          open(item) &&
          ['task', 'milestone', 'reminder', 'event'].includes(item.resourceType) &&
          itemDate(item) === day
      )
      .slice(0, limit);
    return resultFor(
      call.name,
      { date: day, items: selected.map((item) => boundedItem(item)) },
      selected
    );
  }

  if (call.name === 'list_tasks') {
    const projectId = stringArg(args, 'projectId');
    const status = stringArg(args, 'status').toLowerCase();
    const selected = items
      .filter(
        (item) =>
          item.resourceType === 'task' &&
          (!projectId || item.projectId === projectId) &&
          (!status || String(item.status ?? '').toLowerCase() === status)
      )
      .slice(0, limit);
    return resultFor(
      call.name,
      { tasks: selected.map((item) => boundedItem(item)), count: selected.length },
      selected
    );
  }

  if (call.name === 'list_upcoming_events') {
    const from = stringArg(args, 'from');
    const to = stringArg(args, 'to');
    const start = from || (context.now ?? new Date()).toISOString().slice(0, 10);
    const end =
      to ||
      new Date((context.now ?? new Date()).getTime() + 30 * 86400000).toISOString().slice(0, 10);
    if (from && to && from > to) throw new Error('from must be before to.');
    const selected = items
      .filter(
        (item) =>
          ['event', 'reminder'].includes(item.resourceType) &&
          itemDate(item) >= start &&
          itemDate(item) <= end
      )
      .sort((left, right) => itemDate(left).localeCompare(itemDate(right)))
      .slice(0, limit);
    return resultFor(
      call.name,
      {
        from: start,
        to: end,
        events: selected.map((item) => boundedItem(item)),
        count: selected.length,
      },
      selected
    );
  }

  if (call.name === 'get_project_context') {
    const projectId = stringArg(args, 'projectId');
    if (!projectId) throw new Error('projectId is required.');
    const selected = items
      .filter(
        (item) =>
          (item.resourceType === 'project' && item.resourceId === projectId) ||
          item.projectId === projectId
      )
      .slice(0, limit);
    return resultFor(
      call.name,
      { projectId, items: selected.map((item) => boundedItem(item)) },
      selected
    );
  }

  if (call.name === 'get_note_context') {
    const noteId = stringArg(args, 'noteId');
    if (!noteId) throw new Error('noteId is required.');
    const includeContent = args.includeContent !== false;
    const selected = items
      .filter(
        (item) =>
          (item.resourceType === 'note' && item.resourceId === noteId) || item.noteId === noteId
      )
      .slice(0, limit);
    return resultFor(
      call.name,
      { noteId, items: selected.map((item) => boundedItem(item, includeContent)) },
      selected
    );
  }

  throw new Error(`No read executor is registered for ${call.name}.`);
};
