import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import crypto from 'node:crypto';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_NOTE_CONTENT = 20_000;
const MAX_DATE_RANGE_DAYS = 90;
const mutationBuckets = new Map();
const mutationLimits = { send_to_intake: 20, create_task: 20, create_note: 20, update_task: 60, complete_task: 60, reschedule_task: 60, add_to_focus: 30 };

const decodeCursor = (cursor) => {
  if (!cursor) return 0;
  try {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
};

const encodeCursor = (offset) => Buffer.from(String(offset), 'utf8').toString('base64url');
const limitSchema = z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);
const uuidSchema = z.string().uuid();

const plainText = (value) => String(value ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

const dateOnly = (value, label) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return date;
};

const validateDateRange = (from, to) => {
  const start = dateOnly(from, 'from date');
  const end = dateOnly(to, 'to date');
  if (start && end && end < start) throw new Error('Invalid date range.');
  if (start && end && end.getTime() - start.getTime() > MAX_DATE_RANGE_DAYS * 86400000) {
    throw new Error('Date range is too large.');
  }
};

const textResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

export const createMcpServer = ({ context, supabase, requireWorkspaceAccess, audit, requestScopeUpgrade }) => {
  const workspaceId = context.workspaceId;
  const userId = context.userId;

  const requireScope = (scope) => {
    if (!context.scopes.includes(scope)) throw new Error('Required scope is missing.');
  };

  const query = (table, columns) => supabase.from(table).select(columns).eq('workspace_id', workspaceId);

  const safeError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  };

  const requireMcpMutation = async (scope) => {
    if (!context.scopes.includes(scope)) throw safeError('Additional Ledger permission is required.', 403);
    await requireWorkspaceAccess(userId, workspaceId, 'member');
  };

  const stableJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value ?? null);
  };

  const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

  const withIdempotency = async (toolName, args, createResult) => {
    const key = String(args.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 160) throw safeError('A valid idempotency key is required.');
    const fingerprint = sha256(stableJson({ ...args, idempotencyKey: undefined }));
    const keyHash = sha256(key);
    const payload = { connection_id: context.connectionId ?? context.connection?.id, workspace_id: workspaceId, user_id: userId, tool_name: toolName, idempotency_key_hash: keyHash, request_fingerprint: fingerprint, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
    const inserted = await supabase.from('mcp_idempotency_records').insert(payload).select('id').maybeSingle();
    if (!inserted.error && inserted.data?.id) {
      try {
        const result = await createResult();
        const saved = await supabase.from('mcp_idempotency_records').update({ result_type: result.resultType ?? null, result_id: result.resultId ?? null, result_json: result.payload }).eq('id', inserted.data.id).eq('connection_id', payload.connection_id);
        if (saved.error) throw saved.error;
        return { payload: result.payload, replayed: false };
      } catch (error) {
        await supabase.from('mcp_idempotency_records').delete().eq('id', inserted.data.id).eq('connection_id', payload.connection_id);
        throw error;
      }
    }
    if (inserted.error?.code !== '23505') throw inserted.error ?? safeError('Could not reserve this request.');
    const existing = await supabase.from('mcp_idempotency_records').select('request_fingerprint, result_json, expires_at').eq('connection_id', payload.connection_id).eq('workspace_id', workspaceId).eq('tool_name', toolName).eq('idempotency_key_hash', keyHash).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data || new Date(existing.data.expires_at).getTime() <= Date.now()) throw safeError('This idempotency key has expired.');
    if (existing.data.request_fingerprint !== fingerprint) throw safeError('This idempotency key was already used with a different request.', 409);
    if (!existing.data.result_json) throw safeError('This request is already in progress.', 409);
    await audit('mutation.replayed', { toolName });
    return { payload: existing.data.result_json, replayed: true };
  };

  const mutation = async (toolName, scope, fn) => {
    try {
      const bucketKey = `${context.connection.id}:${toolName}`;
      const now = Date.now();
      const bucket = mutationBuckets.get(bucketKey) ?? { count: 0, resetAt: now + 10 * 60 * 1000 };
      if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 10 * 60 * 1000; }
      bucket.count += 1;
      mutationBuckets.set(bucketKey, bucket);
      if (bucket.count > (mutationLimits[toolName] ?? 20)) throw safeError('Too many changes were requested. Try again soon.', 429);
      await requireMcpMutation(scope);
      const result = await fn();
      await audit('mutation.success', { toolName, targetType: result.targetType ?? null, targetId: result.resultId ?? null, changedFields: result.changedFields ?? [] });
      return result;
    } catch (error) {
      await audit('mutation.failed', { toolName, result: error?.statusCode === 403 ? 'denied' : 'failed' });
      throw error;
    }
  };

  const boundedText = (value, max, label, required = false) => {
    const text = String(value ?? '').trim();
    if (required && !text) throw safeError(`${label} is required.`);
    if (text.length > max) throw safeError(`${label} is too long.`);
    return text || null;
  };

  const validDate = (value, label = 'date', allowNull = false) => {
    if ((value === null || value === undefined || value === '') && allowNull) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw safeError(`Invalid ${label}.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw safeError(`Invalid ${label}.`);
    return String(value);
  };

  const validTime = (value, allowNull = false) => {
    if ((value === null || value === undefined || value === '') && allowNull) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value ?? ''))) throw safeError('Invalid due time.');
    return String(value);
  };

  const ensureProject = async (projectId) => {
    if (!projectId) return null;
    const result = await query('projects', 'id, name').eq('id', projectId).maybeSingle();
    if (result.error || !result.data) throw safeError('The related project is not available in this workspace.', 404);
    return result.data;
  };

  const ensureAssignee = async (assigneeId) => {
    if (!assigneeId) return null;
    const [member, owner] = await Promise.all([
      supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('user_id', assigneeId).maybeSingle(),
      supabase.from('workspaces').select('owner_id').eq('id', workspaceId).eq('owner_id', assigneeId).maybeSingle(),
    ]);
    if (member.error || owner.error || (!member.data && !owner.data)) throw safeError('The assignee is not available in this workspace.', 404);
    return assigneeId;
  };

  const taskSummary = (row) => ({ id: row.id, title: row.title, status: row.status, priority: row.priority ?? undefined, dueDate: row.due_date ?? undefined, dueTime: row.due_time ?? undefined, updatedAt: row.updated_at, url: `ledger://tasks/${encodeURIComponent(row.id)}` });

  const fetchWorkspace = async () => {
    const result = await supabase.from('workspaces').select('id, name, is_personal').eq('id', workspaceId).maybeSingle();
    if (result.error || !result.data) throw new Error('Workspace access is no longer available.');
    return result.data;
  };

  const server = new McpServer({ name: 'ledger', version: '1.0.0' }, {
    instructions: 'Ledger context and narrowly scoped non-destructive planning mutations. Results and writes are restricted to the approved workspace and current user permissions.',
  });
  const readAnnotations = { readOnlyHint: true, destructiveHint: false };

  server.registerResource('ledger-workspace-context', 'ledger://workspace/current/context', {
    description: 'A bounded overview of the approved Ledger workspace.',
    mimeType: 'application/json',
  }, async () => {
    requireScope('workspace:read');
    const workspace = await fetchWorkspace();
    const [projects, tasks, events, accountability] = await Promise.all([
      query('projects', 'id, name, status, completeness, end_date, updated_at').neq('status', 'Completed').limit(100),
      query('tasks', 'id, due_date, status').neq('status', 'completed').limit(500),
      query('events', 'id, start_at').gte('start_at', new Date().toISOString()).limit(100),
      supabase.from('daily_accountability').select('focus_items, entry_date').eq('user_id', userId).eq('entry_date', new Date().toISOString().slice(0, 10)).maybeSingle(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const overdueCount = (tasks.data ?? []).filter((task) => task.due_date && task.due_date < today).length;
    const payload = {
      workspace: { id: workspace.id, name: workspace.name, type: workspace.is_personal ? 'personal' : 'team' },
      today: { focusCount: Array.isArray(accountability.data?.focus_items) ? accountability.data.focus_items.length : 0, taskCount: (tasks.data ?? []).filter((task) => task.due_date === today).length, overdueCount, upcomingEventCount: (events.data ?? []).length },
      activeProjects: (projects.data ?? []).slice(0, 25).map((project) => ({ id: project.id, title: project.name, status: project.status ?? undefined, progress: project.completeness ?? undefined })),
    };
    await audit('resource.read', { resource: 'ledger://workspace/current/context' });
    return { contents: [{ uri: 'ledger://workspace/current/context', mimeType: 'application/json', text: JSON.stringify(payload) }] };
  });

  server.registerTool('list_projects', {
    description: 'List compact project summaries in the approved Ledger workspace.',
    annotations: readAnnotations,
    inputSchema: { status: z.string().max(50).optional(), limit: limitSchema, cursor: z.string().max(100).optional() },
  }, async ({ status, limit, cursor }) => {
    requireScope('projects:read');
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    let request = query('projects', 'id, name, status, completeness, end_date, updated_at').order('updated_at', { ascending: false }).range(offset, offset + limit);
    if (status) request = request.eq('status', status);
    const result = await request;
    if (result.error) throw new Error('Could not load projects.');
    const rows = result.data ?? [];
    await audit('tool.invoked', { toolName: 'list_projects' });
    return textResult({ projects: rows.slice(0, limit).map((row) => ({ id: row.id, title: row.name, status: row.status ?? undefined, progress: row.completeness ?? undefined, dueDate: row.end_date ?? undefined, updatedAt: row.updated_at })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
  });

  server.registerTool('list_tasks', {
    description: 'List bounded task summaries in the approved Ledger workspace.',
    annotations: readAnnotations,
    inputSchema: { status: z.string().max(40).optional(), projectId: uuidSchema.optional(), assignee: z.string().max(100).optional(), dueFrom: z.string().date().optional(), dueTo: z.string().date().optional(), overdue: z.boolean().optional(), limit: limitSchema, cursor: z.string().max(100).optional() },
  }, async ({ status, projectId, assignee, dueFrom, dueTo, overdue, limit, cursor }) => {
    requireScope('tasks:read');
    validateDateRange(dueFrom, dueTo);
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    let request = query('tasks', 'id, project_id, title, due_date, due_time, status, priority, assigned_to, assigned_to_user_id, completed_at, updated_at').order('updated_at', { ascending: false }).range(offset, offset + limit);
    if (status) request = request.eq('status', status);
    if (projectId) request = request.eq('project_id', projectId);
    if (assignee === 'me') request = request.or(`assigned_to.eq.${userId},assigned_to_user_id.eq.${userId}`);
    else if (assignee) {
      const member = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('user_id', assignee).maybeSingle();
      const owner = await supabase.from('workspaces').select('owner_id').eq('id', workspaceId).eq('owner_id', assignee).maybeSingle();
      if ((member.error && owner.error) || (!member.data && !owner.data)) throw new Error('Object not found or inaccessible.');
      request = request.or(`assigned_to.eq.${assignee},assigned_to_user_id.eq.${assignee}`);
    }
    if (dueFrom) request = request.gte('due_date', dueFrom);
    if (dueTo) request = request.lte('due_date', dueTo);
    if (overdue) request = request.lt('due_date', new Date().toISOString().slice(0, 10)).neq('status', 'completed');
    const result = await request;
    if (result.error) throw new Error('Could not load tasks.');
    const rows = result.data ?? [];
    await audit('tool.invoked', { toolName: 'list_tasks' });
    return textResult({ tasks: rows.slice(0, limit).map((row) => ({ id: row.id, title: row.title, projectId: row.project_id ?? undefined, dueDate: row.due_date ?? undefined, dueTime: row.due_time ?? undefined, status: row.status, priority: row.priority ?? undefined, completedAt: row.completed_at ?? undefined, updatedAt: row.updated_at })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
  });

  server.registerTool('get_task', { description: 'Get one task from the approved Ledger workspace.', annotations: readAnnotations, inputSchema: { taskId: uuidSchema } }, async ({ taskId }) => {
    requireScope('tasks:read');
    const result = await query('tasks', 'id, project_id, title, description, due_date, due_time, status, priority, assigned_to, assigned_to_user_id, completed_at, created_at, updated_at').eq('id', taskId).maybeSingle();
    if (result.error || !result.data) throw new Error('Object not found or inaccessible.');
    await audit('tool.invoked', { toolName: 'get_task' });
    return textResult({ task: result.data });
  });

  server.registerTool('get_note', { description: 'Get note metadata, with optionally capped sanitized plain text.', annotations: readAnnotations, inputSchema: { noteId: uuidSchema, includeContent: z.boolean().default(false) } }, async ({ noteId, includeContent }) => {
    requireScope('notes:read');
    const result = await query('notes', 'id, title, date, mode, section_id, parent_id, created_at, updated_at, content, content_html').eq('id', noteId).maybeSingle();
    if (result.error || !result.data) throw new Error('Object not found or inaccessible.');
    const note = result.data;
    const payload = { id: note.id, title: note.title, date: note.date, mode: note.mode, sectionId: note.section_id, parentId: note.parent_id, createdAt: note.created_at, updatedAt: note.updated_at };
    if (includeContent) {
      payload.content = plainText(note.content_html || note.content).slice(0, MAX_NOTE_CONTENT);
      await audit('note.content.read', { toolName: 'get_note' });
    } else {
      payload.preview = plainText(note.content_html || note.content).slice(0, 280);
    }
    await audit('tool.invoked', { toolName: 'get_note' });
    return textResult({ note: payload });
  });

  server.registerTool('list_upcoming_events', { description: 'List bounded upcoming events and reminders.', annotations: readAnnotations, inputSchema: { from: z.string().date().optional(), to: z.string().date().optional(), limit: limitSchema, cursor: z.string().max(100).optional() } }, async ({ from, to, limit, cursor }) => {
    requireScope('calendar:read');
    validateDateRange(from, to);
    const start = from ? `${from}T00:00:00.000Z` : new Date().toISOString();
    const end = to ? `${to}T23:59:59.999Z` : new Date(Date.now() + 30 * 86400000).toISOString();
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    const [eventsResult, remindersResult] = await Promise.all([
      query('events', 'id, title, start_at, end_at, all_day, status, calendar_id, project_id, note_id').gte('start_at', start).lte('start_at', end).order('start_at', { ascending: true }).limit(MAX_LIMIT + 1),
      query('reminders', 'id, title, remind_at, status, calendar_id, project_id, note_id').gte('remind_at', start).lte('remind_at', end).neq('status', 'completed').order('remind_at', { ascending: true }).limit(MAX_LIMIT + 1),
    ]);
    if (eventsResult.error || remindersResult.error) throw new Error('Could not load calendar items.');
    const rows = [...(eventsResult.data ?? []).map((row) => ({ ...row, itemType: 'event', sortAt: row.start_at })), ...(remindersResult.data ?? []).map((row) => ({ ...row, itemType: 'reminder', sortAt: row.remind_at }))].sort((a, b) => String(a.sortAt).localeCompare(String(b.sortAt))).slice(offset, offset + limit + 1);
    await audit('tool.invoked', { toolName: 'list_upcoming_events' });
    return textResult({ events: rows.slice(0, limit).map((row) => row.itemType === 'reminder' ? ({ id: row.id, type: 'reminder', title: row.title, startAt: row.remind_at, status: row.status, projectId: row.project_id ?? undefined, noteId: row.note_id ?? undefined }) : ({ id: row.id, type: 'event', title: row.title, startAt: row.start_at, endAt: row.end_at ?? undefined, allDay: Boolean(row.all_day), status: row.status ?? undefined, projectId: row.project_id ?? undefined, noteId: row.note_id ?? undefined })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
  });

  server.registerTool('get_today', { description: 'Get bounded Today context for the approved workspace.', annotations: readAnnotations, inputSchema: { date: z.string().date().optional() } }, async ({ date }) => {
    requireScope('daily:read');
    const day = date ?? new Date().toISOString().slice(0, 10);
    const [tasks, reminders, events, accountability] = await Promise.all([
      query('tasks', 'id, title, project_id, due_date, due_time, status, priority, is_today_focus').or(`due_date.eq.${day},is_today_focus.eq.true`).neq('status', 'completed').limit(100),
      query('reminders', 'id, title, remind_at, status, project_id, note_id').gte('remind_at', `${day}T00:00:00.000Z`).lte('remind_at', `${day}T23:59:59.999Z`).limit(100),
      query('events', 'id, title, start_at, end_at, all_day, project_id, note_id').gte('start_at', `${day}T00:00:00.000Z`).lte('start_at', `${day}T23:59:59.999Z`).order('start_at', { ascending: true }).limit(100),
      supabase.from('daily_accountability').select('entry_date, focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow').eq('user_id', userId).eq('entry_date', day).maybeSingle(),
    ]);
    if (tasks.error || reminders.error || events.error || accountability.error) throw new Error('Could not load Today.');
    await audit('tool.invoked', { toolName: 'get_today' });
    return textResult({ date: day, focusItems: accountability.data?.focus_items ?? (tasks.data ?? []).filter((row) => row.is_today_focus).map((row) => ({ id: row.id, title: row.title, projectId: row.project_id ?? undefined })), tasks: tasks.data ?? [], reminders: reminders.data ?? [], events: events.data ?? [], checkIn: accountability.data ? { finished: accountability.data.checkin_finished, blocked: accountability.data.checkin_blocked, firstTaskTomorrow: accountability.data.checkin_first_task_tomorrow } : null });
  });

  const writeAnnotations = { readOnlyHint: false, destructiveHint: false };

  server.registerTool('request_scope_upgrade', {
    description: 'Request explicit browser approval for additional non-destructive Ledger write permissions. No data is changed until the user approves.',
    annotations: writeAnnotations,
    inputSchema: z.object({ scopes: z.array(z.enum(['intake:write', 'tasks:write', 'notes:write', 'daily:write'])).min(1).max(4) }).strict(),
  }, async ({ scopes }) => {
    if (!requestScopeUpgrade) throw safeError('Scope upgrades are unavailable.');
    const upgrade = await requestScopeUpgrade({ connectionId: context.connection.id, userId, requestedScopes: scopes });
    await audit('scope_upgrade.requested', { toolName: 'request_scope_upgrade', requestedScopes: upgrade.requestedScopes });
    return textResult({ authorizationUrl: upgrade.authorizationUrl, sessionId: upgrade.sessionId, pollSecret: upgrade.pollSecret, expiresAt: upgrade.expiresAt, requestedScopes: upgrade.requestedScopes, message: 'Open the authorization URL in Ledger, then poll the scope-upgrade endpoint after approval.' });
  });

  server.registerTool('send_to_intake', {
    description: 'Create a shared Ledger Intake item in the approved workspace. This captures information without converting it into a task or note.',
    annotations: writeAnnotations,
    inputSchema: z.object({ title: z.string().min(1).max(300), body: z.string().max(20_000).optional(), sourceUrl: z.string().url().max(2_000).optional(), sourceLabel: z.string().max(120).optional(), idempotencyKey: z.string().min(8).max(160) }).strict(),
  }, async (args) => {
    const result = await mutation('send_to_intake', 'intake:write', () => withIdempotency('send_to_intake', args, async () => {
      const title = boundedText(args.title, 300, 'Title', true);
      const body = boundedText(args.body, 20_000, 'Body');
      let sourceUrl = null;
      if (args.sourceUrl) {
        try {
          const parsed = new URL(args.sourceUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
          sourceUrl = parsed.toString();
        } catch { throw safeError('Invalid source URL.'); }
      }
      const now = new Date().toISOString();
      const inserted = await supabase.from('inbox_items').insert({ workspace_id: workspaceId, user_id: userId, updated_by: userId, source: 'mcp', source_provider: 'mcp', source_url: sourceUrl, title, body, raw_payload: { source: 'mcp', source_label: args.sourceLabel ?? null, connection_id: context.connection.id, client_name: context.connection.client_name, tool_name: 'send_to_intake' }, suggested_type: 'unknown', status: 'unprocessed', updated_at: now }).select('id, title, created_at').single();
      if (inserted.error) throw safeError('Could not create Intake item.');
      return { resultType: 'inbox_item', resultId: inserted.data.id, targetType: 'intake', payload: { intakeItem: { id: inserted.data.id, title: inserted.data.title, createdAt: inserted.data.created_at, url: `ledger://intake/${encodeURIComponent(inserted.data.id)}` } } };
    }));
    return textResult({ ...result.payload, ...(result.replayed ? { message: 'This request was already completed.' } : {}) });
  });

  const taskCreateSchema = z.object({ title: z.string().min(1).max(255), description: z.string().max(20_000).optional(), projectId: uuidSchema.optional(), assigneeId: uuidSchema.optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(), status: z.enum(['todo', 'in_progress', 'completed', 'cancelled']).optional(), dueDate: z.string().date().optional(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).optional(), idempotencyKey: z.string().min(8).max(160) }).strict();
  server.registerTool('create_task', { description: 'Create a shared Ledger task in the approved workspace. It may link to an existing project or workspace member.', annotations: writeAnnotations, inputSchema: taskCreateSchema }, async (args) => {
    const result = await mutation('create_task', 'tasks:write', () => withIdempotency('create_task', args, async () => {
      await ensureProject(args.projectId);
      await ensureAssignee(args.assigneeId);
      const now = new Date().toISOString();
      const payload = { workspace_id: workspaceId, project_id: args.projectId ?? null, title: boundedText(args.title, 255, 'Title', true), description: boundedText(args.description, 20_000, 'Description'), due_date: args.dueDate ? validDate(args.dueDate, 'due date') : null, due_time: args.dueTime ? validTime(args.dueTime) : null, status: args.status ?? 'todo', priority: args.priority ?? 'medium', assigned_to: args.assigneeId ?? null, assigned_to_user_id: args.assigneeId ?? null, assigned_by_user_id: args.assigneeId ? userId : null, assigned_at: args.assigneeId ? now : null, created_by: userId, updated_by: userId, tags: [], source: 'mcp', source_platform: 'mcp' };
      const inserted = await supabase.from('tasks').insert(payload).select('id, title, status, priority, due_date, due_time, updated_at').single();
      if (inserted.error) throw safeError('Could not create task.');
      return { resultType: 'task', resultId: inserted.data.id, targetType: 'task', payload: { task: taskSummary(inserted.data), message: 'Task created.' } };
    }));
    return textResult(result.payload);
  });

  const taskUpdateSchema = z.object({ taskId: uuidSchema, title: z.string().min(1).max(300).optional(), description: z.string().max(20_000).nullable().optional(), projectId: uuidSchema.nullable().optional(), assigneeId: uuidSchema.nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(), status: z.enum(['todo', 'in_progress', 'completed', 'cancelled']).optional(), dueDate: z.string().date().nullable().optional(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(), expectedUpdatedAt: z.string().datetime().optional() }).strict();

  const updateTaskRecord = async (args, operation = 'update_task') => {
    const existing = await query('tasks', 'id, title, status, priority, due_date, due_time, project_id, assigned_to, updated_at, completed_at').eq('id', args.taskId).maybeSingle();
    if (existing.error || !existing.data) throw safeError('Object not found or inaccessible.', 404);
    if (args.expectedUpdatedAt && existing.data.updated_at !== args.expectedUpdatedAt) throw safeError('The task changed since it was last read.', 409);
    const changedFields = [];
    const update = {};
    if (args.title !== undefined) { update.title = boundedText(args.title, 255, 'Title', true); changedFields.push('title'); }
    if (args.description !== undefined) { update.description = boundedText(args.description, 20_000, 'Description'); changedFields.push('description'); }
    if (args.projectId !== undefined) { await ensureProject(args.projectId); update.project_id = args.projectId; changedFields.push('project_id'); }
    if (args.assigneeId !== undefined) { await ensureAssignee(args.assigneeId); update.assigned_to = args.assigneeId; update.assigned_to_user_id = args.assigneeId; update.assigned_by_user_id = args.assigneeId ? userId : null; update.assigned_at = args.assigneeId ? new Date().toISOString() : null; changedFields.push('assignee'); }
    if (args.priority !== undefined) { update.priority = args.priority; changedFields.push('priority'); }
    if (args.status !== undefined) { update.status = args.status; update.completed_at = args.status === 'completed' ? (existing.data.completed_at ?? new Date().toISOString()) : null; changedFields.push('status'); }
    if (args.dueDate !== undefined) { update.due_date = args.dueDate === null ? null : validDate(args.dueDate, 'due date'); changedFields.push('due_date'); }
    if (args.dueTime !== undefined) { update.due_time = args.dueTime === null ? null : validTime(args.dueTime); changedFields.push('due_time'); }
    if (!changedFields.length) throw safeError('At least one editable field is required.');
    update.updated_at = new Date().toISOString();
    update.updated_by = userId;
    const saved = await supabase.from('tasks').update(update).eq('id', args.taskId).eq('workspace_id', workspaceId).select('id, title, status, priority, due_date, due_time, updated_at, completed_at').single();
    if (saved.error) throw safeError('Could not update task.');
    return { resultType: 'task', resultId: saved.data.id, targetType: 'task', changedFields, payload: { task: taskSummary(saved.data), changedFields, message: operation === 'reschedule_task' ? 'Task rescheduled.' : 'Task updated.' } };
  };

  server.registerTool('update_task', { description: 'Update limited, non-destructive fields on a shared Ledger task. Workspace and ownership cannot be changed.', annotations: writeAnnotations, inputSchema: taskUpdateSchema }, async (args) => textResult((await mutation('update_task', 'tasks:write', () => updateTaskRecord(args))).payload));

  server.registerTool('complete_task', { description: 'Mark a shared Ledger task complete. This is non-destructive and preserves the task.', annotations: writeAnnotations, inputSchema: z.object({ taskId: uuidSchema, expectedUpdatedAt: z.string().datetime().optional() }).strict() }, async (args) => {
    const result = await mutation('complete_task', 'tasks:write', async () => {
      const existing = await query('tasks', 'id, title, status, priority, due_date, due_time, updated_at, completed_at').eq('id', args.taskId).maybeSingle();
      if (existing.error || !existing.data) throw safeError('Object not found or inaccessible.', 404);
      if (args.expectedUpdatedAt && existing.data.updated_at !== args.expectedUpdatedAt) throw safeError('The task changed since it was last read.', 409);
      if (existing.data.status === 'completed') return { resultType: 'task', resultId: existing.data.id, targetType: 'task', payload: { taskId: existing.data.id, status: existing.data.status, completedAt: existing.data.completed_at ?? undefined, alreadyCompleted: true, url: `ledger://tasks/${encodeURIComponent(existing.data.id)}` } };
      const now = new Date().toISOString();
      const saved = await supabase.from('tasks').update({ status: 'completed', completed_at: now, updated_at: now, updated_by: userId }).eq('id', args.taskId).eq('workspace_id', workspaceId).select('id, status, completed_at, updated_at').single();
      if (saved.error) throw safeError('Could not complete task.');
      return { resultType: 'task', resultId: saved.data.id, targetType: 'task', changedFields: ['status', 'completed_at'], payload: { taskId: saved.data.id, status: saved.data.status, completedAt: saved.data.completed_at, alreadyCompleted: false, url: `ledger://tasks/${encodeURIComponent(saved.data.id)}` } };
    });
    return textResult(result.payload);
  });

  server.registerTool('reschedule_task', { description: 'Change or clear a shared Ledger task due date without changing its other planning fields.', annotations: writeAnnotations, inputSchema: z.object({ taskId: uuidSchema, dueDate: z.string().date().nullable(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(), expectedUpdatedAt: z.string().datetime().optional() }).strict() }, async (args) => textResult((await mutation('reschedule_task', 'tasks:write', () => updateTaskRecord(args, 'reschedule_task'))).payload));

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  server.registerTool('create_note', { description: 'Create a plain-text shared Ledger note in the approved workspace. Rich HTML and file uploads are not accepted.', annotations: writeAnnotations, inputSchema: z.object({ title: z.string().min(1).max(255), content: z.string().max(20_000).optional(), projectId: uuidSchema.optional(), sectionId: uuidSchema.optional(), idempotencyKey: z.string().min(8).max(160) }).strict() }, async (args) => {
    const result = await mutation('create_note', 'notes:write', () => withIdempotency('create_note', args, async () => {
      await ensureProject(args.projectId);
      if (args.sectionId) { const section = await supabase.from('note_sections').select('id').eq('id', args.sectionId).eq('workspace_id', workspaceId).maybeSingle(); if (section.error || !section.data) throw safeError('The note section is not available in this workspace.', 404); }
      const title = boundedText(args.title, 255, 'Title', true);
      const content = boundedText(args.content, 20_000, 'Content') ?? '';
      const contentHtml = content ? content.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('') : '<p></p>';
      const now = new Date().toISOString();
      const note = await supabase.from('notes').insert({ workspace_id: workspaceId, user_id: userId, updated_by: userId, title, content, content_html: contentHtml, date: now.slice(0, 10), source: 'mcp', source_platform: 'mcp', mode: 'text', section_id: args.sectionId ?? null, parent_id: null, sort_order: 0, depth: 0 }).select('id, title, date, created_at, updated_at').single();
      if (note.error) throw safeError('Could not create note.');
      if (args.projectId) { const link = await supabase.from('project_note_links').insert({ workspace_id: workspaceId, project_id: args.projectId, note_id: note.data.id, created_by: userId }).select('id').single(); if (link.error) throw safeError('Could not link note to project.'); }
      return { resultType: 'note', resultId: note.data.id, targetType: 'note', payload: { note: { id: note.data.id, title: note.data.title, date: note.data.date, createdAt: note.data.created_at, updatedAt: note.data.updated_at, url: `ledger://notes/${encodeURIComponent(note.data.id)}` }, message: 'Note created.' } };
    }));
    return textResult(result.payload);
  });

  server.registerTool('add_to_focus', { description: 'Add a shared Ledger task to Today’s focus. This changes Today’s focus and keeps the task non-destructively available.', annotations: writeAnnotations, inputSchema: z.object({ taskId: uuidSchema, date: z.string().date().optional(), position: z.number().int().min(0).max(2).optional(), idempotencyKey: z.string().min(8).max(160) }).strict() }, async (args) => {
    const result = await mutation('add_to_focus', 'daily:write', () => withIdempotency('add_to_focus', args, async () => {
      const task = await query('tasks', 'id, title, status, is_today_focus, show_in_today, updated_at').eq('id', args.taskId).maybeSingle();
      if (task.error || !task.data) throw safeError('Object not found or inaccessible.', 404);
      if (task.data.status === 'completed') throw safeError('Completed tasks cannot be added to Today’s focus.');
      if (task.data.is_today_focus) return { resultType: 'task', resultId: task.data.id, targetType: 'task', payload: { taskId: task.data.id, alreadyFocused: true, date: args.date ?? new Date().toISOString().slice(0, 10), url: `ledger://tasks/${encodeURIComponent(task.data.id)}` } };
      const count = await query('tasks', 'id').eq('is_today_focus', true).neq('status', 'completed').limit(4);
      if (count.error) throw safeError('Could not load Today’s focus.');
      if ((count.data ?? []).length >= 3) throw safeError('Today’s focus already has its maximum of three items.');
      const saved = await supabase.from('tasks').update({ is_today_focus: true, show_in_today: true, updated_at: new Date().toISOString(), updated_by: userId }).eq('id', args.taskId).eq('workspace_id', workspaceId).select('id, title, status, updated_at').single();
      if (saved.error) throw safeError('Could not update Today’s focus.');
      return { resultType: 'task', resultId: saved.data.id, targetType: 'task', changedFields: ['is_today_focus', 'show_in_today'], payload: { taskId: saved.data.id, title: saved.data.title, focused: true, date: args.date ?? new Date().toISOString().slice(0, 10), url: `ledger://tasks/${encodeURIComponent(saved.data.id)}` } };
    }));
    return textResult(result.payload);
  });

  return server;
};

export { MAX_LIMIT, MAX_NOTE_CONTENT, MAX_DATE_RANGE_DAYS, plainText, decodeCursor, encodeCursor, mutationLimits };
