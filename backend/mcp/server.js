import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import crypto from 'node:crypto';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_NOTE_CONTENT = 20_000;
const MAX_DATE_RANGE_DAYS = 90;
const mutationBuckets = new Map();
const mutationLimits = { send_to_intake: 20, create_task: 20, create_note: 20, append_to_note: 20, create_project: 20, update_task: 60, complete_task: 60, reschedule_task: 60, add_to_focus: 30 };

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

const searchSnippet = (value, rawQuery, maxLength = 600) => {
  const text = plainText(value);
  if (!text) return '';
  const query = plainText(rawQuery).toLowerCase();
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index < 0) return text.slice(0, maxLength);
  const start = Math.max(0, index - Math.floor(maxLength * 0.3));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + maxLength)}${start + maxLength < text.length ? '…' : ''}`;
};

export const createMcpServer = ({ context, supabase, requireWorkspaceAccess, audit, requestScopeUpgrade, requestWorkspaceSwitch }) => {
  const workspaceId = context.workspaceId;
  const userId = context.userId;

  const requireScope = (scope) => {
    if (!context.scopes.includes(scope)) throw new Error('Required scope is missing.');
  };
  const hasScope = (scope) => context.scopes.includes(scope);

  const query = (table, columns) => supabase.from(table).select(columns).eq('workspace_id', workspaceId);
  const queryTable = query;

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

  const ensureProjectLead = async (leadId) => {
    if (!leadId) return null;
    await ensureAssignee(leadId);
    return leadId;
  };

  const ensureOwnerTeam = async (teamId) => {
    if (!teamId) return null;
    const result = await supabase.from('workspace_teams').select('id, name').eq('id', teamId).eq('workspace_id', workspaceId).is('archived_at', null).maybeSingle();
    if (result.error || !result.data) throw safeError('The project team is not available in this workspace.', 404);
    return result.data;
  };

  const projectStatusValues = { not_started: 'NotStarted', in_progress: 'InProgress', paused: 'Paused', completed: 'Completed' };
  const projectSummary = (row, metadata = {}) => ({
    id: row.id,
    title: row.name,
    description: row.description ? plainText(row.description).slice(0, 2_000) : undefined,
    status: row.status,
    progress: row.completeness ?? 0,
    projectType: row.project_type ?? undefined,
    color: row.color ?? undefined,
    startDate: row.start_date ?? undefined,
    dueDate: row.end_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lead: metadata.lead ?? (row.lead_id ? { id: row.lead_id } : undefined),
    ownerTeam: metadata.ownerTeam ?? (row.owner_team_id ? { id: row.owner_team_id } : undefined),
    taskCount: metadata.taskCount ?? 0,
    linkedNoteCount: metadata.linkedNoteCount ?? 0,
    descriptionPreview: row.description ? plainText(row.description).slice(0, 320) : undefined,
    url: `ledger://projects/${encodeURIComponent(row.id)}`,
  });

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
    description: 'A bounded, workspace-scoped snapshot of Ledger context for planning and answering questions.',
    mimeType: 'application/json',
  }, async () => {
    requireScope('workspace:read');
    const workspace = await fetchWorkspace();
    const today = new Date().toISOString().slice(0, 10);
    const [projects, tasks, events, reminders, accountability, notes] = await Promise.all([
      hasScope('projects:read') ? query('projects', 'id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_at, updated_at').neq('status', 'Completed').order('updated_at', { ascending: false }).limit(25) : { data: [], error: null },
      hasScope('tasks:read') ? query('tasks', 'id, project_id, title, description, due_date, due_time, status, priority, assigned_to, assigned_to_user_id, completed_at, is_today_focus, updated_at').neq('status', 'completed').order('due_date', { ascending: true, nullsFirst: false }).limit(200) : { data: [], error: null },
      hasScope('calendar:read') ? query('events', 'id, title, description, start_at, end_at, all_day, status, project_id, note_id').gte('start_at', new Date().toISOString()).order('start_at', { ascending: true }).limit(30) : { data: [], error: null },
      hasScope('calendar:read') ? query('reminders', 'id, title, remind_at, status, project_id, note_id').gte('remind_at', `${today}T00:00:00.000Z`).neq('status', 'completed').order('remind_at', { ascending: true }).limit(30) : { data: [], error: null },
      hasScope('daily:read') ? supabase.from('daily_accountability').select('focus_items, entry_date, checkin_finished, checkin_blocked, checkin_first_task_tomorrow, updated_at').eq('user_id', userId).eq('entry_date', today).maybeSingle() : { data: null, error: null },
      hasScope('notes:read') ? query('notes', 'id, title, date, mode, section_id, parent_id, created_at, updated_at, content, content_html').order('date', { ascending: false }).order('updated_at', { ascending: false }).limit(20) : { data: [], error: null },
    ]);
    if (projects.error || tasks.error || events.error || reminders.error || accountability.error || notes.error) throw new Error('Could not load workspace context.');

    const projectRows = projects.data ?? [];
    const taskRows = tasks.data ?? [];
    const eventRows = events.data ?? [];
    const reminderRows = reminders.data ?? [];
    const noteRows = notes.data ?? [];
    const overdueCount = (tasks.data ?? []).filter((task) => task.due_date && task.due_date < today).length;
    const focusItems = Array.isArray(accountability.data?.focus_items)
      ? accountability.data.focus_items
      : taskRows.filter((task) => task.is_today_focus).map((task) => ({ id: task.id, title: task.title, projectId: task.project_id ?? undefined }));
    const projectIds = projectRows.map((project) => project.id);
    const [projectLinks, leads, teams] = await Promise.all([
      projectIds.length && hasScope('projects:read') ? query('project_note_links', 'id, project_id, note_id').in('project_id', projectIds) : { data: [], error: null },
      [...new Set(projectRows.map((project) => project.lead_id).filter(Boolean))].length
        ? supabase.from('users').select('id, full_name').in('id', [...new Set(projectRows.map((project) => project.lead_id).filter(Boolean))])
        : { data: [], error: null },
      [...new Set(projectRows.map((project) => project.owner_team_id).filter(Boolean))].length
        ? supabase.from('workspace_teams').select('id, name, identifier').eq('workspace_id', workspaceId).in('id', [...new Set(projectRows.map((project) => project.owner_team_id).filter(Boolean))])
        : { data: [], error: null },
    ]);
    if (projectLinks.error || leads.error || teams.error) throw new Error('Could not load workspace project context.');
    const leadById = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
    const teamById = new Map((teams.data ?? []).map((team) => [team.id, team]));
    const noteCountByProject = new Map();
    for (const link of projectLinks.data ?? []) noteCountByProject.set(link.project_id, (noteCountByProject.get(link.project_id) ?? 0) + 1);
    const compactTask = (task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority ?? undefined, dueDate: task.due_date ?? undefined, dueTime: task.due_time ?? undefined, assignedTo: task.assigned_to_user_id ?? task.assigned_to ?? undefined, updatedAt: task.updated_at, url: `ledger://tasks/${encodeURIComponent(task.id)}` });
    const compactEvent = (event) => ({ id: event.id, title: event.title, startAt: event.start_at, endAt: event.end_at ?? undefined, allDay: Boolean(event.all_day), projectId: event.project_id ?? undefined, noteId: event.note_id ?? undefined, url: `ledger://events/${encodeURIComponent(event.id)}` });
    const compactReminder = (reminder) => ({ id: reminder.id, title: reminder.title, remindAt: reminder.remind_at, projectId: reminder.project_id ?? undefined, noteId: reminder.note_id ?? undefined, url: `ledger://reminders/${encodeURIComponent(reminder.id)}` });
    const payload = {
      workspace: { id: workspace.id, name: workspace.name, type: workspace.is_personal ? 'personal' : 'team', contextDate: today },
      today: {
        focusCount: focusItems.length,
        focusItems: focusItems.slice(0, 10),
        taskCount: taskRows.filter((task) => task.due_date === today).length,
        dueToday: taskRows.filter((task) => task.due_date === today).slice(0, 25).map(compactTask),
        overdueCount,
        overdueTasks: taskRows.filter((task) => task.due_date && task.due_date < today).slice(0, 25).map(compactTask),
        upcomingEventCount: eventRows.length,
        upcomingEvents: eventRows.slice(0, 15).map(compactEvent),
        reminders: reminderRows.slice(0, 15).map(compactReminder),
        checkIn: accountability.data ? { finished: accountability.data.checkin_finished, blocked: accountability.data.checkin_blocked, firstTaskTomorrow: accountability.data.checkin_first_task_tomorrow } : null,
      },
      activeProjects: projectRows.map((project) => ({
        ...projectSummary(project, {
          lead: project.lead_id ? { id: project.lead_id, name: leadById.get(project.lead_id)?.full_name ?? undefined } : undefined,
          ownerTeam: project.owner_team_id ? { id: project.owner_team_id, name: teamById.get(project.owner_team_id)?.name ?? undefined, identifier: teamById.get(project.owner_team_id)?.identifier ?? undefined } : undefined,
          taskCount: taskRows.filter((task) => task.project_id === project.id).length,
          linkedNoteCount: noteCountByProject.get(project.id) ?? 0,
        }),
        nextActions: taskRows.filter((task) => task.project_id === project.id).slice(0, 5).map(compactTask),
      })),
      recentNotes: noteRows.slice(0, 20).map((note) => ({ id: note.id, title: note.title, date: note.date, mode: note.mode ?? undefined, sectionId: note.section_id ?? undefined, parentId: note.parent_id ?? undefined, preview: searchSnippet(note.content_html || note.content, '', 360), createdAt: note.created_at, updatedAt: note.updated_at, url: `ledger://notes/${encodeURIComponent(note.id)}` })),
    };
    await audit('resource.read', { resource: 'ledger://workspace/current/context' });
    return { contents: [{ uri: 'ledger://workspace/current/context', mimeType: 'application/json', text: JSON.stringify(payload) }] };
  });

  server.registerTool('list_projects', {
    description: 'List project summaries and bounded attached metadata in the approved Ledger workspace, including dates, lead, owner team, task count, and linked note count.',
    annotations: readAnnotations,
    inputSchema: { status: z.string().max(50).optional(), limit: limitSchema, cursor: z.string().max(100).optional() },
  }, async ({ status, limit, cursor }) => {
    requireScope('projects:read');
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    let request = query('projects', 'id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_at, updated_at').order('updated_at', { ascending: false }).range(offset, offset + limit);
    if (status) request = request.eq('status', status);
    const result = await request;
    if (result.error) throw new Error('Could not load projects.');
    const rows = result.data ?? [];
    const projectIds = rows.map((row) => row.id).filter(Boolean);
    const [taskRows, linkRows] = projectIds.length ? await Promise.all([
      query('tasks', 'id, project_id').in('project_id', projectIds),
      query('project_note_links', 'id, project_id').in('project_id', projectIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (taskRows.error || linkRows.error) throw new Error('Could not load project metadata.');
    const leadIds = [...new Set(rows.map((row) => row.lead_id).filter(Boolean))];
    const teamIds = [...new Set(rows.map((row) => row.owner_team_id).filter(Boolean))];
    const [leads, teams] = await Promise.all([
      leadIds.length ? supabase.from('users').select('id, full_name').in('id', leadIds) : { data: [], error: null },
      teamIds.length ? supabase.from('workspace_teams').select('id, name, identifier').eq('workspace_id', workspaceId).in('id', teamIds) : { data: [], error: null },
    ]);
    if (leads.error || teams.error) throw new Error('Could not load project metadata.');
    const leadById = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
    const teamById = new Map((teams.data ?? []).map((team) => [team.id, team]));
    await audit('tool.invoked', { toolName: 'list_projects' });
    return textResult({ projects: rows.slice(0, limit).map((row) => projectSummary(row, { lead: row.lead_id ? { id: row.lead_id, name: leadById.get(row.lead_id)?.full_name ?? undefined } : undefined, ownerTeam: row.owner_team_id ? { id: row.owner_team_id, name: teamById.get(row.owner_team_id)?.name ?? undefined, identifier: teamById.get(row.owner_team_id)?.identifier ?? undefined } : undefined, taskCount: (taskRows.data ?? []).filter((task) => task.project_id === row.id).length, linkedNoteCount: (linkRows.data ?? []).filter((link) => link.project_id === row.id).length })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
  });

  server.registerTool('get_project', {
    description: 'Get one project with bounded project context, linked notes, next actions, lead, owner team, and dates from the approved Ledger workspace.',
    annotations: readAnnotations,
    inputSchema: { projectId: uuidSchema },
  }, async ({ projectId }) => {
    requireScope('projects:read');
    const result = await query('projects', 'id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_by, created_at, updated_at').eq('id', projectId).maybeSingle();
    if (result.error || !result.data) throw new Error('Object not found or inaccessible.');
    const project = result.data;
    const [tasks, links, lead, team] = await Promise.all([
      query('tasks', 'id, title, status, priority, due_date, due_time, assigned_to_user_id, assigned_to_team_id, updated_at').eq('project_id', projectId).order('due_date', { ascending: true, nullsFirst: false }).limit(50),
      query('project_note_links', 'id, note_id, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(25),
      project.lead_id ? supabase.from('users').select('id, full_name').eq('id', project.lead_id).maybeSingle() : { data: null, error: null },
      project.owner_team_id ? supabase.from('workspace_teams').select('id, name, identifier').eq('id', project.owner_team_id).eq('workspace_id', workspaceId).maybeSingle() : { data: null, error: null },
    ]);
    if (tasks.error || links.error || lead.error || team.error) throw new Error('Could not load project context.');
    const noteIds = (links.data ?? []).map((link) => link.note_id).filter(Boolean);
    const notes = noteIds.length ? await query('notes', 'id, title, date, content, content_html, updated_at').in('id', noteIds) : { data: [], error: null };
    if (notes.error) throw new Error('Could not load linked project notes.');
    const taskAssigneeIds = [...new Set((tasks.data ?? []).map((task) => task.assigned_to_user_id).filter(Boolean))];
    const taskTeamIds = [...new Set((tasks.data ?? []).map((task) => task.assigned_to_team_id).filter(Boolean))];
    const [taskAssignees, taskTeams] = await Promise.all([
      taskAssigneeIds.length ? supabase.from('users').select('id, full_name').in('id', taskAssigneeIds) : { data: [], error: null },
      taskTeamIds.length ? supabase.from('workspace_teams').select('id, name, identifier').eq('workspace_id', workspaceId).in('id', taskTeamIds) : { data: [], error: null },
    ]);
    if (taskAssignees.error || taskTeams.error) throw new Error('Could not load project assignments.');
    const notesById = new Map((notes.data ?? []).map((note) => [note.id, note]));
    const taskAssigneeById = new Map((taskAssignees.data ?? []).map((assignee) => [assignee.id, assignee]));
    const taskTeamById = new Map((taskTeams.data ?? []).map((teamRow) => [teamRow.id, teamRow]));
    await audit('tool.invoked', { toolName: 'get_project' });
    return textResult({ project: projectSummary(project, { lead: lead.data ? { id: lead.data.id, name: lead.data.full_name ?? undefined } : undefined, ownerTeam: team.data ? { id: team.data.id, name: team.data.name, identifier: team.data.identifier ?? undefined } : undefined, taskCount: (tasks.data ?? []).length, linkedNoteCount: (links.data ?? []).length }), linkedNotes: (links.data ?? []).map((link) => { const note = notesById.get(link.note_id); return note ? { id: note.id, title: note.title, date: note.date, snippet: searchSnippet(note.content_html || note.content, '', 400), updatedAt: note.updated_at, url: `ledger://notes/${encodeURIComponent(note.id)}` } : null; }).filter(Boolean), nextActions: (tasks.data ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority ?? undefined, dueDate: task.due_date ?? undefined, dueTime: task.due_time ?? undefined, assignee: task.assigned_to_user_id ? { id: task.assigned_to_user_id, name: taskAssigneeById.get(task.assigned_to_user_id)?.full_name ?? undefined } : undefined, team: task.assigned_to_team_id ? { id: task.assigned_to_team_id, name: taskTeamById.get(task.assigned_to_team_id)?.name ?? undefined, identifier: taskTeamById.get(task.assigned_to_team_id)?.identifier ?? undefined } : undefined, updatedAt: task.updated_at, url: `ledger://tasks/${encodeURIComponent(task.id)}` })) });
  });

  server.registerTool('search_notes', {
    description: 'Search note titles and content within the approved Ledger workspace. Returns bounded sanitized snippets; use get_note for explicitly requested content.',
    annotations: readAnnotations,
    inputSchema: z.object({ query: z.string().trim().min(2).max(200), dateFrom: z.string().date().optional(), dateTo: z.string().date().optional(), limit: limitSchema, cursor: z.string().max(100).optional() }).strict(),
  }, async ({ query: rawQuery, dateFrom, dateTo, limit, cursor }) => {
    requireScope('notes:read');
    validateDateRange(dateFrom, dateTo);
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    const searchTerm = rawQuery.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (searchTerm.length < 2) throw new Error('Search query must be at least 2 characters.');
    const like = `%${searchTerm}%`;
    let request = queryTable('notes', 'id, title, date, mode, section_id, parent_id, created_at, updated_at, content, content_html')
      .or(`title.ilike.${like},content.ilike.${like},content_html.ilike.${like}`)
      .order('date', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit);
    if (dateFrom) request = request.gte('date', dateFrom);
    if (dateTo) request = request.lte('date', dateTo);
    const result = await request;
    if (result.error) throw new Error('Could not search notes.');
    const rows = result.data ?? [];
    await audit('tool.invoked', { toolName: 'search_notes' });
    return textResult({ notes: rows.slice(0, limit).map((row) => ({ id: row.id, title: row.title, date: row.date, mode: row.mode ?? undefined, sectionId: row.section_id ?? undefined, parentId: row.parent_id ?? undefined, snippet: searchSnippet(row.content_html || row.content, rawQuery), createdAt: row.created_at, updatedAt: row.updated_at, url: `ledger://notes/${encodeURIComponent(row.id)}` })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
  });

  server.registerTool('list_notes', {
    description: 'List bounded note metadata from the approved Ledger workspace for browsing before choosing a note to read.',
    annotations: readAnnotations,
    inputSchema: z.object({ dateFrom: z.string().date().optional(), dateTo: z.string().date().optional(), sectionId: uuidSchema.optional(), limit: limitSchema, cursor: z.string().max(100).optional() }).strict(),
  }, async ({ dateFrom, dateTo, sectionId, limit, cursor }) => {
    requireScope('notes:read');
    validateDateRange(dateFrom, dateTo);
    const offset = decodeCursor(cursor);
    if (offset === null) throw new Error('Invalid cursor.');
    let request = queryTable('notes', 'id, title, date, mode, section_id, parent_id, created_at, updated_at, content, content_html').order('date', { ascending: false }).order('updated_at', { ascending: false }).range(offset, offset + limit);
    if (dateFrom) request = request.gte('date', dateFrom);
    if (dateTo) request = request.lte('date', dateTo);
    if (sectionId) request = request.eq('section_id', sectionId);
    const result = await request;
    if (result.error) throw new Error('Could not load notes.');
    const rows = result.data ?? [];
    await audit('tool.invoked', { toolName: 'list_notes' });
    return textResult({ notes: rows.slice(0, limit).map((row) => ({ id: row.id, title: row.title, date: row.date, mode: row.mode ?? undefined, sectionId: row.section_id ?? undefined, parentId: row.parent_id ?? undefined, preview: searchSnippet(row.content_html || row.content, '', 280), createdAt: row.created_at, updatedAt: row.updated_at, url: `ledger://notes/${encodeURIComponent(row.id)}` })), ...(rows.length > limit ? { nextCursor: encodeCursor(offset + limit) } : {}) });
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
    inputSchema: z.object({ scopes: z.array(z.enum(['intake:write', 'tasks:write', 'notes:write', 'daily:write', 'projects:write'])).min(1).max(5) }).strict(),
  }, async ({ scopes }) => {
    if (!requestScopeUpgrade) throw safeError('Scope upgrades are unavailable.');
    const upgrade = await requestScopeUpgrade({ connectionId: context.connection.id, userId, requestedScopes: scopes });
    await audit('scope_upgrade.requested', { toolName: 'request_scope_upgrade', requestedScopes: upgrade.requestedScopes });
    return textResult({ authorizationUrl: upgrade.authorizationUrl, sessionId: upgrade.sessionId, pollSecret: upgrade.pollSecret, expiresAt: upgrade.expiresAt, requestedScopes: upgrade.requestedScopes, message: 'Open the authorization URL in Ledger, then poll the scope-upgrade endpoint after approval.' });
  });

  server.registerTool('switch_workspace', {
    description: 'Request browser approval to switch this MCP connection to another Ledger workspace. The user must choose and approve the destination workspace in Ledger; the client cannot switch it directly.',
    annotations: writeAnnotations,
    inputSchema: z.object({ workspaceId: uuidSchema.optional() }).strict(),
  }, async ({ workspaceId: requestedWorkspaceId }) => {
    if (!requestWorkspaceSwitch) throw safeError('Workspace switching is unavailable.');
    const switchRequest = await requestWorkspaceSwitch({ connectionId: context.connection.id, userId, requestedWorkspaceId: requestedWorkspaceId ?? null });
    await audit('workspace_switch.requested', { toolName: 'switch_workspace', requestedWorkspaceId: switchRequest.requestedWorkspaceId ?? null });
    return textResult({ authorizationUrl: switchRequest.authorizationUrl, sessionId: switchRequest.sessionId, pollSecret: switchRequest.pollSecret, expiresAt: switchRequest.expiresAt, currentWorkspaceId: switchRequest.currentWorkspaceId, requestedWorkspaceId: switchRequest.requestedWorkspaceId, message: 'Open the authorization URL in Ledger and approve a destination workspace, then poll the workspace-switch endpoint.' });
  });

  server.registerTool('create_project', {
    description: 'Create a shared Ledger project in the approved workspace. This creates a project container and does not create tasks or modify existing projects.',
    annotations: writeAnnotations,
    inputSchema: z.object({ title: z.string().trim().min(1).max(255), description: z.string().max(20_000).optional(), status: z.enum(['not_started', 'in_progress', 'paused', 'completed']).optional(), progress: z.number().int().min(0).max(100).optional(), startDate: z.string().date().nullable().optional(), dueDate: z.string().date().nullable().optional(), projectType: z.enum(['code', 'design', 'personal', 'ops', 'writing', 'other']).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), leadId: uuidSchema.nullable().optional(), ownerTeamId: uuidSchema.nullable().optional(), idempotencyKey: z.string().min(8).max(160) }).strict(),
  }, async (args) => {
    const result = await mutation('create_project', 'projects:write', () => withIdempotency('create_project', args, async () => {
      const title = boundedText(args.title, 255, 'Project title', true);
      const existing = await query('projects', 'id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_at, updated_at').ilike('name', title).maybeSingle();
      if (existing.error) throw safeError('Could not check existing projects.');
      if (existing.data) return { resultType: 'project', resultId: existing.data.id, targetType: 'project', payload: { project: projectSummary(existing.data), message: 'A project with that title already exists.' } };
      await ensureProjectLead(args.leadId);
      const ownerTeam = await ensureOwnerTeam(args.ownerTeamId);
      const startDate = args.startDate === undefined ? null : args.startDate === null ? null : validDate(args.startDate, 'start date');
      const dueDate = args.dueDate === undefined ? null : args.dueDate === null ? null : validDate(args.dueDate, 'due date');
      if (startDate && dueDate && startDate > dueDate) throw safeError('The project due date cannot be before its start date.');
      const inserted = await supabase.from('projects').insert({ workspace_id: workspaceId, created_by: userId, name: title, description: boundedText(args.description, 20_000, 'Description'), status: projectStatusValues[args.status ?? 'not_started'], completeness: args.progress ?? 0, color: args.color ?? '#007AFF', start_date: startDate, end_date: dueDate, project_type: args.projectType ?? 'other', lead_id: args.leadId ?? null, owner_team_id: ownerTeam?.id ?? null }).select('id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_at, updated_at').single();
      if (inserted.error) throw safeError('Could not create project.');
      return { resultType: 'project', resultId: inserted.data.id, targetType: 'project', changedFields: ['project'], payload: { project: projectSummary(inserted.data, { ownerTeam: ownerTeam ? { id: ownerTeam.id, name: ownerTeam.name } : undefined }), message: 'Project created.' } };
    }));
    return textResult(result.payload);
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

  const taskUpdateSchema = z.object({ taskId: uuidSchema, title: z.string().min(1).max(255).optional(), description: z.string().max(20_000).nullable().optional(), projectId: uuidSchema.nullable().optional(), assigneeId: uuidSchema.nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(), status: z.enum(['todo', 'in_progress', 'completed', 'cancelled']).optional(), dueDate: z.string().date().nullable().optional(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(), expectedUpdatedAt: z.string().datetime().optional() }).strict();

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

  server.registerTool('append_to_note', {
    description: 'Append plain-text content to an existing shared Ledger note in the approved workspace. This preserves the existing note and does not replace or delete prior content.',
    annotations: writeAnnotations,
    inputSchema: z.object({ noteId: uuidSchema, content: z.string().min(1).max(20_000), expectedUpdatedAt: z.string().datetime().optional(), idempotencyKey: z.string().min(8).max(160) }).strict(),
  }, async (args) => {
    const result = await mutation('append_to_note', 'notes:write', () => withIdempotency('append_to_note', args, async () => {
      const existing = await query('notes', 'id, title, date, mode, content, content_html, updated_at').eq('id', args.noteId).maybeSingle();
      if (existing.error || !existing.data) throw safeError('Object not found or inaccessible.', 404);
      if (args.expectedUpdatedAt && existing.data.updated_at !== args.expectedUpdatedAt) throw safeError('The note changed since it was last read.', 409);
      const addition = boundedText(args.content, MAX_NOTE_CONTENT, 'Content', true);
      const current = plainText(existing.data.content_html || existing.data.content);
      const combined = current ? `${current}\n\n${addition}` : addition;
      if (combined.length > MAX_NOTE_CONTENT) throw safeError('The resulting note is too long.');
      const now = new Date().toISOString();
      const contentHtml = combined.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
      const saved = await supabase.from('notes').update({ content: combined, content_html: contentHtml, updated_by: userId, updated_at: now }).eq('id', args.noteId).eq('workspace_id', workspaceId).select('id, title, date, updated_at').single();
      if (saved.error) throw safeError('Could not update note.');
      return { resultType: 'note', resultId: saved.data.id, targetType: 'note', changedFields: ['content'], payload: { note: { id: saved.data.id, title: saved.data.title, date: saved.data.date, updatedAt: saved.data.updated_at, url: `ledger://notes/${encodeURIComponent(saved.data.id)}` }, message: 'Note updated.' } };
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
