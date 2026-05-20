import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
});

const captureRawBody = (req, _res, buffer) => {
  if (buffer?.length) {
    req.rawBody = buffer.toString('utf8');
  }
};

app.use(cors());
app.use(express.json({ limit: '256kb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, limit: '256kb', verify: captureRawBody }));

const TIER_LIMITS = {
  free: { projects: 3, events: 100, notes: 100, reminders: 100 },
  pro: { projects: Infinity, events: Infinity, notes: Infinity, reminders: Infinity },
};

const REMINDER_TABLES = ['reminders', 'calendar_reminders'];

const WINDOW_MS = 60_000;
const RATE_LIMITS = {
  auth: { max: 60 },
  read: { max: 180 },
  write: { max: 60 },
};

const rateBuckets = new Map();

const getBucketKey = (scope, req, userId) => `${scope}:${userId ?? req.ip}`;

const rateLimit = (scope) => (req, res, next) => {
  const now = Date.now();
  const bucketKey = getBucketKey(scope, req, req.authUser?.id);
  const bucket = rateBuckets.get(bucketKey) ?? { count: 0, resetAt: now + WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }

  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);

  if (bucket.count > RATE_LIMITS[scope].max) {
    return res.status(429).json({ error: 'Too many requests. Slow down and try again.' });
  }

  next();
};

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.authUser = data.user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Auth failed' });
  }
};

const safeJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const getUserTier = (user) => {
  const candidate =
    user?.app_metadata?.tier || user?.user_metadata?.tier || user?.user_metadata?.plan;
  return candidate === 'pro' ? 'pro' : 'free';
};

const isCompletedProjectStatus = (status) =>
  String(status ?? '')
    .toLowerCase()
    .includes('complete');

const projectStatusAliases = {
  not_started: ['NotStarted', 'not_started', 'todo'],
  in_progress: ['InProgress', 'in_progress', 'inprogress', 'doing'],
  paused: ['Paused', 'paused', 'archived', 'hold'],
  completed: ['Completed', 'completed', 'done'],
};

const projectSelectColumns =
  'id, name, description, status, completeness, color, start_date, end_date, created_by, created_at, updated_at';
const taskSelectColumns =
  'id, workspace_id, project_id, title, description, notes, due_date, due_time, status, priority, assigned_to, tags, completed_at, created_at, updated_at';
const reminderSelectColumns =
  'id, workspace_id, calendar_id, project_id, note_id, title, remind_at, is_done, notes, color, created_at, updated_at';
const workspaceRoleRank = { viewer: 1, member: 2, admin: 3, owner: 4 };
const workspaceMemberRoles = ['admin', 'member', 'viewer'];

const normalizeProjectSemanticStatus = (status) => {
  const value = String(status ?? '').toLowerCase();
  if (value.includes('complete')) return 'completed';
  if (value.includes('pause') || value.includes('archiv') || value.includes('hold'))
    return 'paused';
  if (value.includes('progress') || value.includes('doing') || value.includes('in_'))
    return 'in_progress';
  return 'not_started';
};

const normalizeProjectNameKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const dedupeProjectsByName = (projects) => {
  const seen = new Set();
  return (projects ?? []).filter((project) => {
    const key = `${project.workspace_id ?? ''}:${normalizeProjectNameKey(project.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeNullableText = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
};

const normalizeNullableDate = (value, fieldName) => {
  const normalized = normalizeNullableText(value);
  if (normalized === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${fieldName} format`);
  }
  return normalized;
};

const normalizeEmail = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeNoteHtml = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '<p><br></p>' || raw === '<p></p>') return '<p></p>';
  return raw;
};

const plainTextToParagraphHtml = (value) => {
  const plain = String(value ?? '');
  if (!plain.trim()) return '<p></p>';
  return `<p>${plain.replace(/\n/g, '</p><p>')}</p>`;
};

const htmlToPlainText = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mapNoteResponse = (row) => {
  if (!row) return row;
  return {
    ...row,
    content: row.content_html || plainTextToParagraphHtml(row.content ?? ''),
  };
};

const NOTE_VERSION_LIMIT = 25;
const NOTE_AUTOSAVE_CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

const createNoteVersionSnapshot = async (workspaceId, actorUserId, noteRow, reason = 'update') => {
  if (!noteRow?.id) return;
  const payload = {
    note_id: noteRow.id,
    workspace_id: workspaceId,
    versioned_by: actorUserId,
    reason,
    title: noteRow.title ?? 'Untitled',
    content: noteRow.content ?? '',
    content_html: normalizeNoteHtml(
      noteRow.content_html ?? plainTextToParagraphHtml(noteRow.content ?? '')
    ),
    date: noteRow.date ?? null,
    mood: noteRow.mood ?? null,
    source: noteRow.source ?? 'workspace',
    mode: noteRow.mode ?? 'text',
    mind_map_structure: noteRow.mind_map_structure ?? null,
    parent_id: noteRow.parent_id ?? null,
    section_id: noteRow.section_id ?? null,
    sort_order: toNonNegativeInt(noteRow.sort_order, 0),
    depth: toNonNegativeInt(noteRow.depth, 0),
  };

  const isAutosaveCheckpoint = String(reason) === 'autosave_checkpoint';
  if (isAutosaveCheckpoint) {
    const { data: latestRows, error: latestError } = await supabase
      .from('note_versions')
      .select(
        'title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, reason, created_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteRow.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (latestError) {
      console.error('[notes] failed to inspect latest note version snapshot', {
        noteId: noteRow.id,
        error: latestError.message,
      });
    } else {
      const latest = Array.isArray(latestRows) ? latestRows[0] : null;
      if (latest) {
        const normalizeStructure = (value) => {
          if (value === null || value === undefined) return null;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        };

        const currentStructure = normalizeStructure(payload.mind_map_structure);
        const latestStructure = normalizeStructure(latest.mind_map_structure);
        const latestCreatedAt = latest.created_at ? new Date(latest.created_at).getTime() : 0;
        const now = Date.now();
        const latestMatchesCurrent =
          String(latest.title ?? '') === String(payload.title ?? '') &&
          String(latest.content ?? '') === String(payload.content ?? '') &&
          normalizeNoteHtml(latest.content_html ?? '') ===
            normalizeNoteHtml(payload.content_html ?? '') &&
          String(latest.date ?? '') === String(payload.date ?? '') &&
          String(latest.mood ?? '') === String(payload.mood ?? '') &&
          String(latest.source ?? '') === String(payload.source ?? '') &&
          String(latest.mode ?? '') === String(payload.mode ?? '') &&
          currentStructure === latestStructure &&
          String(latest.parent_id ?? '') === String(payload.parent_id ?? '') &&
          String(latest.section_id ?? '') === String(payload.section_id ?? '') &&
          Number(latest.sort_order ?? 0) === Number(payload.sort_order ?? 0) &&
          Number(latest.depth ?? 0) === Number(payload.depth ?? 0);

        if (
          latestMatchesCurrent ||
          (latestCreatedAt && now - latestCreatedAt < NOTE_AUTOSAVE_CHECKPOINT_INTERVAL_MS)
        ) {
          return;
        }
      }
    }
  }

  const { error: insertError } = await supabase.from('note_versions').insert(payload);
  if (insertError) {
    console.error('[notes] failed to create note version snapshot', {
      noteId: noteRow.id,
      reason,
      error: insertError.message,
    });
    return;
  }

  // Prune older revisions beyond the limit. Prefer deleting autosave checkpoints first.
  const { data: olderRows, error: listError } = await supabase
    .from('note_versions')
    .select('id, source, reason')
    .eq('note_id', noteRow.id)
    .order('created_at', { ascending: false })
    .range(NOTE_VERSION_LIMIT, NOTE_VERSION_LIMIT + 500);

  if (listError || !Array.isArray(olderRows) || olderRows.length === 0) return;

  const idsToDelete = [];
  // First, collect autosave checkpoints (source === 'autosave_checkpoint') or legacy 'update' reasons
  for (const r of olderRows) {
    if (r?.source === 'autosave_checkpoint' || String(r?.reason) === 'update')
      idsToDelete.push(r.id);
  }

  // If not enough deletable autosave rows to prune down, include other rows as a last resort
  if (idsToDelete.length < olderRows.length) {
    for (const r of olderRows) {
      if (idsToDelete.includes(r.id)) continue;
      idsToDelete.push(r.id);
    }
  }

  if (!idsToDelete.length) return;
  const { error: pruneError } = await supabase.from('note_versions').delete().in('id', idsToDelete);
  if (pruneError) {
    console.error('[notes] failed pruning note versions', {
      noteId: noteRow.id,
      error: pruneError.message,
    });
  }
};

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const buildNotesTree = (rows) => {
  const all = Array.isArray(rows) ? rows : [];
  const byId = new Map();
  const childrenByParent = new Map();

  for (const row of all) {
    byId.set(row.id, row);
  }

  for (const row of all) {
    const parentId = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(row);
  }

  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => {
      const orderDiff = toNonNegativeInt(a.sort_order) - toNonNegativeInt(b.sort_order);
      if (orderDiff !== 0) return orderDiff;
      const at = new Date(a.updated_at).getTime();
      const bt = new Date(b.updated_at).getTime();
      return bt - at;
    });
  }

  const walk = (parentId, depth) =>
    (childrenByParent.get(parentId) ?? []).map((row) => {
      const children = walk(row.id, depth + 1);
      return {
        ...row,
        depth,
        children,
      };
    });

  return walk(null, 0);
};

const flattenNotesTree = (tree, output = []) => {
  for (const node of tree) {
    output.push(node);
    if (Array.isArray(node.children) && node.children.length) {
      flattenNotesTree(node.children, output);
    }
  }
  return output;
};

const buildNoteBreadcrumb = (rows, noteId) => {
  if (!noteId) return [];
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]));
  const crumbs = [];
  const seen = new Set();
  let cursor = byId.get(noteId) ?? null;

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    crumbs.unshift({
      id: cursor.id,
      title: cursor.title || 'Untitled note',
    });
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) ?? null : null;
  }

  return crumbs;
};

const DEFAULT_NOTE_SECTIONS = [
  { name: 'Work', color: 'orange' },
  { name: 'Personal', color: 'green' },
  { name: 'Ideas', color: 'purple' },
];

const ensureDefaultNoteSections = async (workspaceId, userId) => {
  const { data: existingSections, error: existingError } = await supabase
    .from('note_sections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .limit(1);

  if (existingError) throw existingError;
  if (Array.isArray(existingSections) && existingSections.length > 0) return;

  const { data: lastSection, error: lastError } = await supabase
    .from('note_sections')
    .select('sort_order')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (lastError) throw lastError;
  let nextSortOrder = (lastSection?.[0]?.sort_order ?? -1) + 1;

  const sectionsToInsert = DEFAULT_NOTE_SECTIONS.map((section) => ({
    workspace_id: workspaceId,
    created_by: userId,
    name: section.name,
    color: section.color,
    sort_order: nextSortOrder++,
  }));

  const { error: insertError } = await supabase.from('note_sections').insert(sectionsToInsert);
  if (insertError) throw insertError;
};

const normalizeSearchTerm = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const truncatePreview = (value, length = 80) => {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trimEnd()}…`;
};

const scoreSearchResult = (title, query, preview = '', contentMatched = false) => {
  const normalizedTitle = normalizeSearchTerm(title);
  const normalizedPreview = normalizeSearchTerm(preview);
  const normalizedQuery = normalizeSearchTerm(query);

  if (!normalizedQuery) return Number.MAX_SAFE_INTEGER;
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(normalizedQuery)) return 2;
  if (contentMatched) return 3;
  if (normalizedPreview.includes(normalizedQuery)) return 4;
  return 5;
};

const isValidWorkspaceMemberRole = (role) =>
  workspaceMemberRoles.includes(String(role ?? '').toLowerCase());

const inviteMemberRoles = ['admin', 'member'];
const isValidInviteRole = (role) => inviteMemberRoles.includes(String(role ?? '').toLowerCase());

const generateInviteToken = () => crypto.randomBytes(32).toString('base64url');

const normalizeInviteOrigin = (value) => {
  const origin = String(value ?? '').trim();
  if (/^https?:\/\/[^/\s]+$/i.test(origin)) return origin.replace(/\/$/, '');
  return null;
};

const mapWorkspaceInvite = (row, nowIso = new Date().toISOString()) => {
  const isAccepted = Boolean(row.accepted_at || row.accepted_by);
  const isExpired = !isAccepted && row.expires_at && String(row.expires_at) <= nowIso;
  return {
    id: row.id,
    email: row.email ?? null,
    invited_email: row.email ?? 'Generic invite link',
    role: String(row.role ?? 'member').toLowerCase(),
    status: isAccepted ? 'accepted' : isExpired ? 'expired' : 'pending',
    expires_at: row.expires_at,
    accepted_at: row.accepted_at ?? null,
    accepted_by: row.accepted_by ?? null,
    token: row.token ?? null,
    invited_by: row.created_by,
    created_by: row.created_by,
    created_at: row.created_at,
  };
};

const userPreferencesDefaults = {
  weekStartsOn: 'monday',
  timeFormat: '12h',
  defaultEventMinutes: 30,
  reminderLeadMinutes: 15,
  openDashboardByDefault: true,
  reduceMotion: false,
  highContrast: false,
  compactDensity: false,
};

const normalizeUserPreferences = (value) => {
  const raw = value && typeof value === 'object' ? value : {};
  const merged = { ...userPreferencesDefaults, ...raw };

  const defaultEventMinutes = [30, 45, 60].includes(Number(merged.defaultEventMinutes))
    ? Number(merged.defaultEventMinutes)
    : userPreferencesDefaults.defaultEventMinutes;

  const reminderLeadMinutes = [5, 10, 15, 30].includes(Number(merged.reminderLeadMinutes))
    ? Number(merged.reminderLeadMinutes)
    : userPreferencesDefaults.reminderLeadMinutes;

  return {
    weekStartsOn: String(merged.weekStartsOn).toLowerCase() === 'sunday' ? 'sunday' : 'monday',
    timeFormat: String(merged.timeFormat).toLowerCase() === '24h' ? '24h' : '12h',
    defaultEventMinutes,
    reminderLeadMinutes,
    openDashboardByDefault: Boolean(merged.openDashboardByDefault),
    reduceMotion: Boolean(merged.reduceMotion),
    highContrast: Boolean(merged.highContrast),
    compactDensity: Boolean(merged.compactDensity),
  };
};

const roleAtLeast = (role, minimumRole) => {
  const currentRank = workspaceRoleRank[String(role ?? '').toLowerCase()] ?? 0;
  const minimumRank = workspaceRoleRank[String(minimumRole ?? '').toLowerCase()] ?? 0;
  return currentRank >= minimumRank;
};

const isMissingColumnError = (error, columnName) => {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('column') &&
    message.includes(String(columnName).toLowerCase()) &&
    message.includes('does not exist')
  );
};

const isMissingRelationError = (error, relationName) => {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    (error?.code === '42P01' || message.includes('does not exist')) &&
    message.includes(String(relationName).toLowerCase())
  );
};

const isMissingTaskTodayColumnError = (error) =>
  isMissingColumnError(error, 'show_in_today') || isMissingColumnError(error, 'is_today_focus');

const taskTodaySelectAttempts = [
  { columns: `${taskSelectColumns}, show_in_today, is_today_focus`, filter: 'show_in_today' },
  { columns: `${taskSelectColumns}, show_in_today`, filter: 'show_in_today' },
  { columns: `${taskSelectColumns}, is_today_focus`, filter: 'is_today_focus' },
];

const taskDueSelectAttempts = [...taskTodaySelectAttempts, { columns: taskSelectColumns, filter: null }];

const getRequestedWorkspaceId = (req) => {
  const headerWorkspace = req.headers['x-workspace-id'];
  if (typeof headerWorkspace === 'string' && headerWorkspace.trim()) {
    return headerWorkspace.trim();
  }

  if (Array.isArray(headerWorkspace) && headerWorkspace[0]?.trim()) {
    return headerWorkspace[0].trim();
  }

  const queryWorkspace = String(req.query?.workspaceId ?? '').trim();
  if (queryWorkspace) {
    return queryWorkspace;
  }

  return null;
};

const getUserWorkspaceIds = async (userId) => {
  const [ownedResult, memberResult] = await Promise.all([
    supabase.from('workspaces').select('id').eq('owner_id', userId),
    supabase.from('workspace_members').select('workspace_id').eq('user_id', userId),
  ]);

  if (ownedResult.error) throw ownedResult.error;
  if (memberResult.error) throw memberResult.error;

  const ids = new Set();
  for (const row of ownedResult.data ?? []) {
    if (row?.id) ids.add(row.id);
  }
  for (const row of memberResult.data ?? []) {
    if (row?.workspace_id) ids.add(row.workspace_id);
  }

  return ids;
};

const isWorkspaceAccessibleToUser = async (userId, workspaceId) => {
  if (!workspaceId) return false;
  const workspaceIds = await getUserWorkspaceIds(userId);
  return workspaceIds.has(workspaceId);
};

const getWorkspaceAccess = async (userId, workspaceId) => {
  const workspaceResult = await supabase
    .from('workspaces')
    .select('id, owner_id, name, description, is_personal, color, created_at, updated_at')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceResult.error) throw workspaceResult.error;
  const workspace = workspaceResult.data;
  if (!workspace) return null;

  if (workspace.owner_id === userId) {
    return { workspace, role: 'owner' };
  }

  const memberResult = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberResult.error) throw memberResult.error;
  if (!memberResult.data?.role) {
    return null;
  }

  return {
    workspace,
    role: String(memberResult.data.role).toLowerCase(),
  };
};

const requireWorkspaceAccess = async (userId, workspaceId, minimumRole = 'member') => {
  const access = await getWorkspaceAccess(userId, workspaceId);
  if (!access || !roleAtLeast(access.role, minimumRole)) {
    const error = new Error('Workspace access denied');
    error.statusCode = 403;
    throw error;
  }

  return access;
};

const getUserActiveWorkspaceId = async (userId) => {
  const result = await supabase
    .from('users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle();

  if (result.error) {
    if (isMissingColumnError(result.error, 'active_workspace_id')) {
      return null;
    }
    throw result.error;
  }

  return result.data?.active_workspace_id ?? null;
};

const setUserActiveWorkspaceId = async (userId, workspaceId) => {
  const result = await supabase
    .from('users')
    .update({ active_workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (result.error && !isMissingColumnError(result.error, 'active_workspace_id')) {
    throw result.error;
  }
};

const resolveWorkspaceId = async (userId, requestedWorkspaceId = null) => {
  if (requestedWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, requestedWorkspaceId);
    if (allowed) {
      await setUserActiveWorkspaceId(userId, requestedWorkspaceId);
      return requestedWorkspaceId;
    }
  }

  const activeWorkspaceId = await getUserActiveWorkspaceId(userId);
  if (activeWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, activeWorkspaceId);
    if (allowed) {
      return activeWorkspaceId;
    }
  }

  const personalWorkspace = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle();

  if (personalWorkspace.error) throw personalWorkspace.error;
  if (personalWorkspace.data?.id) {
    await setUserActiveWorkspaceId(userId, personalWorkspace.data.id);
    return personalWorkspace.data.id;
  }

  const membershipWorkspace = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipWorkspace.error) throw membershipWorkspace.error;
  if (membershipWorkspace.data?.workspace_id) {
    await setUserActiveWorkspaceId(userId, membershipWorkspace.data.workspace_id);
    return membershipWorkspace.data.workspace_id;
  }

  const createdWorkspace = await supabase
    .from('workspaces')
    .insert({
      owner_id: userId,
      name: 'My Work',
      is_personal: true,
    })
    .select('id')
    .single();

  if (createdWorkspace.error) throw createdWorkspace.error;
  if (createdWorkspace.data?.id) {
    await setUserActiveWorkspaceId(userId, createdWorkspace.data.id);
    return createdWorkspace.data.id;
  }

  throw new Error('Workspace not available');
};

const resolveWorkspaceIdForRequest = async (req) => {
  const requestedWorkspaceId = getRequestedWorkspaceId(req);
  return resolveWorkspaceId(req.authUser.id, requestedWorkspaceId);
};

const getSlackRedirectUri = () => {
  const explicit = process.env.SLACK_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const publicBackendUrl = process.env.PUBLIC_BACKEND_URL?.trim();
  if (publicBackendUrl) {
    return `${publicBackendUrl.replace(/\/$/, '')}/api/integrations/slack/oauth/callback`;
  }

  return null;
};

const getSlackStateSecret = () =>
  process.env.SLACK_SIGNING_SECRET?.trim() || supabaseServiceRole || 'ledger-slack-dev-state';

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');

const createSlackOAuthState = ({ workspaceId, installedBy }) => {
  const payload = {
    workspace_id: workspaceId,
    installed_by: installedBy,
    nonce: crypto.randomBytes(16).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getSlackStateSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
};

const verifySlackOAuthState = (state) => {
  const [encodedPayload, signature] = String(state ?? '').split('.');
  if (!encodedPayload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', getSlackStateSecret())
    .update(encodedPayload)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  const payload = safeJson(Buffer.from(encodedPayload, 'base64url').toString('utf8'), null);
  const issuedAt = Number(payload?.iat ?? 0);
  if (!payload?.workspace_id || !payload?.installed_by || !issuedAt) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > 10 * 60) return null;
  return payload;
};

const buildSlackAuthorizeUrl = ({ workspaceId, installedBy }) => {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const redirectUri = getSlackRedirectUri();
  if (!clientId || !redirectUri) {
    const error = new Error('Slack OAuth is not configured');
    error.statusCode = 500;
    throw error;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'commands,chat:write',
    redirect_uri: redirectUri,
    state: createSlackOAuthState({ workspaceId, installedBy }),
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });

const buildSlackInstallCompleteHtml = ({ teamName }) => {
  const publicBackendUrl =
    process.env.PUBLIC_BACKEND_URL?.trim() || 'https://api.ledgerworkspace.com';
  const safeTeamName = escapeHtml(teamName ? ` to ${teamName}` : '');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slack connected to Ledger</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #fffbf7;
        --card: rgba(255, 255, 255, 0.92);
        --border: rgba(17, 24, 39, 0.08);
        --text: #111827;
        --muted: #6b7280;
        --accent: #ff5f40;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .card {
        width: min(460px, 100%);
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--card);
        box-shadow: 0 18px 50px rgba(17, 24, 39, 0.08);
        padding: 32px 28px;
        text-align: center;
      }
      h1 {
        margin: 0;
        font-size: clamp(24px, 4vw, 30px);
        line-height: 1.12;
        letter-spacing: -0.03em;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
        font-size: 15px;
      }
      .eyebrow {
        margin-bottom: 14px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .actions {
        display: flex;
        justify-content: center;
        margin-top: 24px;
      }
      .button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 132px;
        height: 44px;
        padding: 0 18px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
      }
      .button.primary {
        background: var(--accent);
        color: white;
        box-shadow: none;
        transition: background-color 140ms ease, color 140ms ease;
      }
      .button.primary:hover {
        background: #ea5336;
      }
      .fineprint {
        margin-top: 12px;
        font-size: 12px;
      }
      .subcopy {
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">Ledger connected</div>
      <h1>Slack connected${safeTeamName}</h1>
      <p class="subcopy">Your Slack workspace is now linked to Ledger.</p>
      <div class="actions">
        <a class="button primary" href="ledger://settings/integrations">Open Ledger</a>
      </div>
      <p class="fineprint">If the app does not open, use the button above.</p>
    </main>
    <script>
      setTimeout(() => {
        try {
          window.location.href = 'ledger://settings/integrations';
        } catch {}
      }, 120);
    </script>
  </body>
</html>`;
};

const verifySlackRequest = (req) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) return false;

  const timestamp = String(req.headers['x-slack-request-timestamp'] ?? '');
  const signature = String(req.headers['x-slack-signature'] ?? '');
  const timestampSeconds = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(timestampSeconds)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) return false;

  const rawBody = req.rawBody ?? '';
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

const protectIntegrationTokenForStorage = (token) => {
  // TODO: replace with envelope encryption before production Slack installs.
  return token || null;
};

const parseSlackMessageTimestamp = (timestamp) => {
  const seconds = Number.parseFloat(String(timestamp ?? ''));
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
};

const normalizeSlackMessageText = (value) =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();

const buildSlackInboxTitle = (text, authorName) => {
  const cleanText = normalizeSlackMessageText(text);
  const firstLine = cleanText.split('\n').map((line) => line.trim()).find(Boolean);
  if (firstLine) {
    return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
  }
  if (authorName) return `Slack message from ${authorName}`;
  return 'Slack message';
};

const saveSlackMessageCapture = async (payload) => {
  const teamId = payload?.team?.id ?? payload?.team?.enterprise_id ?? null;
  if (!teamId) return { ok: false, reason: 'missing_team' };

  const accountResult = await supabase
    .from('integration_accounts')
    .select('id, workspace_id')
    .eq('provider', 'slack')
    .eq('provider_team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountResult.error) throw accountResult.error;
  const account = accountResult.data;
  if (!account?.workspace_id) return { ok: false, reason: 'missing_workspace' };

  const message = payload?.message ?? {};
  const channel = payload?.channel ?? {};
  const user = payload?.user ?? {};
  const messageTs = message.ts ?? payload?.message_ts ?? null;
  const threadTs = message.thread_ts ?? payload?.thread_ts ?? null;
  const channelId = channel.id ?? payload?.channel_id ?? null;
  const authorName = message.username ?? user.username ?? user.name ?? null;
  const messageText = normalizeSlackMessageText(message.text ?? '');
  const sourceId = [teamId, channelId, messageTs].filter(Boolean).join(':') || null;
  // TODO: call Slack chat.getPermalink when the shortcut payload does not include a permalink.
  const externalUrl = message.permalink ?? message.url ?? null;
  const title = buildSlackInboxTitle(messageText, authorName);

  const insertResult = await supabase.from('external_sources').insert({
    workspace_id: account.workspace_id,
    provider: 'slack',
    integration_account_id: account.id,
    external_id: sourceId,
    external_url: externalUrl,
    source_type: 'message',
    channel_id: channelId,
    channel_name: channel.name ?? null,
    author_id: message.user ?? user.id ?? null,
    author_name: authorName,
    captured_text: messageText || null,
    captured_at: parseSlackMessageTimestamp(messageTs ?? threadTs),
    raw_payload: payload,
    created_by: null,
  });

  if (insertResult.error) throw insertResult.error;

  const inboxResult = await supabase
    .from('inbox_items')
    .upsert(
      {
        workspace_id: account.workspace_id,
        user_id: account?.installed_by ?? null,
        source: 'slack',
        source_id: sourceId,
        source_url: externalUrl,
        title,
        body: messageText || null,
        raw_payload: payload,
        suggested_type: 'unknown',
        status: 'unprocessed',
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'workspace_id,source,source_id',
      }
    )
    .select('id')
    .single();

  if (inboxResult.error) throw inboxResult.error;

  return { ok: true, inboxId: inboxResult.data?.id ?? null, workspaceId: account.workspace_id };
};

const mapInboxItemResponse = (row) => {
  if (!row) return row;
  const rawPayload = row.raw_payload ?? {};
  const message = rawPayload?.message ?? {};
  const channel = rawPayload?.channel ?? {};
  const user = rawPayload?.user ?? {};
  return {
    ...row,
    channel_name: row.channel_name ?? channel.name ?? null,
    author_name:
      row.author_name ?? message.username ?? user.username ?? user.name ?? rawPayload?.user_name ?? null,
    source_label: row.source ? String(row.source).replace(/_/g, ' ') : 'inbox',
  };
};

const loadInboxItemForWorkspace = async (workspaceId, id) => {
  const result = await supabase
    .from('inbox_items')
    .select(
      'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
    )
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const withWorkspaceContext = async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    req.workspaceId = workspaceId;
    req.user = {
      workspaceId,
      userId: req.authUser.id,
    };
    next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const getCalendarId = async (workspaceId, userId) => {
  const existing = await supabase
    .from('calendars')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_personal', true)
    .maybeSingle();

  if (existing.data?.id) {
    return existing.data.id;
  }

  const created = await supabase
    .from('calendars')
    .insert({
      workspace_id: workspaceId,
      owner_id: userId,
      name: 'Personal',
      color: '#3B82F6',
      is_personal: true,
      is_default: true,
    })
    .select('id')
    .single();

  return created.data?.id ?? null;
};

const ensureWorkspaceResource = async (table, id, workspaceId) => {
  const result = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return Boolean(result.data?.id);
};

const isMissingTableError = (error) => {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
};

const withReminderTable = async (queryFactory) => {
  let lastError = null;

  for (const table of REMINDER_TABLES) {
    const result = await queryFactory(table);
    if (!result?.error) {
      return result;
    }

    lastError = result.error;
    if (!isMissingTableError(result.error)) {
      return result;
    }
  }

  return { data: null, error: lastError ?? new Error('Reminder table lookup failed') };
};

const writeWorkspaceAuditLog = async ({
  workspaceId,
  actorUserId,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
}) => {
  try {
    const payload = {
      workspace_id: workspaceId,
      actor_user_id: actorUserId,
      action: String(action ?? '').trim(),
      target_type: targetType,
      target_id: targetId,
      metadata: metadata ?? null,
    };

    if (!payload.workspace_id || !payload.actor_user_id || !payload.action) {
      return;
    }

    const { error } = await supabase.from('workspace_audit_logs').insert(payload);

    if (error && !isMissingTableError(error)) {
      console.error('Failed to write workspace audit log:', error.message);
    }
  } catch (error) {
    console.error('Unexpected audit log failure:', error?.message ?? error);
  }
};

const getLimitCount = async (resource, workspaceId) => {
  const tableMap = {
    projects: 'projects',
    tasks: 'tasks',
    events: 'events',
    reminders: 'calendar_reminders',
    notes: 'notes',
  };

  const selectColumns = resource === 'projects' ? 'status' : 'id';
  const reminderCount =
    resource === 'reminders'
      ? await withReminderTable((table) =>
          supabase.from(table).select(selectColumns).eq('workspace_id', workspaceId)
        )
      : null;

  const { data, error } =
    resource === 'reminders'
      ? reminderCount
      : await supabase
          .from(tableMap[resource])
          .select(selectColumns)
          .eq('workspace_id', workspaceId);

  if (error) {
    throw error;
  }

  if (resource === 'projects') {
    return (data ?? []).filter((project) => !isCompletedProjectStatus(project?.status)).length;
  }

  return (data ?? []).length;
};

const quotaGuard = (resource) => async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    req.workspaceId = workspaceId;

    const tier = getUserTier(req.authUser);
    const limit = TIER_LIMITS[tier][resource];
    if (limit === Infinity) {
      return next();
    }

    const current = await getLimitCount(resource, workspaceId);
    if (current >= limit) {
      return res
        .status(429)
        .json({ error: `${resource} limit reached for your tier`, limit, current });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Quota check failed' });
  }
};

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/integrations/slack/status', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const result = await supabase
      .from('integration_accounts')
      .select('id, provider_team_id, provider_team_name, bot_user_id, scopes, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) {
      if (isMissingRelationError(result.error, 'integration_accounts')) {
        return res.json({ connected: false });
      }
      throw result.error;
    }

    if (!result.data?.id) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      team_id: result.data.provider_team_id ?? null,
      team_name: result.data.provider_team_name ?? null,
      bot_user_id: result.data.bot_user_id ?? null,
      scopes: result.data.scopes ?? [],
      updated_at: result.data.updated_at ?? null,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/integrations/slack/captures', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const result = await supabase
      .from('external_sources')
      .select(
        'id, external_url, channel_name, author_name, captured_text, captured_at, created_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack')
      .order('created_at', { ascending: false })
      .limit(5);

    if (result.error) {
      if (isMissingRelationError(result.error, 'external_sources')) {
        return res.json([]);
      }
      throw result.error;
    }

    res.json(result.data ?? []);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.delete('/api/integrations/slack/disconnect', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

    const result = await supabase
      .from('integration_accounts')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack');

    if (result.error) {
      if (isMissingRelationError(result.error, 'integration_accounts')) {
        return res.json({ connected: false });
      }
      throw result.error;
    }

    res.json({ connected: false });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/integrations/slack/install-url', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    res.json({
      url: buildSlackAuthorizeUrl({ workspaceId, installedBy: req.authUser.id }),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/integrations/slack/install', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    res.redirect(buildSlackAuthorizeUrl({ workspaceId, installedBy: req.authUser.id }));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/integrations/slack/oauth/callback', rateLimit('auth'), async (req, res) => {
  try {
    const code = String(req.query?.code ?? '').trim();
    const state = String(req.query?.state ?? '').trim();
    if (!code) return res.status(400).send('Missing Slack OAuth code');

    const statePayload = verifySlackOAuthState(state);
    if (!statePayload) return res.status(400).send('Invalid Slack OAuth state');

    const clientId = process.env.SLACK_CLIENT_ID?.trim();
    const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
    const redirectUri = getSlackRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send('Slack OAuth is not configured');
    }

    await requireWorkspaceAccess(
      statePayload.installed_by,
      statePayload.workspace_id,
      'admin'
    );

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenPayload?.ok) {
      return res
        .status(400)
        .send(`Slack OAuth failed: ${tokenPayload?.error ?? 'unknown_error'}`);
    }

    const teamId = tokenPayload.team?.id ?? null;
    const teamName = tokenPayload.team?.name ?? null;
    if (!teamId) return res.status(400).send('Slack OAuth response missing team id');

    const scopes = String(tokenPayload.scope ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    const existing = await supabase
      .from('integration_accounts')
      .select('id')
      .eq('workspace_id', statePayload.workspace_id)
      .eq('provider', 'slack')
      .eq('provider_team_id', teamId)
      .maybeSingle();

    if (existing.error) throw existing.error;

    const accountPayload = {
      workspace_id: statePayload.workspace_id,
      provider: 'slack',
      provider_team_id: teamId,
      provider_team_name: teamName,
      provider_user_id: tokenPayload.authed_user?.id ?? null,
      bot_user_id: tokenPayload.bot_user_id ?? null,
      access_token_encrypted: protectIntegrationTokenForStorage(tokenPayload.access_token),
      refresh_token_encrypted: protectIntegrationTokenForStorage(tokenPayload.refresh_token),
      scopes,
      installed_by: statePayload.installed_by,
      updated_at: new Date().toISOString(),
    };

    const accountResult = existing.data?.id
      ? await supabase
          .from('integration_accounts')
          .update(accountPayload)
          .eq('id', existing.data.id)
      : await supabase.from('integration_accounts').insert(accountPayload);

    if (accountResult.error) throw accountResult.error;

    res.status(200).type('html').send(buildSlackInstallCompleteHtml({ teamName }));
  } catch (error) {
    console.error('Slack OAuth callback failed', error);
    res.status(error.statusCode || 500).send(error.message || 'Slack OAuth callback failed');
  }
});

app.post('/api/integrations/slack/interactivity', rateLimit('write'), async (req, res) => {
  if (!verifySlackRequest(req)) {
    return res.status(401).send('Invalid Slack signature');
  }

  const payload = safeJson(req.body?.payload, null);
  if (!payload) return res.status(400).send('Missing Slack payload');

  if (payload.callback_id !== 'save_to_ledger') {
    return res.status(200).json({ response_type: 'ephemeral', text: 'Unsupported Ledger action.' });
  }

  try {
    const result = await saveSlackMessageCapture(payload);
    if (!result?.ok) {
      const fallbackMessage =
        result?.reason === 'missing_workspace'
          ? 'Ledger is connected, but no workspace is selected yet. Open Ledger settings to finish setup.'
          : 'Ledger could not save this message right now.';
      return res.status(200).json({
        response_type: 'ephemeral',
        text: fallbackMessage,
      });
    }

    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Saved to Ledger Inbox.',
    });
  } catch (error) {
    console.error('Slack capture failed', error);
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Ledger could not save this message right now.',
    });
  }
});

app.get('/api/inbox/count', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { count, error } = await supabase
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'unprocessed');

    if (error) throw error;
    res.json({ count: count ?? 0 });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/inbox', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const status = String(req.query?.status ?? 'unprocessed').trim() || 'unprocessed';
    const source = String(req.query?.source ?? '').trim();

    let query = supabase
      .from('inbox_items')
      .select(
        'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);

    const { data, error } = await query;
    if (error) throw error;
    res.json((data ?? []).map(mapInboxItemResponse));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/inbox/:id/archive', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!allowed) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }

    const { data, error } = await supabase
      .from('inbox_items')
      .update({
        status: 'archived',
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .select(
        'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
      )
      .single();

    if (error) throw error;
    res.json(mapInboxItemResponse(data));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/inbox/:id/convert', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const inboxItem = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!inboxItem) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }
    if (String(inboxItem.status ?? '') === 'converted') {
      return res.status(409).json({ error: 'Inbox item has already been converted' });
    }

    const type = String(req.body?.type ?? '').trim().toLowerCase();
    const title = String(req.body?.title ?? inboxItem.title ?? '').trim();
    const body = normalizeNullableText(req.body?.body ?? inboxItem.body);
    const rawTitle = title || inboxItem.title || 'Untitled';
    const inboxNotes = inboxItem.source_url
      ? `${body ? `${body}\n\n` : ''}Source: ${inboxItem.source_url}`
      : body;
    let createdId = null;

    if (type === 'task') {
      const taskPayload = {
        workspace_id: workspaceId,
        project_id: req.body?.project_id ? String(req.body.project_id) : null,
        title: rawTitle,
        description: inboxNotes ? `inbox:${inboxItem.id}` : `inbox:${inboxItem.id}`,
        notes: inboxNotes || null,
        due_date: req.body?.due_date ? normalizeNullableDate(req.body.due_date, 'due date') : null,
        due_time: req.body?.due_time ? normalizeNullableText(req.body.due_time) : null,
        status: req.body?.status ? String(req.body.status) : 'todo',
        priority: req.body?.priority ? String(req.body.priority) : 'medium',
        tags: Array.isArray(req.body?.tags)
          ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [],
        show_in_today: Boolean(req.body?.show_in_today ?? false),
        is_today_focus: Boolean(req.body?.is_today_focus ?? false),
      };

      if (taskPayload.project_id) {
        const projectAllowed = await ensureWorkspaceResource(
          'projects',
          String(taskPayload.project_id),
          workspaceId
        );
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }

      let createdTask = null;
      for (const attempt of taskTodaySelectAttempts) {
        const { data, error } = await supabase
          .from('tasks')
          .insert(taskPayload)
          .select(attempt.columns)
          .single();

        if (!error) {
          createdTask = data;
          break;
        }

        if (isMissingTaskTodayColumnError(error)) {
          continue;
        }

        throw error;
      }
      if (!createdTask) {
        return res.status(500).json({ error: 'Could not create task from inbox item' });
      }
      createdId = createdTask.id;
      const inboxUpdate = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'task',
          converted_id: createdId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(
          'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
        )
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: createdTask,
      });
    }

    if (type === 'note') {
      const noteDate = req.body?.date
        ? normalizeNullableDate(req.body.date, 'date')
        : new Date().toISOString().slice(0, 10);
      const contentHtml = normalizeNoteHtml(
        req.body?.content_html ?? plainTextToParagraphHtml(body || rawTitle)
      );
      const content = htmlToPlainText(contentHtml);
      const { data, error } = await supabase
        .from('notes')
        .insert({
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          title: rawTitle,
          content,
          content_html: contentHtml,
          date: noteDate,
          mood: null,
          source: 'inbox',
          mode: 'text',
          mind_map_structure: null,
          parent_id: null,
          section_id: null,
          sort_order: 0,
          depth: 0,
        })
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
        )
        .single();
      if (error) throw error;
      createdId = data.id;
      const inboxUpdate = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'note',
          converted_id: createdId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(
          'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
        )
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: data,
      });
    }

    if (type === 'reminder') {
      const reminderAt = String(req.body?.remind_at ?? '').trim();
      if (!reminderAt) {
        return res.status(400).json({ error: 'remind_at is required' });
      }
      const calendarId = req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id));
      const reminderPayload = {
        workspace_id: workspaceId,
        calendar_id: calendarId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title: rawTitle,
        remind_at: reminderAt,
        color: req.body?.color || null,
        is_done: false,
        notes: inboxNotes || null,
        project_id: req.body?.project_id || null,
        note_id: req.body?.note_id || null,
      };
      if (reminderPayload.project_id) {
        const projectAllowed = await ensureWorkspaceResource(
          'projects',
          String(reminderPayload.project_id),
          workspaceId
        );
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }
      if (reminderPayload.note_id) {
        const noteAllowed = await ensureWorkspaceResource(
          'notes',
          String(reminderPayload.note_id),
          workspaceId
        );
        if (!noteAllowed) {
          return res.status(404).json({ error: 'Note not found' });
        }
      }
      const { data, error } = await withReminderTable((table) =>
        supabase
          .from(table)
          .insert(reminderPayload)
          .select('id, title, remind_at, calendar_id, color, is_done, notes, project_id, note_id')
          .single()
      );
      if (error) throw error;
      createdId = data.id;
      const inboxUpdate = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'reminder',
          converted_id: createdId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(
          'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
        )
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: data,
      });
    }

    if (type === 'event') {
      const startAt = String(req.body?.start_at ?? '').trim();
      if (!startAt) {
        return res.status(400).json({ error: 'start_at is required' });
      }
      const endAt = String(req.body?.end_at ?? '').trim() || null;
      const calendarId = req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id));
      const { data, error } = await supabase
        .from('events')
        .insert({
          workspace_id: workspaceId,
          calendar_id: calendarId,
          created_by: req.authUser.id,
          updated_by: req.authUser.id,
          title: rawTitle,
          start_at: startAt,
          end_at: endAt,
          color: req.body?.color || null,
          status: req.body?.status || 'planned',
          recurrence_rule: req.body?.recurrence_rule || null,
          notes: inboxNotes || null,
          location: req.body?.location || null,
          all_day: Boolean(req.body?.all_day ?? false),
          project_id: req.body?.project_id || null,
          linked_project_id: req.body?.project_id || null,
          note_id: req.body?.note_id || null,
        })
        .select(
          'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id'
        )
        .single();
      if (error) throw error;
      createdId = data.id;
      const inboxUpdate = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'event',
          converted_id: createdId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(
          'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
        )
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: data,
      });
    }

    return res.status(400).json({ error: 'Unsupported inbox conversion type' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/user/onboarding', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('onboarding_completed')
      .eq('id', req.authUser.id)
      .maybeSingle();

    if (error) throw error;
    res.json({ onboarding_completed: Boolean(data?.onboarding_completed) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/user/onboarding', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    let { data, error } = await supabase
      .from('users')
      .update({ onboarding_completed: true, onboarding_completed_at: nowIso })
      .eq('id', req.authUser.id)
      .select('onboarding_completed')
      .maybeSingle();

    if (error) throw error;

    // Some legacy accounts can authenticate before a users row is materialized.
    // In that case, create the row and persist onboarding in one write.
    if (!data) {
      const insertResult = await supabase
        .from('users')
        .insert({
          id: req.authUser.id,
          email: req.authUser.email ?? null,
          full_name: normalizeNullableText(req.authUser.user_metadata?.full_name),
          onboarding_completed: true,
          onboarding_completed_at: nowIso,
        })
        .select('onboarding_completed')
        .single();

      if (insertResult.error) throw insertResult.error;
      data = insertResult.data;
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/settings', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(
        'id, email, full_name, active_workspace_id, onboarding_completed, preferences, updated_at'
      )
      .eq('id', req.authUser.id)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      full_name: data.full_name ?? null,
      email: data.email ?? null,
      active_workspace_id: data.active_workspace_id ?? null,
      onboarding_completed: Boolean(data.onboarding_completed),
      preferences: normalizeUserPreferences(safeJson(data.preferences, {})),
      updated_at: data.updated_at ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/user/settings', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const fullNameInput = req.body?.full_name;
    const preferencesInput = req.body?.preferences;

    const updatePayload = {};

    if (fullNameInput !== undefined) {
      const normalizedFullName = normalizeNullableText(fullNameInput);
      updatePayload.full_name = normalizedFullName;

      try {
        await supabase.auth.admin.updateUserById(req.authUser.id, {
          user_metadata: {
            ...(req.authUser.user_metadata ?? {}),
            full_name: normalizedFullName ?? '',
          },
        });
      } catch (authError) {
        console.error('Failed to sync auth metadata for user settings', authError);
      }
    }

    if (preferencesInput !== undefined) {
      updatePayload.preferences = normalizeUserPreferences(preferencesInput);
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No settings updates provided' });
    }

    updatePayload.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', req.authUser.id)
      .select(
        'id, email, full_name, active_workspace_id, onboarding_completed, preferences, updated_at'
      )
      .single();

    if (error) throw error;

    res.json({
      full_name: data.full_name ?? null,
      email: data.email ?? null,
      active_workspace_id: data.active_workspace_id ?? null,
      onboarding_completed: Boolean(data.onboarding_completed),
      preferences: normalizeUserPreferences(safeJson(data.preferences, {})),
      updated_at: data.updated_at ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/workspaces', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const [ownedResult, memberResult] = await Promise.all([
      supabase
        .from('workspaces')
        .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('workspace_members')
        .select('workspace_id, role, joined_at')
        .eq('user_id', userId),
    ]);

    if (ownedResult.error) throw ownedResult.error;
    if (memberResult.error) throw memberResult.error;

    const memberWorkspaceIds = (memberResult.data ?? []).map((row) => row.workspace_id);
    let memberWorkspaces = [];

    if (memberWorkspaceIds.length > 0) {
      const memberWorkspaceResult = await supabase
        .from('workspaces')
        .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
        .in('id', memberWorkspaceIds);

      if (memberWorkspaceResult.error) throw memberWorkspaceResult.error;
      memberWorkspaces = memberWorkspaceResult.data ?? [];
    }

    const roleByWorkspaceId = new Map(
      (memberResult.data ?? []).map((row) => [row.workspace_id, row.role])
    );
    const merged = [...(ownedResult.data ?? []), ...memberWorkspaces];
    const dedupedById = new Map();

    for (const workspace of merged) {
      if (!workspace?.id) continue;
      const role =
        workspace.owner_id === userId ? 'owner' : roleByWorkspaceId.get(workspace.id) ?? 'member';
      dedupedById.set(workspace.id, {
        ...workspace,
        role,
      });
    }

    const sorted = [...dedupedById.values()].sort((a, b) => {
      if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });

    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workspaces', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const isPersonal = Boolean(req.body?.is_personal);
    const color = String(req.body?.color ?? '').trim() || '#007AFF';

    if (!name) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }

    const insertResult = await supabase
      .from('workspaces')
      .insert({
        owner_id: userId,
        name,
        description: description || null,
        is_personal: isPersonal,
        color,
      })
      .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
      .single();

    if (insertResult.error) throw insertResult.error;

    await setUserActiveWorkspaceId(userId, insertResult.data.id);
    await writeWorkspaceAuditLog({
      workspaceId: insertResult.data.id,
      actorUserId: userId,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: insertResult.data.id,
      metadata: {
        name,
        is_personal: isPersonal,
      },
    });

    res.status(201).json({
      workspace_id: insertResult.data.id,
      workspace: insertResult.data,
      current_user_role: 'owner',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/workspaces/active', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const activeWorkspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
      .eq('id', activeWorkspaceId)
      .maybeSingle();

    if (error) throw error;
    res.json({ workspace_id: activeWorkspaceId, workspace: data ?? null });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.patch('/api/workspaces/active', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.body?.workspace_id ?? '').trim();
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace id is required' });
    }

    const access = await getWorkspaceAccess(req.authUser.id, workspaceId);
    if (!access) {
      return res.status(403).json({ error: 'Workspace access denied' });
    }

    await setUserActiveWorkspaceId(req.authUser.id, workspaceId);

    res.json({
      workspace_id: workspaceId,
      workspace: access.workspace,
      current_user_role: access.role,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.patch(
  '/api/workspaces/:workspaceId([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
      const name = String(req.body?.name ?? '').trim();
      const description = String(req.body?.description ?? '').trim();

      if (!name) {
        return res.status(400).json({ error: 'Workspace name is required' });
      }

      const updated = await supabase
        .from('workspaces')
        .update({
          name,
          description: description || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', workspaceId)
        .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
        .single();

      if (updated.error) throw updated.error;

      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: {
          name,
          description: description || null,
          actor_role: access.role,
        },
      });

      res.json({
        workspace_id: workspaceId,
        workspace: updated.data,
        current_user_role: access.role,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.delete(
  '/api/workspaces/:workspaceId([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'owner');
      const deletedWorkspace = access.workspace;

      // Write an audit entry before deleting the workspace so the
      // foreign key to workspaces(id) remains valid. Inserting the
      // audit log after deletion can violate the FK constraint.
      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'workspace.deleted',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: {
          name: deletedWorkspace.name,
          is_personal: deletedWorkspace.is_personal,
        },
      });

      const deleted = await supabase.from('workspaces').delete().eq('id', workspaceId);

      if (deleted.error) throw deleted.error;

      res.json({ deleted_workspace_id: workspaceId });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.get(
  '/api/workspaces/:workspaceId/members',
  authMiddleware,
  rateLimit('read'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

      const membersResult = await supabase
        .from('workspace_members')
        .select('user_id, role, joined_at')
        .eq('workspace_id', workspaceId);

      if (membersResult.error) throw membersResult.error;
      const memberRows = membersResult.data ?? [];

      const userIds = [access.workspace.owner_id, ...memberRows.map((row) => row.user_id)];
      const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

      const usersResult =
        uniqueUserIds.length === 0
          ? { data: [], error: null }
          : await supabase.from('users').select('id, email, full_name').in('id', uniqueUserIds);

      if (usersResult.error) throw usersResult.error;

      const userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user]));

      const ownerUser = userMap.get(access.workspace.owner_id);
      const ownerRow = {
        user_id: access.workspace.owner_id,
        role: 'owner',
        joined_at: access.workspace.created_at,
        email: ownerUser?.email ?? null,
        full_name: ownerUser?.full_name ?? null,
        is_owner: true,
      };

      const normalizedMembers = memberRows
        .filter((row) => row.user_id !== access.workspace.owner_id)
        .map((row) => {
          const user = userMap.get(row.user_id);
          return {
            user_id: row.user_id,
            role: String(row.role).toLowerCase(),
            joined_at: row.joined_at,
            email: user?.email ?? null,
            full_name: user?.full_name ?? null,
            is_owner: false,
          };
        })
        .sort((a, b) => String(a.joined_at ?? '').localeCompare(String(b.joined_at ?? '')));

      res.json({
        current_user_role: access.role,
        members: [ownerRow, ...normalizedMembers],
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.patch(
  '/api/workspaces/:workspaceId/members/:userId',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const targetUserId = String(req.params.userId);
      const role = String(req.body?.role ?? '').toLowerCase();

      if (!isValidWorkspaceMemberRole(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

      if (targetUserId === access.workspace.owner_id) {
        return res.status(400).json({ error: 'Owner role cannot be changed' });
      }

      const existing = await supabase
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (existing.error) throw existing.error;
      if (!existing.data?.user_id) {
        return res.status(404).json({ error: 'Member not found' });
      }

      const currentRole = String(existing.data.role ?? '').toLowerCase();
      if (access.role !== 'owner') {
        if (role === 'admin') {
          return res.status(403).json({ error: 'Only owners can assign admin role' });
        }
        if (currentRole === 'admin') {
          return res.status(403).json({ error: 'Only owners can modify admin members' });
        }
      }

      const updated = await supabase
        .from('workspace_members')
        .update({ role })
        .eq('workspace_id', workspaceId)
        .eq('user_id', targetUserId)
        .select('user_id, role, joined_at')
        .single();

      if (updated.error) throw updated.error;
      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'member.role_updated',
        targetType: 'workspace_member',
        targetId: targetUserId,
        metadata: {
          previous_role: currentRole,
          next_role: role,
          actor_role: access.role,
        },
      });
      res.json(updated.data);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.delete(
  '/api/workspaces/:workspaceId/members/:userId',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const targetUserId = String(req.params.userId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

      if (targetUserId === access.workspace.owner_id) {
        return res.status(400).json({ error: 'Owner cannot be removed' });
      }

      if (targetUserId === req.authUser.id) {
        return res.status(400).json({ error: 'Use leave workspace flow for your own membership' });
      }

      const existing = await supabase
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (existing.error) throw existing.error;
      if (!existing.data?.user_id) {
        return res.status(404).json({ error: 'Member not found' });
      }

      const targetUserResult = await supabase
        .from('users')
        .select('email')
        .eq('id', targetUserId)
        .maybeSingle();

      if (targetUserResult.error) throw targetUserResult.error;

      const targetEmail = normalizeEmail(targetUserResult.data?.email) || null;
      const currentRole = String(existing.data.role ?? '').toLowerCase();
      if (access.role !== 'owner' && currentRole === 'admin') {
        return res.status(403).json({ error: 'Only owners can remove admin members' });
      }

      const removed = await supabase
        .from('workspace_members')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('user_id', targetUserId);

      if (removed.error) throw removed.error;

      const removedInviteByAcceptedBy = await supabase
        .from('workspace_invites')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('accepted_by', targetUserId);

      if (removedInviteByAcceptedBy.error) throw removedInviteByAcceptedBy.error;

      if (targetEmail) {
        const removedInviteByEmail = await supabase
          .from('workspace_invites')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('email', targetEmail);

        if (removedInviteByEmail.error) throw removedInviteByEmail.error;
      }

      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'member.removed',
        targetType: 'workspace_member',
        targetId: targetUserId,
        metadata: {
          removed_role: currentRole,
          actor_role: access.role,
        },
      });
      res.json({ success: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.get(
  '/api/workspaces/:workspaceId/invitations',
  authMiddleware,
  rateLimit('read'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

      const invitationsResult = await supabase
        .from('workspace_invites')
        .select(
          'id, email, role, token, expires_at, accepted_at, accepted_by, created_by, created_at'
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (invitationsResult.error) throw invitationsResult.error;

      res.json({
        current_user_role: access.role,
        invitations: (invitationsResult.data ?? []).map((invite) => mapWorkspaceInvite(invite)),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.post(
  '/api/workspaces/:workspaceId/invitations',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
      const invitedEmail = normalizeEmail(req.body?.email) || null;
      const role = String(req.body?.role ?? 'member').toLowerCase();

      if (invitedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
        return res.status(400).json({ error: 'Enter a valid email address or leave it blank' });
      }

      if (!isValidInviteRole(role)) {
        return res.status(400).json({ error: 'Invalid invitation role' });
      }

      if (invitedEmail) {
        const ownerEmailResult = await supabase
          .from('users')
          .select('email')
          .eq('id', access.workspace.owner_id)
          .maybeSingle();

        if (ownerEmailResult.error) throw ownerEmailResult.error;
        if (normalizeEmail(ownerEmailResult.data?.email) === invitedEmail) {
          return res.status(409).json({ error: 'User is already the workspace owner' });
        }

        const existingUserResult = await supabase
          .from('users')
          .select('id, email')
          .ilike('email', invitedEmail)
          .maybeSingle();

        if (existingUserResult.error) throw existingUserResult.error;

        if (existingUserResult.data?.id) {
          const membershipResult = await supabase
            .from('workspace_members')
            .select('user_id')
            .eq('workspace_id', workspaceId)
            .eq('user_id', existingUserResult.data.id)
            .maybeSingle();

          if (membershipResult.error) throw membershipResult.error;
          if (membershipResult.data?.user_id) {
            return res.status(409).json({ error: 'User is already a member of this workspace' });
          }
        }

        const existingPending = await supabase
          .from('workspace_invites')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('email', invitedEmail)
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();

        if (existingPending.error) throw existingPending.error;
        if (existingPending.data?.id) {
          return res.status(409).json({ error: 'A pending invite already exists for this email' });
        }
      }

      const token = generateInviteToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const insertResult = await supabase
        .from('workspace_invites')
        .insert({
          workspace_id: workspaceId,
          email: invitedEmail,
          role,
          token,
          created_by: req.authUser.id,
          expires_at: expiresAt,
        })
        .select(
          'id, email, role, token, expires_at, accepted_at, accepted_by, created_by, created_at'
        )
        .single();

      if (insertResult.error) throw insertResult.error;

      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'invite.created',
        targetType: 'workspace_invite',
        targetId: insertResult.data.id,
        metadata: {
          email: invitedEmail,
          role,
        },
      });

      const appOrigin = normalizeInviteOrigin(req.body?.origin || req.get('origin'));
      if (!appOrigin) {
        return res.status(400).json({
          error:
            'Invite base URL is required. Set VITE_INVITE_BASE_URL or send the request origin.',
        });
      }
      const inviteUrl = `${appOrigin}/invite/${encodeURIComponent(token)}`;

      res.json({
        invitation: mapWorkspaceInvite(insertResult.data),
        invite_url: inviteUrl,
        invite_token: token,
        current_user_role: access.role,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.delete(
  '/api/workspaces/:workspaceId/invitations/:invitationId',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId);
      const invitationId = String(req.params.invitationId);
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

      const existing = await supabase
        .from('workspace_invites')
        .select('id, role, email, accepted_at')
        .eq('id', invitationId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (existing.error) throw existing.error;
      if (!existing.data?.id) {
        return res.status(404).json({ error: 'Invite not found' });
      }

      if (existing.data.accepted_at) {
        return res.status(400).json({ error: 'Accepted invites cannot be revoked' });
      }

      const deleted = await supabase
        .from('workspace_invites')
        .delete()
        .eq('id', invitationId)
        .eq('workspace_id', workspaceId)
        .is('accepted_at', null);

      if (deleted.error) throw deleted.error;

      await writeWorkspaceAuditLog({
        workspaceId,
        actorUserId: req.authUser.id,
        action: 'invite.revoked',
        targetType: 'workspace_invite',
        targetId: invitationId,
        metadata: {
          email: existing.data.email,
          role: String(existing.data.role).toLowerCase(),
          actor_role: access.role,
        },
      });

      res.json({ success: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  }
);

app.get('/api/invitations/:token', rateLimit('read'), async (req, res) => {
  try {
    const token = String(req.params.token ?? '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Invitation token is required' });
    }

    const inviteResult = await supabase
      .from('workspace_invites')
      .select('id, workspace_id, email, role, expires_at, accepted_at, accepted_by, created_at')
      .eq('token', token)
      .maybeSingle();

    if (inviteResult.error) throw inviteResult.error;
    const invite = inviteResult.data;
    if (!invite?.id) {
      return res.status(404).json({ error: 'Invitation not found', status: 'invalid' });
    }

    const workspaceResult = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', invite.workspace_id)
      .maybeSingle();

    if (workspaceResult.error) throw workspaceResult.error;

    const mapped = mapWorkspaceInvite(invite);
    if (mapped.status === 'expired') {
      return res.status(400).json({ error: 'Invitation has expired', status: 'expired' });
    }
    if (mapped.status === 'accepted') {
      return res
        .status(400)
        .json({ error: 'Invitation has already been used', status: 'accepted' });
    }

    res.json({
      status: mapped.status,
      invitation: {
        id: mapped.id,
        email: mapped.email,
        role: mapped.role,
        expires_at: mapped.expires_at,
        workspace_id: invite.workspace_id,
        workspace_name: workspaceResult.data?.name ?? 'Workspace',
      },
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/invitations/accept', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Invitation token is required' });
    }

    const nowIso = new Date().toISOString();
    const inviteResult = await supabase
      .from('workspace_invites')
      .select('id, workspace_id, email, role, expires_at, accepted_at, accepted_by')
      .eq('token', token)
      .maybeSingle();

    if (inviteResult.error) throw inviteResult.error;
    const invitation = inviteResult.data;

    if (!invitation?.id) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (
      invitation.expires_at &&
      String(invitation.expires_at) <= nowIso &&
      !invitation.accepted_at
    ) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    if (invitation.accepted_at) {
      return res.status(400).json({ error: 'Invitation has already been used' });
    }

    const invitedEmail = normalizeEmail(invitation.email);
    const authEmail = normalizeEmail(req.authUser.email);
    if (invitedEmail && invitedEmail !== authEmail) {
      return res.status(403).json({ error: 'Invitation email does not match your account' });
    }

    const existingAccess = await getWorkspaceAccess(req.authUser.id, invitation.workspace_id);
    if (existingAccess) {
      await supabase
        .from('workspace_invites')
        .update({ accepted_at: nowIso, accepted_by: req.authUser.id })
        .eq('id', invitation.id)
        .is('accepted_at', null);

      await setUserActiveWorkspaceId(req.authUser.id, invitation.workspace_id);

      return res.json({
        success: true,
        already_member: true,
        workspace_id: invitation.workspace_id,
      });
    }

    const insertMembership = await supabase.from('workspace_members').upsert(
      {
        workspace_id: invitation.workspace_id,
        user_id: req.authUser.id,
        role: String(invitation.role).toLowerCase(),
      },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true }
    );

    if (insertMembership.error) throw insertMembership.error;

    const markAccepted = await supabase
      .from('workspace_invites')
      .update({ accepted_at: nowIso, accepted_by: req.authUser.id })
      .eq('id', invitation.id)
      .is('accepted_at', null);

    if (markAccepted.error) throw markAccepted.error;

    await setUserActiveWorkspaceId(req.authUser.id, invitation.workspace_id);

    await writeWorkspaceAuditLog({
      workspaceId: invitation.workspace_id,
      actorUserId: req.authUser.id,
      action: 'invite.accepted',
      targetType: 'workspace_invite',
      targetId: invitation.id,
      metadata: {
        email: invitation.email,
        role: String(invitation.role).toLowerCase(),
      },
    });

    res.json({
      success: true,
      workspace_id: invitation.workspace_id,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/projects', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const includeCompleted = ['true', '1', 'yes'].includes(
      String(req.query?.includeCompleted ?? '').toLowerCase()
    );
    const { data, error } = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(24);

    if (error) throw error;
    const projects = dedupeProjectsByName(data ?? []);
    res.json(
      includeCompleted
        ? projects
        : projects.filter((project) => !isCompletedProjectStatus(project.status)).slice(0, 8)
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/projects',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('projects'),
  async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Project name required' });
      }

      const description = normalizeNullableText(req.body?.description);
      const startDate = normalizeNullableDate(req.body?.start_date, 'start date');
      const endDate = normalizeNullableDate(req.body?.end_date, 'end date');
      const color = normalizeNullableText(req.body?.color);
      const status = req.body?.status
        ? projectStatusAliases[normalizeProjectSemanticStatus(req.body.status)][0]
        : 'NotStarted';

      const { data: existingProject, error: existingError } = await supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', req.workspaceId)
        .ilike('name', name)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existingProject) {
        return res.json(existingProject);
      }

      const { data, error } = await supabase
        .from('projects')
        .insert({
          workspace_id: req.workspaceId,
          created_by: req.authUser.id,
          name,
          description,
          status,
          completeness: 0,
          color: color || '#007AFF',
          start_date: startDate,
          end_date: endDate,
        })
        .select(projectSelectColumns)
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/projects/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await ensureWorkspaceResource('projects', req.params.id, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const update = {};
    if (req.body?.name !== undefined) {
      const nextName = String(req.body.name).trim();
      if (!nextName) {
        return res.status(400).json({ error: 'Project name required' });
      }
      const nameConflict = await supabase
        .from('projects')
        .select('id')
        .eq('workspace_id', workspaceId)
        .ilike('name', nextName)
        .neq('id', req.params.id)
        .maybeSingle();

      if (nameConflict.error) throw nameConflict.error;
      if (nameConflict.data) {
        return res
          .status(409)
          .json({ error: 'A project with that name already exists in this workspace' });
      }
      update.name = nextName;
    }
    if (req.body?.description !== undefined)
      update.description = normalizeNullableText(req.body.description);
    if (req.body?.status) {
      const semantic = normalizeProjectSemanticStatus(req.body.status);
      update.status = projectStatusAliases[semantic][0];
    }
    if (req.body?.completeness !== undefined) {
      update.completeness = Math.max(0, Math.min(100, Number(req.body.completeness)));
    }
    if (req.body?.color !== undefined)
      update.color = normalizeNullableText(req.body.color) || '#007AFF';
    if (req.body?.start_date !== undefined)
      update.start_date = normalizeNullableDate(req.body.start_date, 'start date');
    if (req.body?.end_date !== undefined)
      update.end_date = normalizeNullableDate(req.body.end_date, 'end date');
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(projectSelectColumns)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/projects/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:id/note-links', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const projectId = String(req.params.id);
    const allowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { data, error } = await supabase
      .from('project_note_links')
      .select('id, note_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const noteIds = (data ?? []).map((row) => row.note_id).filter(Boolean);
    let noteById = new Map();
    if (noteIds.length > 0) {
      const notesResult = await supabase
        .from('notes')
        .select('id, title, content, content_html, updated_at')
        .eq('workspace_id', workspaceId)
        .in('id', noteIds);
      if (notesResult.error) throw notesResult.error;
      noteById = new Map((notesResult.data ?? []).map((note) => [note.id, note]));
    }

    const links = (data ?? [])
      .map((row) => {
        const note = noteById.get(row.note_id);
        if (!note) return null;
        const previewSource = note.content_html || plainTextToParagraphHtml(note.content ?? '');
        return {
          id: row.id,
          note_id: row.note_id,
          created_at: row.created_at,
          note: {
            id: note.id,
            title: note.title || 'Untitled note',
            preview: htmlToPlainText(previewSource).slice(0, 160),
            updated_at: note.updated_at ?? null,
          },
        };
      })
      .filter(Boolean);

    res.json({ links });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects/:id/note-links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const projectId = String(req.params.id);
    const noteId = String(req.body?.note_id ?? '').trim();
    if (!noteId) {
      return res.status(400).json({ error: 'note_id is required' });
    }

    const [projectAllowed, noteAllowed] = await Promise.all([
      ensureWorkspaceResource('projects', projectId, workspaceId),
      ensureWorkspaceResource('notes', noteId, workspaceId),
    ]);

    if (!projectAllowed) return res.status(404).json({ error: 'Project not found' });
    if (!noteAllowed) return res.status(404).json({ error: 'Note not found' });

    const existing = await supabase
      .from('project_note_links')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('project_id', projectId)
      .eq('note_id', noteId)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (!existing.data) {
      const insert = await supabase.from('project_note_links').insert({
        workspace_id: workspaceId,
        project_id: projectId,
        note_id: noteId,
        created_by: req.authUser.id,
      });
      if (insert.error) throw insert.error;
    }

    const { data, error } = await supabase
      .from('project_note_links')
      .select('id, note_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('project_id', projectId)
      .eq('note_id', noteId)
      .single();

    if (error) throw error;

    const noteResult = await supabase
      .from('notes')
      .select('id, title, content, content_html, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', noteId)
      .single();
    if (noteResult.error) throw noteResult.error;
    const note = noteResult.data;
    const previewSource = note.content_html || plainTextToParagraphHtml(note.content ?? '');

    res.json({
      id: data.id,
      note_id: data.note_id,
      created_at: data.created_at,
      note: {
        id: note.id,
        title: note.title || 'Untitled note',
        preview: htmlToPlainText(previewSource).slice(0, 160),
        updated_at: note.updated_at ?? null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete(
  '/api/projects/:id/note-links/:noteId',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const projectId = String(req.params.id);
      const noteId = String(req.params.noteId);

      const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
      if (!projectAllowed) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const { error } = await supabase
        .from('project_note_links')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('project_id', projectId)
        .eq('note_id', noteId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    let query = supabase.from('tasks').select(taskSelectColumns).eq('workspace_id', workspaceId);

    if (req.query?.projectId) {
      query = query.eq('project_id', String(req.query.projectId));
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/today', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIdsSet = await getUserWorkspaceIds(req.authUser.id);
    const workspaceIds = Array.from(workspaceIdsSet);

    if (!workspaceIds.length) return res.json([]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndISO = todayEnd.toISOString();

    // Primary: tasks due today or overdue (not completed)
    let dueRows = [];
    let dueError = null;
    for (const attempt of taskDueSelectAttempts) {
      const result = await supabase
        .from('tasks')
        .select(attempt.columns)
        .in('workspace_id', workspaceIds)
        .or(`due_date.eq.${todayISO},due_date.lt.${todayISO}`)
        .neq('status', 'completed')
        .order('due_date', { ascending: true })
        .limit(500);

      if (!result.error) {
        dueRows = result.data ?? [];
        dueError = null;
        break;
      }

      if (isMissingTaskTodayColumnError(result.error)) {
        dueError = result.error;
        continue;
      }

      throw result.error;
    }
    if (dueError && !dueRows.length) {
      throw dueError;
    }

    // Secondary: tasks explicitly shown in Today (if column exists)
    let explicitRows = [];
    for (const attempt of taskTodaySelectAttempts) {
      const explicitResult = await supabase
        .from('tasks')
        .select(attempt.columns)
        .in('workspace_id', workspaceIds)
        .eq(attempt.filter, true)
        .neq('status', 'completed')
        .limit(500);

      if (!explicitResult.error) {
        explicitRows = explicitResult.data ?? [];
        break;
      }

      if (!isMissingTaskTodayColumnError(explicitResult.error)) {
        throw explicitResult.error;
      }
    }

    const combined = [...(dueRows || []), ...(explicitRows || [])];

    // Deduplicate by id
    const byId = new Map();
    for (const row of combined) {
      if (!row || !row.id) continue;
      if (!byId.has(row.id)) byId.set(row.id, row);
    }

    const rows = Array.from(byId.values()).slice(0, 500);

    // Fetch workspace and project metadata
    const wsIds = Array.from(new Set(rows.map((r) => r.workspace_id).filter(Boolean)));
    const projIds = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean)));

    const [wsResult, projResult] = await Promise.all([
      wsIds.length
        ? supabase.from('workspaces').select('id, name, color').in('id', wsIds)
        : { data: [] },
      projIds.length
        ? supabase.from('projects').select('id, name').in('id', projIds)
        : { data: [] },
    ]);

    if (wsResult?.error) throw wsResult.error;
    if (projResult?.error) throw projResult.error;

    const wsById = new Map((wsResult.data || []).map((w) => [w.id, w]));
    const projById = new Map((projResult.data || []).map((p) => [p.id, p]));

    const mapped = rows.map((r) => ({
      kind: 'task',
      id: r.id,
      title: r.title,
      status: r.status,
      due_date: r.due_date ?? null,
      due_time: r.due_time ?? null,
      project_id: r.project_id ?? null,
      project_name: r.project_id ? projById.get(r.project_id)?.name ?? null : null,
      workspace_id: r.workspace_id,
      workspace_name: wsById.get(r.workspace_id)?.name ?? null,
      workspace_color: wsById.get(r.workspace_id)?.color ?? null,
      assigned_to: r.assigned_to ?? null,
      is_today_focus: r.is_today_focus ?? false,
      show_in_today: r.show_in_today ?? false,
      completed_at: r.completed_at ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    }));

    // Also fetch reminders due today/overdue and not done.
    const { data: reminderData, error: reminderError } = await withReminderTable((table) =>
      supabase
        .from(table)
        .select(reminderSelectColumns)
        .in('workspace_id', workspaceIds)
        .eq('is_done', false)
        .lte('remind_at', todayEndISO)
        .order('remind_at', { ascending: true })
        .limit(500)
    );

    if (reminderError) throw reminderError;

    const reminderRows = Array.isArray(reminderData) ? reminderData : [];
    const reminderWorkspaceIds = Array.from(
      new Set(reminderRows.map((r) => r.workspace_id).filter(Boolean))
    );
    const reminderProjectIds = Array.from(
      new Set(reminderRows.map((r) => r.project_id).filter(Boolean))
    );
    const reminderNoteIds = Array.from(new Set(reminderRows.map((r) => r.note_id).filter(Boolean)));
    const reminderCalendarIds = Array.from(
      new Set(reminderRows.map((r) => r.calendar_id).filter(Boolean))
    );

    const [reminderWsResult, reminderProjResult, reminderNoteResult, reminderCalendarResult] =
      await Promise.all([
        reminderWorkspaceIds.length
          ? supabase.from('workspaces').select('id, name, color').in('id', reminderWorkspaceIds)
          : { data: [] },
        reminderProjectIds.length
          ? supabase.from('projects').select('id, name').in('id', reminderProjectIds)
          : { data: [] },
        reminderNoteIds.length
          ? supabase.from('notes').select('id, title').in('id', reminderNoteIds)
          : { data: [] },
        reminderCalendarIds.length
          ? supabase.from('calendars').select('id, name, color').in('id', reminderCalendarIds)
          : { data: [] },
      ]);

    if (reminderWsResult?.error) throw reminderWsResult.error;
    if (reminderProjResult?.error) throw reminderProjResult.error;
    if (reminderNoteResult?.error) throw reminderNoteResult.error;
    if (reminderCalendarResult?.error) throw reminderCalendarResult.error;

    const reminderWsById = new Map((reminderWsResult.data || []).map((w) => [w.id, w]));
    const reminderProjById = new Map((reminderProjResult.data || []).map((p) => [p.id, p]));
    const reminderNoteById = new Map((reminderNoteResult.data || []).map((n) => [n.id, n]));
    const reminderCalendarById = new Map(
      (reminderCalendarResult.data || []).map((c) => [c.id, c])
    );

    const reminders = reminderRows.map((r) => ({
      kind: 'reminder',
      id: r.id,
      title: r.title,
      status: r.is_done ? 'completed' : 'todo',
      remind_at: r.remind_at ?? null,
      project_id: r.project_id ?? null,
      project_name: r.project_id ? reminderProjById.get(r.project_id)?.name ?? null : null,
      note_id: r.note_id ?? null,
      note_title: r.note_id ? reminderNoteById.get(r.note_id)?.title ?? null : null,
      calendar_id: r.calendar_id ?? null,
      calendar_name: r.calendar_id ? reminderCalendarById.get(r.calendar_id)?.name ?? null : null,
      workspace_id: r.workspace_id,
      workspace_name: reminderWsById.get(r.workspace_id)?.name ?? null,
      workspace_color: reminderWsById.get(r.workspace_id)?.color ?? null,
      assigned_to: null,
      is_today_focus: false,
      show_in_today: true,
      completed_at: null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    }));

    // Also fetch completed tasks within the last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const completedResult = await supabase
      .from('tasks')
      .select(taskSelectColumns)
      .in('workspace_id', workspaceIds)
      .eq('status', 'completed')
      .gte('completed_at', cutoff)
      .order('completed_at', { ascending: false })
      .limit(200);

    if (completedResult.error && !isMissingColumnError(completedResult.error, 'completed_at'))
      throw completedResult.error;

    const completedRows = completedResult.error ? [] : completedResult.data ?? [];

    const completedMapped = (completedRows || []).map((r) => ({
      kind: 'task',
      id: r.id,
      title: r.title,
      status: r.status,
      completed_at: r.completed_at ?? null,
      workspace_id: r.workspace_id,
      workspace_name: wsById.get(r.workspace_id)?.name ?? null,
      workspace_color: wsById.get(r.workspace_id)?.color ?? null,
      project_id: r.project_id ?? null,
      project_name: r.project_id ? projById.get(r.project_id)?.name ?? null : null,
    }));

    const completedReminderResult = await withReminderTable((table) =>
      supabase
        .from(table)
        .select(reminderSelectColumns)
        .in('workspace_id', workspaceIds)
        .eq('is_done', true)
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: false })
        .limit(200)
    );

    if (completedReminderResult.error) throw completedReminderResult.error;

    const completedReminderRows = Array.isArray(completedReminderResult.data)
      ? completedReminderResult.data
      : [];
    const completedReminderWorkspaceIds = Array.from(
      new Set(completedReminderRows.map((r) => r.workspace_id).filter(Boolean))
    );
    const completedReminderProjectIds = Array.from(
      new Set(completedReminderRows.map((r) => r.project_id).filter(Boolean))
    );
    const completedReminderNoteIds = Array.from(
      new Set(completedReminderRows.map((r) => r.note_id).filter(Boolean))
    );

    const [completedReminderWsResult, completedReminderProjResult, completedReminderNoteResult] =
      await Promise.all([
        completedReminderWorkspaceIds.length
          ? supabase
              .from('workspaces')
              .select('id, name, color')
              .in('id', completedReminderWorkspaceIds)
          : { data: [] },
        completedReminderProjectIds.length
          ? supabase.from('projects').select('id, name').in('id', completedReminderProjectIds)
          : { data: [] },
        completedReminderNoteIds.length
          ? supabase.from('notes').select('id, title').in('id', completedReminderNoteIds)
          : { data: [] },
      ]);

    if (completedReminderWsResult?.error) throw completedReminderWsResult.error;
    if (completedReminderProjResult?.error) throw completedReminderProjResult.error;
    if (completedReminderNoteResult?.error) throw completedReminderNoteResult.error;

    const completedReminderWsById = new Map(
      (completedReminderWsResult.data || []).map((w) => [w.id, w])
    );
    const completedReminderProjById = new Map(
      (completedReminderProjResult.data || []).map((p) => [p.id, p])
    );
    const completedReminderNoteById = new Map(
      (completedReminderNoteResult.data || []).map((n) => [n.id, n])
    );

    const completedReminders = completedReminderRows.map((r) => ({
      kind: 'reminder',
      id: r.id,
      title: r.title,
      status: 'completed',
      completed_at: r.updated_at ?? null,
      remind_at: r.remind_at ?? null,
      workspace_id: r.workspace_id,
      workspace_name: completedReminderWsById.get(r.workspace_id)?.name ?? null,
      workspace_color: completedReminderWsById.get(r.workspace_id)?.color ?? null,
      project_id: r.project_id ?? null,
      project_name: r.project_id ? completedReminderProjById.get(r.project_id)?.name ?? null : null,
      note_id: r.note_id ?? null,
      note_title: r.note_id ? completedReminderNoteById.get(r.note_id)?.title ?? null : null,
      calendar_id: r.calendar_id ?? null,
      calendar_name: null,
    }));

    res.json({ active: mapped, reminders, completed: completedMapped, completed_reminders: completedReminders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/tasks',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('tasks'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        return res.status(400).json({ error: 'Task title required' });
      }

      const projectId = req.body?.project_id ? String(req.body.project_id) : null;
      if (projectId) {
        const allowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
        if (!allowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }

      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [];
      const description = normalizeNullableText(req.body?.description);
      const notes = normalizeNullableText(req.body?.notes);
      const dueDate = normalizeNullableDate(req.body?.due_date, 'due date');
      const dueTime = normalizeNullableText(req.body?.due_time);
      const showInToday = Boolean(req.body?.show_in_today ?? false);
      const isTodayFocus = Boolean(req.body?.is_today_focus ?? false);

      const insertAttempts = [
        {
          includeShowInToday: true,
          includeIsTodayFocus: true,
        },
        {
          includeShowInToday: true,
          includeIsTodayFocus: false,
        },
        {
          includeShowInToday: false,
          includeIsTodayFocus: true,
        },
        {
          includeShowInToday: false,
          includeIsTodayFocus: false,
        },
      ];

      for (const attempt of insertAttempts) {
        const payload = {
          workspace_id: workspaceId,
          project_id: projectId,
          title,
          description,
          notes,
          due_date: dueDate,
          due_time: dueTime,
          status: req.body?.status ? String(req.body.status) : 'todo',
          priority: req.body?.priority ? String(req.body.priority) : 'medium',
          tags,
        };

        if (attempt.includeShowInToday) {
          payload.show_in_today = showInToday;
        }
        if (attempt.includeIsTodayFocus) {
          payload.is_today_focus = isTodayFocus;
        }

        const selectColumns = [
          taskSelectColumns,
          attempt.includeShowInToday ? 'show_in_today' : null,
          attempt.includeIsTodayFocus ? 'is_today_focus' : null,
        ]
          .filter(Boolean)
          .join(', ');

        const { data, error } = await supabase.from('tasks').insert(payload).select(selectColumns).single();

        if (!error) {
          return res.json(data);
        }

        if (isMissingTaskTodayColumnError(error)) {
          continue;
        }

        throw error;
      }

      throw new Error('Could not create task with today flags');
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/tasks/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await ensureWorkspaceResource('tasks', req.params.id, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Load existing to detect status transitions
    const { data: existingTask, error: existingError } = await supabase
      .from('tasks')
      .select('id, status, completed_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (existingError) throw existingError;

    const update = {};
    if (req.body?.title !== undefined) {
      const nextTitle = String(req.body.title).trim();
      if (!nextTitle) {
        return res.status(400).json({ error: 'Task title required' });
      }
      update.title = nextTitle;
    }
    if (req.body?.description !== undefined)
      update.description = normalizeNullableText(req.body.description);
    if (req.body?.notes !== undefined) update.notes = normalizeNullableText(req.body.notes);
    if (req.body?.due_date !== undefined)
      update.due_date = normalizeNullableDate(req.body.due_date, 'due date');
    if (req.body?.due_time !== undefined)
      update.due_time = normalizeNullableText(req.body.due_time);
    if (req.body?.status !== undefined) update.status = String(req.body.status);
    if (req.body?.priority !== undefined) update.priority = String(req.body.priority);
    if (req.body?.tags !== undefined) {
      update.tags = Array.isArray(req.body.tags)
        ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [];
    }
    const requestedTodayFields = {};
    if (req.body?.show_in_today !== undefined)
      requestedTodayFields.show_in_today = Boolean(req.body.show_in_today);
    if (req.body?.is_today_focus !== undefined)
      requestedTodayFields.is_today_focus = Boolean(req.body.is_today_focus);
    if (req.body?.project_id !== undefined) {
      const nextProjectId = req.body.project_id ? String(req.body.project_id) : null;
      if (nextProjectId) {
        const projectAllowed = await ensureWorkspaceResource(
          'projects',
          nextProjectId,
          workspaceId
        );
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }
      update.project_id = nextProjectId;
    }
    const nowIso = new Date().toISOString();
    update.updated_at = nowIso;

    // Handle completed_at when marking complete within this patch
    if (req.body?.status !== undefined) {
      const nextStatus = String(req.body.status);
      const prevStatus = existingTask?.status ?? null;
      if (nextStatus === 'completed' && prevStatus !== 'completed') {
        update.completed_at = nowIso;
      } else if (nextStatus !== 'completed' && prevStatus === 'completed') {
        update.completed_at = null;
      }
    }

    const updateAttempts = [
      {
        includeShowInToday: true,
        includeIsTodayFocus: true,
      },
      {
        includeShowInToday: true,
        includeIsTodayFocus: false,
      },
      {
        includeShowInToday: false,
        includeIsTodayFocus: true,
      },
      {
        includeShowInToday: false,
        includeIsTodayFocus: false,
      },
    ];

    for (const attempt of updateAttempts) {
      const nextUpdate = { ...update };

      if (attempt.includeShowInToday && requestedTodayFields.show_in_today !== undefined) {
        nextUpdate.show_in_today = requestedTodayFields.show_in_today;
      }
      if (attempt.includeIsTodayFocus && requestedTodayFields.is_today_focus !== undefined) {
        nextUpdate.is_today_focus = requestedTodayFields.is_today_focus;
      }

      const selectColumns = [
        taskSelectColumns,
        attempt.includeShowInToday ? 'show_in_today' : null,
        attempt.includeIsTodayFocus ? 'is_today_focus' : null,
      ]
        .filter(Boolean)
        .join(', ');

      const { data, error } = await supabase
        .from('tasks')
        .update(nextUpdate)
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
        .select(selectColumns)
        .single();

      if (!error) {
        return res.json(data);
      }

      if (isMissingTaskTodayColumnError(error)) {
        continue;
      }

      throw error;
    }

    throw new Error('Could not update task with today flags');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tasks/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/calendars', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('calendars')
      .select('id, name, color, workspace_id, is_personal, is_visible, created_by')
      .eq('workspace_id', workspaceId)
      .order('is_personal', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/calendars', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const name = String(req.body?.name ?? 'Personal').trim() || 'Personal';

    const { data, error } = await supabase
      .from('calendars')
      .insert({
        workspace_id: workspaceId,
        owner_id: req.authUser.id,
        created_by: req.authUser.id,
        name,
        color: req.body?.color || '#3B82F6',
        is_personal: Boolean(req.body?.is_personal ?? false),
        is_default: Boolean(req.body?.is_default ?? false),
        is_visible: Boolean(req.body?.is_visible ?? true),
      })
      .select('id, name, color, workspace_id, is_personal, is_visible, created_by')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/calendars/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await ensureWorkspaceResource('calendars', req.params.id, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    const update = {};
    if (req.body?.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body?.color !== undefined) update.color = String(req.body.color);
    if (req.body?.is_visible !== undefined) update.is_visible = Boolean(req.body.is_visible);

    const { data, error } = await supabase
      .from('calendars')
      .update(update)
      .eq('id', req.params.id)
      .select('id, name, color, workspace_id, is_personal, is_visible, created_by')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/calendars/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await ensureWorkspaceResource('calendars', req.params.id, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    const { error } = await supabase
      .from('calendars')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    let query = supabase
      .from('events')
      .select(
        'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id, created_at'
      )
      .eq('workspace_id', workspaceId);

    if (req.query?.startDate) {
      query = query.gte('start_at', String(req.query.startDate));
    }
    if (req.query?.endDate) {
      query = query.lte('start_at', String(req.query.endDate));
    }

    const { data, error } = await query.order('start_at', { ascending: true }).limit(500);
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const now = Date.now();
    const overdueEvents = rows.filter((event) => {
      const isRecurring = String(event.recurrence_rule ?? 'none') !== 'none';
      const isDone = String(event.status ?? '') === 'done';
      const endedAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
      return !isRecurring && !isDone && Number.isFinite(endedAt) && endedAt < now;
    });

    if (overdueEvents.length > 0) {
      await Promise.allSettled(
        overdueEvents.map((event) =>
          supabase
            .from('events')
            .update({ status: 'done', updated_by: req.authUser.id })
            .eq('id', event.id)
        )
      );
    }

    res.json(
      rows.map((event) =>
        overdueEvents.some((overdue) => overdue.id === event.id)
          ? { ...event, status: 'done' }
          : event
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/upcoming', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 30);

    const { data, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule')
      .eq('workspace_id', workspaceId)
      .gte('start_at', now.toISOString())
      .lte('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(20);

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const filtered = rows.filter((event) => {
      const isDone = String(event.status ?? '') === 'done';
      if (isDone) return false;

      const endAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
      return Number.isFinite(endAt) && endAt > now.getTime();
    });

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/events',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('events'),
  async (req, res) => {
    try {
      const workspaceId = req.workspaceId;
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        return res.status(400).json({ error: 'Event title required' });
      }

      const calendarId =
        req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id));
      const startAt = String(req.body?.start_at ?? '');
      const parsedStartAt = startAt ? new Date(startAt) : null;
      const endAt = req.body?.end_at
        ? String(req.body.end_at)
        : parsedStartAt
        ? new Date(parsedStartAt.getTime() + 60 * 60 * 1000).toISOString()
        : null;

      const { data, error } = await supabase
        .from('events')
        .insert({
          workspace_id: workspaceId,
          calendar_id: calendarId,
          created_by: req.authUser.id,
          updated_by: req.authUser.id,
          title,
          start_at: req.body?.start_at,
          end_at: endAt,
          color: req.body?.color || null,
          status: req.body?.status || 'planned',
          recurrence_rule: req.body?.recurrence_rule || null,
          notes: req.body?.notes || null,
          location: req.body?.location || null,
          all_day: Boolean(req.body?.all_day ?? false),
          project_id: req.body?.project_id || null,
          linked_project_id: req.body?.project_id || null,
          note_id: req.body?.note_id || null,
        })
        .select(
          'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id'
        )
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await ensureWorkspaceResource('events', req.params.id, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { data: existingEvent, error: existingError } = await supabase
      .from('events')
      .select('id, start_at, end_at')
      .eq('id', req.params.id)
      .single();

    if (existingError) throw existingError;

    const existingEnd = existingEvent?.end_at ? new Date(existingEvent.end_at) : null;
    const isPastEvent = existingEnd ? existingEnd.getTime() < Date.now() : false;
    if (isPastEvent) {
      return res.status(409).json({ error: 'Past events cannot be edited' });
    }

    const update = {};
    for (const key of [
      'title',
      'start_at',
      'end_at',
      'all_day',
      'calendar_id',
      'color',
      'status',
      'recurrence_rule',
      'notes',
      'location',
      'note_id',
    ]) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key];
    }
    if (req.body?.project_id !== undefined) {
      const projectId = req.body.project_id ? String(req.body.project_id) : null;
      if (projectId) {
        const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }
      update.project_id = projectId;
      update.linked_project_id = projectId;
    }
    if (req.body?.note_id !== undefined) {
      const noteId = req.body.note_id ? String(req.body.note_id) : null;
      if (noteId) {
        const noteAllowed = await ensureWorkspaceResource('notes', noteId, workspaceId);
        if (!noteAllowed) {
          return res.status(404).json({ error: 'Note not found' });
        }
      }
      update.note_id = noteId;
    }
    update.updated_by = req.authUser.id;

    const { data, error } = await supabase
      .from('events')
      .update(update)
      .eq('id', req.params.id)
      .select(
        'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id'
      )
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/workspaces/:workspaceId/search',
  authMiddleware,
  rateLimit('read'),
  async (req, res) => {
    try {
      const workspaceId = String(req.params.workspaceId ?? '').trim();
      if (!workspaceId) {
        return res.status(400).json({ error: 'Workspace id required' });
      }

      const allowed = await isWorkspaceAccessibleToUser(req.authUser.id, workspaceId);
      if (!allowed) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      const rawQuery = String(req.query?.q ?? req.body?.q ?? '').trim();
      if (rawQuery.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
      }

      await setUserActiveWorkspaceId(req.authUser.id, workspaceId);

      const like = `%${rawQuery}%`;

      const [notesResult, projectsResult, tasksResult, eventsResult] = await Promise.all([
        supabase
          .from('notes')
          .select('id, title, content, content_html, mode, updated_at, created_at')
          .eq('workspace_id', workspaceId)
          .or(`title.ilike.${like},content.ilike.${like}`)
          .order('updated_at', { ascending: false })
          .limit(25),
        supabase
          .from('projects')
          .select(
            'id, name, description, status, completeness, start_date, end_date, created_at, updated_at'
          )
          .eq('workspace_id', workspaceId)
          .or(`name.ilike.${like},description.ilike.${like}`)
          .order('updated_at', { ascending: false })
          .limit(25),
        supabase
          .from('tasks')
          .select(
            'id, project_id, title, description, due_date, due_time, status, priority, created_at, updated_at'
          )
          .eq('workspace_id', workspaceId)
          .or(`title.ilike.${like},description.ilike.${like}`)
          .order('updated_at', { ascending: false })
          .limit(25),
        supabase
          .from('events')
          .select('id, title, start_at, end_at, status, color, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .or(`title.ilike.${like}`)
          .order('start_at', { ascending: true })
          .limit(25),
      ]);

      if (notesResult.error) throw notesResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (tasksResult.error) throw tasksResult.error;
      if (eventsResult.error) throw eventsResult.error;

      const normalizedQuery = normalizeSearchTerm(rawQuery);

      const notes = (notesResult.data ?? []).map((row) => {
        const preview = truncatePreview(htmlToPlainText(row.content_html || row.content || ''), 80);
        return {
          type: 'note',
          id: row.id,
          title: row.title,
          preview,
          icon: 'FileText',
          score: scoreSearchResult(
            row.title,
            normalizedQuery,
            preview,
            normalizeSearchTerm(row.content || row.content_html || '').includes(normalizedQuery)
          ),
        };
      });

      const projects = (projectsResult.data ?? []).map((row) => {
        const preview = truncatePreview(
          `Status: ${String(row.status ?? 'Not started')} · ${Math.max(
            0,
            Math.min(100, Number(row.completeness) || 0)
          )}% complete`,
          80
        );
        return {
          type: 'project',
          id: row.id,
          title: row.name,
          preview,
          icon: 'Briefcase',
          score: scoreSearchResult(row.name, normalizedQuery, preview, false),
        };
      });

      const tasks = (tasksResult.data ?? []).map((row) => {
        const preview = truncatePreview(
          row.description?.trim() ||
            `Due ${row.due_date ?? 'not set'}${row.due_time ? ` · ${row.due_time}` : ''}`,
          80
        );
        return {
          type: 'task',
          id: row.id,
          title: row.title,
          preview,
          icon: 'Check',
          project_id: row.project_id,
          score: scoreSearchResult(
            row.title,
            normalizedQuery,
            preview,
            normalizeSearchTerm(row.description ?? '').includes(normalizedQuery)
          ),
        };
      });

      const events = (eventsResult.data ?? []).map((row) => {
        const startDate = row.start_at ? new Date(row.start_at) : null;
        const preview = truncatePreview(
          startDate && !Number.isNaN(startDate.getTime())
            ? startDate.toLocaleString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'No date set',
          80
        );
        return {
          type: 'event',
          id: row.id,
          title: row.title,
          preview,
          icon: 'Calendar',
          focusDate: row.start_at ? String(row.start_at).slice(0, 10) : null,
          score: scoreSearchResult(row.title, normalizedQuery, preview, false),
        };
      });

      const combined = [...notes, ...projects, ...tasks, ...events]
        .sort((left, right) => {
          if (left.score !== right.score) return left.score - right.score;
          return String(left.title).localeCompare(String(right.title));
        })
        .slice(0, 20);

      res.json(combined);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/reminders', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .select('id, title, remind_at, calendar_id, color, is_done, notes, project_id, note_id')
        .eq('workspace_id', workspaceId)
        .order('remind_at', { ascending: true })
    );

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const now = Date.now();
    const overdueReminders = rows.filter((reminder) => {
      const isDone = Boolean(reminder.is_done);
      const remindAt = new Date(reminder.remind_at ?? 0).getTime();
      return !isDone && Number.isFinite(remindAt) && remindAt < now;
    });

    if (overdueReminders.length > 0) {
      await Promise.allSettled(
        overdueReminders.map((reminder) =>
          withReminderTable((table) =>
            supabase
              .from(table)
              .update({ is_done: true, updated_by: req.authUser.id })
              .eq('id', reminder.id)
          )
        )
      );
    }

    res.json(
      rows.map((reminder) =>
        overdueReminders.some((overdue) => overdue.id === reminder.id)
          ? { ...reminder, is_done: true }
          : reminder
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/reminders',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('reminders'),
  async (req, res) => {
    try {
      const workspaceId = req.workspaceId;
      const calendarId =
        req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id));

      const insertPayload = {
        workspace_id: workspaceId,
        calendar_id: calendarId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title: String(req.body?.title ?? 'Reminder').trim() || 'Reminder',
        remind_at: req.body?.remind_at,
        color: req.body?.color || null,
        is_done: Boolean(req.body?.is_done ?? false),
        notes: req.body?.notes || null,
        project_id: req.body?.project_id || null,
        note_id: req.body?.note_id || null,
      };

      if (insertPayload.project_id) {
        const projectAllowed = await ensureWorkspaceResource(
          'projects',
          String(insertPayload.project_id),
          workspaceId
        );
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }
      if (insertPayload.note_id) {
        const noteAllowed = await ensureWorkspaceResource(
          'notes',
          String(insertPayload.note_id),
          workspaceId
        );
        if (!noteAllowed) {
          return res.status(404).json({ error: 'Note not found' });
        }
      }

      const { data, error } = await withReminderTable((table) =>
        supabase
          .from(table)
          .insert(insertPayload)
          .select('id, title, remind_at, calendar_id, color, is_done, notes, project_id, note_id')
          .single()
      );

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowedResult = await withReminderTable((table) =>
      supabase
        .from(table)
        .select('id')
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    );
    if (!allowedResult?.data?.id) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const update = {};
    for (const key of [
      'title',
      'remind_at',
      'calendar_id',
      'color',
      'is_done',
      'notes',
      'note_id',
    ]) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key];
    }
    if (req.body?.project_id !== undefined) {
      const projectId = req.body.project_id ? String(req.body.project_id) : null;
      if (projectId) {
        const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }
      update.project_id = projectId;
    }
    if (req.body?.note_id !== undefined) {
      const noteId = req.body.note_id ? String(req.body.note_id) : null;
      if (noteId) {
        const noteAllowed = await ensureWorkspaceResource('notes', noteId, workspaceId);
        if (!noteAllowed) {
          return res.status(404).json({ error: 'Note not found' });
        }
      }
      update.note_id = noteId;
    }
    update.updated_by = req.authUser.id;

    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .update(update)
        .eq('id', req.params.id)
        .select('id, title, remind_at, calendar_id, color, is_done, notes, project_id, note_id')
        .single()
    );

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await withReminderTable((table) =>
      supabase.from(table).delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    );

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notes', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .limit(500);

    if (error) throw error;
    const mapped = (data ?? []).map((row) => mapNoteResponse(row));
    const tree = buildNotesTree(mapped);
    const flat = flattenNotesTree(tree, []);
    res.json({ notes: flat, tree });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notes/:id', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Note not found.' });
    res.json(mapNoteResponse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/notes',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('notes'),
  async (req, res) => {
    try {
      const workspaceId = req.workspaceId ?? (await resolveWorkspaceIdForRequest(req));
      const title = String(req.body?.title ?? 'Untitled').trim() || 'Untitled';
      const rawContentHtml =
        req.body?.content_html !== undefined ? String(req.body.content_html ?? '').trim() : null;
      const incomingContent =
        req.body?.content !== undefined ? String(req.body.content ?? '').trim() : null;
      const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10)).trim();
      const mood = req.body?.mood ? String(req.body.mood).trim() : null;
      const source = req.body?.source ? String(req.body.source).trim() : 'workspace';
      const mode = ['text', 'mind_map'].includes(req.body?.mode) ? req.body.mode : 'text';
      const mindMapStructure =
        mode === 'mind_map' && req.body?.mind_map_structure ? req.body.mind_map_structure : null;
      const requestedSectionId = req.body?.section_id ? String(req.body.section_id).trim() : null;
      const requestedParentId = req.body?.parent_id ? String(req.body.parent_id).trim() : null;
      const requestedSortOrder = req.body?.sort_order;
      // Determine HTML and plain text values
      const content_html = normalizeNoteHtml(
        rawContentHtml ?? plainTextToParagraphHtml(incomingContent ?? '')
      );
      const content_plain = htmlToPlainText(content_html);

      let parent_id = null;
      let depth = 0;
      if (requestedParentId) {
        const { data: parentRow, error: parentError } = await supabase
          .from('notes')
          .select('id, depth')
          .eq('id', requestedParentId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (parentError) throw parentError;
        if (parentRow) {
          parent_id = parentRow.id;
          depth = toNonNegativeInt(parentRow.depth) + 1;
        }
      }

      let section_id = null;
      if (requestedSectionId) {
        const { data: sectionRow, error: sectionError } = await supabase
          .from('note_sections')
          .select('id')
          .eq('id', requestedSectionId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (sectionError) throw sectionError;
        if (sectionRow) section_id = sectionRow.id;
      }

      let nextSortOrder =
        requestedSortOrder !== undefined ? toNonNegativeInt(requestedSortOrder) : 0;
      if (requestedSortOrder === undefined) {
        let siblingsQuery = supabase
          .from('notes')
          .select('sort_order')
          .eq('workspace_id', workspaceId)
          .order('sort_order', { ascending: false })
          .limit(1);

        siblingsQuery = parent_id
          ? siblingsQuery.eq('parent_id', parent_id)
          : siblingsQuery.is('parent_id', null);
        const { data: siblings, error: siblingsError } = await siblingsQuery;
        if (siblingsError) throw siblingsError;
        const siblingTop =
          Array.isArray(siblings) && siblings.length
            ? toNonNegativeInt(siblings[0].sort_order)
            : -1;
        nextSortOrder = siblingTop + 1;
      }

      const { data, error } = await supabase
        .from('notes')
        .insert({
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          title,
          content: content_plain,
          content_html,
          date,
          mood,
          source,
          mode,
          mind_map_structure: mindMapStructure,
          parent_id,
          section_id,
          sort_order: nextSortOrder,
          depth,
        })
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
        )
        .single();

      if (error) throw error;
      res.json(mapNoteResponse(data));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const update = {};
    const { data: existing, error: existingError } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: 'Note not found.' });

    if (req.body?.title !== undefined)
      update.title = String(req.body.title ?? '').trim() || 'Untitled';
    // Support rich HTML content via `content_html`, but remain backward-compatible with `content` as plain text
    if (req.body?.content_html !== undefined) {
      const html = normalizeNoteHtml(req.body.content_html);
      update.content_html = html;
      update.content = htmlToPlainText(html);
    } else if (req.body?.content !== undefined) {
      // legacy plain text update
      const plain = String(req.body.content ?? '');
      update.content = plain;
      update.content_html = normalizeNoteHtml(plainTextToParagraphHtml(plain));
    }
    if (req.body?.date !== undefined)
      update.date = String(req.body.date ?? new Date().toISOString().slice(0, 10)).trim();
    if (req.body?.mood !== undefined)
      update.mood = req.body.mood ? String(req.body.mood).trim() : null;
    if (req.body?.source !== undefined)
      update.source = String(req.body.source ?? 'workspace').trim() || 'workspace';
    if (req.body?.mode !== undefined) {
      const validMode = ['text', 'mind_map'].includes(req.body.mode) ? req.body.mode : 'text';
      update.mode = validMode;
    }
    if (req.body?.mind_map_structure !== undefined) {
      update.mind_map_structure = req.body.mind_map_structure;
    }
    if (req.body?.section_id !== undefined) {
      const requestedSectionId = req.body?.section_id ? String(req.body.section_id).trim() : null;
      if (requestedSectionId) {
        const { data: sectionRow, error: sectionError } = await supabase
          .from('note_sections')
          .select('id')
          .eq('id', requestedSectionId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (sectionError) throw sectionError;
        if (!sectionRow) {
          return res.status(404).json({ error: 'Section not found.' });
        }
        update.section_id = sectionRow.id;
      } else {
        update.section_id = null;
      }
    }
    if (req.body?.parent_id !== undefined) {
      const requestedParentId = req.body?.parent_id ? String(req.body.parent_id).trim() : null;
      if (requestedParentId === req.params.id) {
        return res.status(400).json({ error: 'A note cannot be its own parent.' });
      }
      if (requestedParentId) {
        const { data: parentRow, error: parentError } = await supabase
          .from('notes')
          .select('id, depth')
          .eq('id', requestedParentId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (parentError) throw parentError;
        if (!parentRow) {
          return res.status(404).json({ error: 'Parent note not found.' });
        }
        update.parent_id = parentRow.id;
        update.depth = toNonNegativeInt(parentRow.depth) + 1;
      } else {
        update.parent_id = null;
        update.depth = 0;
      }
    }
    if (req.body?.sort_order !== undefined) {
      update.sort_order = toNonNegativeInt(req.body.sort_order);
    }

    if (Object.keys(update).length === 0) {
      return res.json(mapNoteResponse(existing));
    }

    update.user_id = req.authUser.id;
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('notes')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .single();

    if (error) throw error;
    res.json(mapNoteResponse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/notes/:id/children',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('notes'),
  async (req, res) => {
    try {
      const workspaceId = req.workspaceId ?? (await resolveWorkspaceIdForRequest(req));
      const { data: parentRow, error: parentError } = await supabase
        .from('notes')
        .select('id, title, depth')
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parentRow) return res.status(404).json({ error: 'Parent note not found.' });

      const title =
        String(req.body?.title ?? `New note in ${parentRow.title || 'folder'}`).trim() ||
        'Untitled note';
      const rawContentHtml =
        req.body?.content_html !== undefined
          ? String(req.body.content_html ?? '').trim()
          : '<p></p>';
      const incomingContent =
        req.body?.content !== undefined ? String(req.body.content ?? '').trim() : '';
      const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10)).trim();
      const mood = req.body?.mood ? String(req.body.mood).trim() : null;
      const source = req.body?.source ? String(req.body.source).trim() : 'workspace';
      const mode = ['text', 'mind_map'].includes(req.body?.mode) ? req.body.mode : 'text';
      const mindMapStructure =
        mode === 'mind_map' && req.body?.mind_map_structure ? req.body.mind_map_structure : null;
      const content_html = normalizeNoteHtml(
        rawContentHtml ?? plainTextToParagraphHtml(incomingContent ?? '')
      );
      const content_plain = htmlToPlainText(content_html);

      const { data: siblings, error: siblingsError } = await supabase
        .from('notes')
        .select('sort_order')
        .eq('workspace_id', workspaceId)
        .eq('parent_id', parentRow.id)
        .order('sort_order', { ascending: false })
        .limit(1);
      if (siblingsError) throw siblingsError;
      const siblingTop =
        Array.isArray(siblings) && siblings.length ? toNonNegativeInt(siblings[0].sort_order) : -1;

      const { data, error } = await supabase
        .from('notes')
        .insert({
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          title,
          content: content_plain,
          content_html,
          date,
          mood,
          source,
          mode,
          mind_map_structure: mindMapStructure,
          parent_id: parentRow.id,
          sort_order: siblingTop + 1,
          depth: toNonNegativeInt(parentRow.depth) + 1,
        })
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
        )
        .single();
      if (error) throw error;
      res.json(mapNoteResponse(data));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.patch('/api/notes/:id/parent', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const requestedParentId = req.body?.parent_id ? String(req.body.parent_id).trim() : null;

    if (requestedParentId && requestedParentId === req.params.id) {
      return res.status(400).json({ error: 'A note cannot be its own parent.' });
    }

    let parent_id = null;
    let depth = 0;
    if (requestedParentId) {
      const { data: parentRow, error: parentError } = await supabase
        .from('notes')
        .select('id, depth')
        .eq('id', requestedParentId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parentRow) return res.status(404).json({ error: 'Parent note not found.' });
      parent_id = parentRow.id;
      depth = toNonNegativeInt(parentRow.depth) + 1;
    }

    const { data, error } = await supabase
      .from('notes')
      .update({
        parent_id,
        depth,
        user_id: req.authUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
      )
      .single();
    if (error) throw error;
    res.json(mapNoteResponse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/notes/:id/sort_order', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const sort_order = toNonNegativeInt(req.body?.sort_order, 0);

    const { data, error } = await supabase
      .from('notes')
      .update({
        sort_order,
        user_id: req.authUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
      )
      .single();
    if (error) throw error;
    res.json(mapNoteResponse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notes/:id/tree', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .limit(500);
    if (error) throw error;
    const mapped = (data ?? []).map((row) => mapNoteResponse(row));
    const tree = buildNotesTree(mapped);
    const breadcrumbs = buildNoteBreadcrumb(mapped, req.params.id);
    res.json({ tree, breadcrumbs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/notes/:id/duplicate',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('notes'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const { data: source, error: sourceError } = await supabase
        .from('notes')
        .select(
          'id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth'
        )
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (sourceError) throw sourceError;
      if (!source) {
        return res.status(404).json({ error: 'Note not found.' });
      }

      let siblingsQuery = supabase
        .from('notes')
        .select('sort_order')
        .eq('workspace_id', workspaceId)
        .order('sort_order', { ascending: false })
        .limit(1);
      siblingsQuery = source.parent_id
        ? siblingsQuery.eq('parent_id', source.parent_id)
        : siblingsQuery.is('parent_id', null);
      const { data: siblings, error: siblingsError } = await siblingsQuery;

      if (siblingsError) throw siblingsError;
      const siblingTop =
        Array.isArray(siblings) && siblings.length ? toNonNegativeInt(siblings[0].sort_order) : -1;

      const { data, error } = await supabase
        .from('notes')
        .insert({
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          title: `${source.title || 'Untitled note'} Copy`,
          content: source.content,
          content_html: source.content_html,
          date: source.date,
          mood: source.mood,
          source: source.source,
          mode: source.mode,
          mind_map_structure: source.mind_map_structure,
          parent_id: source.parent_id ?? null,
          section_id: source.section_id ?? null,
          sort_order: siblingTop + 1,
          depth: toNonNegativeInt(source.depth),
        })
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
        )
        .single();

      if (error) throw error;
      res.json(mapNoteResponse(data));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.delete('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data: existing, error: existingError } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: 'Note not found.' });

    await createNoteVersionSnapshot(workspaceId, req.authUser.id, existing, 'delete');
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notes/:id/versions', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data: noteExists, error: noteExistsError } = await supabase
      .from('notes')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (noteExistsError) throw noteExistsError;
    if (!noteExists) return res.status(404).json({ error: 'Note not found.' });

    const { data, error } = await supabase
      .from('note_versions')
      .select(
        'id, note_id, versioned_by, reason, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('note_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(NOTE_VERSION_LIMIT);
    if (error) throw error;
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notes/:id/versions', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { id } = req.params;
    const reason = String(req.body?.reason ?? 'manual');

    const { data: existing, error: existingError } = await supabase
      .from('notes')
      .select(
        'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: 'Note not found.' });

    await createNoteVersionSnapshot(workspaceId, req.authUser.id, existing, reason);

    const { data: newest, error: newestError } = await supabase
      .from('note_versions')
      .select(
        'id, note_id, versioned_by, reason, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('note_id', id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (newestError) throw newestError;
    res.json(Array.isArray(newest) && newest[0] ? newest[0] : null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/notes/:id/versions/:versionId/restore',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const { id, versionId } = req.params;

      const { data: existing, error: existingError } = await supabase
        .from('notes')
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
        )
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ error: 'Note not found.' });

      const { data: version, error: versionError } = await supabase
        .from('note_versions')
        .select(
          'id, note_id, workspace_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth'
        )
        .eq('workspace_id', workspaceId)
        .eq('note_id', id)
        .eq('id', versionId)
        .maybeSingle();
      if (versionError) throw versionError;
      if (!version) return res.status(404).json({ error: 'Version not found.' });

      await createNoteVersionSnapshot(workspaceId, req.authUser.id, existing, 'restore_before');

      const payload = {
        title: String(version.title ?? 'Untitled').trim() || 'Untitled',
        content: String(version.content ?? ''),
        content_html: normalizeNoteHtml(
          version.content_html ?? plainTextToParagraphHtml(version.content ?? '')
        ),
        date: version.date ?? new Date().toISOString().slice(0, 10),
        mood: version.mood ?? null,
        source: version.source ?? 'workspace',
        mode: version.mode === 'mind_map' ? 'mind_map' : 'text',
        mind_map_structure: version.mind_map_structure ?? null,
        parent_id: version.parent_id ?? null,
        section_id: version.section_id ?? null,
        sort_order: toNonNegativeInt(version.sort_order, 0),
        depth: toNonNegativeInt(version.depth, 0),
        user_id: req.authUser.id,
        updated_at: new Date().toISOString(),
      };

      const { data: restored, error: restoreError } = await supabase
        .from('notes')
        .update(payload)
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at'
        )
        .single();
      if (restoreError) throw restoreError;

      res.json(mapNoteResponse(restored));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/daily-accountability', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const today = String(req.headers['x-ledger-day-key'] ?? new Date().toISOString().slice(0, 10));

    const { data, error } = await supabase
      .from('daily_accountability')
      .select(
        'focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow, entry_date, updated_at'
      )
      .eq('user_id', req.authUser.id)
      .eq('entry_date', today)
      .maybeSingle();

    if (error) throw error;
    res.json(data ?? null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/daily-accountability', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const today = String(req.headers['x-ledger-day-key'] ?? new Date().toISOString().slice(0, 10));

    const payload = {
      user_id: req.authUser.id,
      entry_date: today,
      focus_items: safeJson(req.body?.focus_items, []),
      checkin_finished: String(req.body?.finished ?? '').trim(),
      checkin_blocked: String(req.body?.blocked ?? '').trim(),
      checkin_first_task_tomorrow: String(req.body?.first_task_tomorrow ?? '').trim(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('daily_accountability')
      .upsert(payload, { onConflict: 'user_id,entry_date' })
      .select(
        'focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow, entry_date, updated_at'
      )
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== NOTE TEMPLATES API ==========

// GET /api/templates - List all templates in workspace
app.get('/api/templates', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const category = req.query?.category ? String(req.query.category).trim() : null;

    let query = supabase
      .from('note_templates')
      .select(
        'id, name, description, category, is_default, is_system, usage_count, created_at, created_by'
      )
      .eq('workspace_id', workspaceId);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query
      .order('usage_count', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/:id - Get single template
app.get(
  '/api/templates/:id([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('read'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const { data, error } = await supabase
        .from('note_templates')
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .eq('id', String(req.params.id))
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Template not found' });

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/templates - Create new template
app.post('/api/templates', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const name = String(req.body?.name ?? '').trim();
    const description = normalizeNullableText(req.body?.description);
    const category = String(req.body?.category ?? 'personal')
      .trim()
      .toLowerCase();
    const rawContentHtml =
      req.body?.content_html !== undefined ? String(req.body.content_html).trim() : null;
    const incomingContent =
      req.body?.content !== undefined ? String(req.body.content).trim() : null;
    const isDefault = Boolean(req.body?.is_default ?? false);

    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    const content_html = normalizeNoteHtml(
      rawContentHtml ?? plainTextToParagraphHtml(incomingContent ?? '')
    );

    const { data, error } = await supabase
      .from('note_templates')
      .insert({
        workspace_id: workspaceId,
        name,
        description,
        content_html,
        category,
        is_default: isDefault,
        is_system: false,
        usage_count: 0,
        created_by: req.authUser.id,
      })
      .select(
        'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
      )
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/templates/:id - Update template
app.patch(
  '/api/templates/:id([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      // Check ownership (non-system templates only)
      const { data: existing, error: checkError } = await supabase
        .from('note_templates')
        .select('id, created_by, is_system')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system && existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Cannot edit system templates' });
      }
      if (existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Can only edit your own templates' });
      }

      const update = {};
      if (req.body?.name !== undefined) {
        const nextName = String(req.body.name).trim();
        if (!nextName) return res.status(400).json({ error: 'Template name is required' });
        update.name = nextName;
      }
      if (req.body?.description !== undefined)
        update.description = normalizeNullableText(req.body.description);
      if (req.body?.category !== undefined)
        update.category = String(req.body.category).trim().toLowerCase();
      if (req.body?.content_html !== undefined) {
        const html = normalizeNoteHtml(req.body.content_html);
        update.content_html = html;
      }
      if (req.body?.is_default !== undefined) update.is_default = Boolean(req.body.is_default);

      update.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('note_templates')
        .update(update)
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /api/templates/:id - Delete template
app.delete(
  '/api/templates/:id([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      const { data: existing, error: checkError } = await supabase
        .from('note_templates')
        .select('created_by, is_system')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system)
        return res.status(403).json({ error: 'Cannot delete system templates' });
      if (existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Can only delete your own templates' });
      }

      const { error } = await supabase
        .from('note_templates')
        .delete()
        .eq('id', templateId)
        .eq('workspace_id', workspaceId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/templates/:id/duplicate - Duplicate template
app.post(
  '/api/templates/:id([0-9a-fA-F-]{36})/duplicate',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      const { data: original, error: fetchError } = await supabase
        .from('note_templates')
        .select('name, description, content_html, category')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!original) return res.status(404).json({ error: 'Template not found' });

      const duplicatedName = `${original.name} (Copy)`;

      const { data, error } = await supabase
        .from('note_templates')
        .insert({
          workspace_id: workspaceId,
          name: duplicatedName,
          description: original.description,
          content_html: original.content_html,
          category: original.category,
          is_default: false,
          is_system: false,
          usage_count: 0,
          created_by: req.authUser.id,
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/notes/from-template/:templateId - Create note from template
app.post(
  '/api/notes/from-template/:templateId([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('notes'),
  async (req, res) => {
    try {
      const workspaceId = req.workspaceId ?? (await resolveWorkspaceIdForRequest(req));
      const templateId = String(req.params.templateId);

      const { data: template, error: templateError } = await supabase
        .from('note_templates')
        .select('id, name, content_html')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (templateError) throw templateError;
      if (!template) return res.status(404).json({ error: 'Template not found' });

      // Increment template usage count (fire and forget)
      (async () => {
        try {
          await supabase.rpc('increment_template_usage', { template_id: templateId });
        } catch {
          // If RPC doesn't exist, use direct update query with current count
          const { data: current } = await supabase
            .from('note_templates')
            .select('usage_count')
            .eq('id', templateId)
            .maybeSingle();
          if (current) {
            await supabase
              .from('note_templates')
              .update({ usage_count: (current.usage_count || 0) + 1 })
              .eq('id', templateId);
          }
        }
      })();

      // Create note from template
      const content_html = template.content_html;
      const content_plain = htmlToPlainText(content_html);
      const date = new Date().toISOString().slice(0, 10);

      const requestedSectionId = req.body?.section_id ? String(req.body.section_id).trim() : null;
      let section_id = null;
      if (requestedSectionId) {
        const { data: sectionRow, error: sectionError } = await supabase
          .from('note_sections')
          .select('id')
          .eq('id', requestedSectionId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (sectionError) throw sectionError;
        if (sectionRow) section_id = sectionRow.id;
      }

      const { data: note, error: noteError } = await supabase
        .from('notes')
        .insert({
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          title: template.name,
          content: content_plain,
          content_html,
          date,
          source: 'template',
          template_id: templateId,
          section_id,
        })
        .select(
          'id, workspace_id, user_id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
        )
        .single();

      if (noteError) throw noteError;

      res.status(201).json(mapNoteResponse(note));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/templates/from-note/:noteId - Save note as template
app.post(
  '/api/templates/from-note/:noteId([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const noteId = String(req.params.noteId);

      const { data: note, error: noteError } = await supabase
        .from('notes')
        .select('id, title, content, content_html')
        .eq('id', noteId)
        .eq('workspace_id', workspaceId)
        .eq('user_id', req.authUser.id)
        .maybeSingle();

      if (noteError) throw noteError;
      if (!note) return res.status(404).json({ error: 'Note not found' });

      const templateName = String(req.body?.name ?? note.title).trim() || 'Untitled Template';
      const templateDescription = normalizeNullableText(req.body?.description);
      const templateCategory = String(req.body?.category ?? 'personal')
        .trim()
        .toLowerCase();
      const isDefault = Boolean(req.body?.is_default ?? false);

      const { data: template, error } = await supabase
        .from('note_templates')
        .insert({
          workspace_id: workspaceId,
          name: templateName,
          description: templateDescription,
          content_html: note.content_html || plainTextToParagraphHtml(note.content || ''),
          category: templateCategory,
          is_default: isDefault,
          is_system: false,
          usage_count: 0,
          created_by: req.authUser.id,
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.status(201).json({
        success: true,
        template,
        message: 'Note saved as template successfully',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PATCH /api/templates/:id/set-default - Toggle is_default flag
app.patch(
  '/api/templates/:id([0-9a-fA-F-]{36})/set-default',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);
      const isDefault = Boolean(req.body?.is_default);

      const { data: existing, error: checkError } = await supabase
        .from('note_templates')
        .select('created_by')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Can only modify your own templates' });
      }

      const { data, error } = await supabase
        .from('note_templates')
        .update({ is_default: isDefault, updated_at: new Date().toISOString() })
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .select('id, is_default')
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ===== SECTION ENDPOINTS =====

// GET /api/sections - List all sections in workspace
app.get(
  '/api/sections',
  authMiddleware,
  rateLimit('read'),
  withWorkspaceContext,
  async (req, res) => {
    try {
      const { workspaceId } = req.user;

      const { data, error } = await supabase
        .from('note_sections')
        .select('id, name, color, parent_id, sort_order, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      res.json(data || []);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /api/sections - Create new section
app.post(
  '/api/sections',
  authMiddleware,
  rateLimit('write'),
  withWorkspaceContext,
  async (req, res) => {
    try {
      const { workspaceId, userId } = req.user;
      const { name, color = 'gray' } = req.body;
      const parent_id = req.body?.parent_id ? String(req.body.parent_id).trim() : null;

      if (!name?.trim()) {
        return res.status(400).json({ error: 'Section name is required' });
      }

      if (parent_id) {
        const { data: parent, error: parentError } = await supabase
          .from('note_sections')
          .select('id')
          .eq('id', parent_id)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (parentError) throw parentError;
        if (!parent?.id) return res.status(404).json({ error: 'Parent section not found' });
      }

      let existingSectionsQuery = supabase
        .from('note_sections')
        .select('sort_order')
        .eq('workspace_id', workspaceId)
        .order('sort_order', { ascending: false })
        .limit(1);

      existingSectionsQuery = parent_id
        ? existingSectionsQuery.eq('parent_id', parent_id)
        : existingSectionsQuery.is('parent_id', null);

      const { data: existingSections } = await existingSectionsQuery;

      const nextSortOrder = (existingSections?.[0]?.sort_order ?? -1) + 1;

      const allowedSectionColors = [
        'gray',
        'blue',
        'orange',
        'green',
        'purple',
        'pink',
        'red',
        'amber',
        'teal',
        'cyan',
        'indigo',
        'violet',
        'emerald',
        'rose',
        'slate',
      ];

      const { data, error } = await supabase
        .from('note_sections')
        .insert({
          workspace_id: workspaceId,
          created_by: userId,
          name: name.trim(),
          color: allowedSectionColors.includes(color) ? color : 'gray',
          parent_id,
          sort_order: nextSortOrder,
        })
        .select('id, name, color, parent_id, sort_order, created_at, updated_at')
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PATCH /api/sections/:id - Update section
app.patch(
  '/api/sections/:id([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  withWorkspaceContext,
  async (req, res) => {
    try {
      const { workspaceId } = req.user;
      const { id } = req.params;
      const { name, color, sort_order } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name.trim();
      const allowedSectionColors = [
        'gray',
        'blue',
        'orange',
        'green',
        'purple',
        'pink',
        'red',
        'amber',
        'teal',
        'cyan',
        'indigo',
        'violet',
        'emerald',
        'rose',
        'slate',
      ];
      if (color !== undefined && allowedSectionColors.includes(color)) {
        updateData.color = color;
      }
      if (sort_order !== undefined) updateData.sort_order = sort_order;
      if (req.body?.parent_id !== undefined) {
        const requestedParentId = req.body?.parent_id ? String(req.body.parent_id).trim() : null;
        if (requestedParentId === id) {
          return res.status(400).json({ error: 'Section cannot be its own parent' });
        }

        if (requestedParentId) {
          const { data: parent, error: parentError } = await supabase
            .from('note_sections')
            .select('id')
            .eq('id', requestedParentId)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
          if (parentError) throw parentError;
          if (!parent?.id) return res.status(404).json({ error: 'Parent section not found' });

          const { data: sectionsForCycle, error: cycleError } = await supabase
            .from('note_sections')
            .select('id, parent_id')
            .eq('workspace_id', workspaceId);
          if (cycleError) throw cycleError;
          const byId = new Map((sectionsForCycle ?? []).map((row) => [row.id, row]));
          let cursor = byId.get(requestedParentId) ?? null;
          while (cursor) {
            if (cursor.id === id) {
              return res.status(400).json({ error: 'Cannot move folder into its own descendant' });
            }
            cursor = cursor.parent_id ? byId.get(cursor.parent_id) ?? null : null;
          }
        }
        updateData.parent_id = requestedParentId;
      }
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('note_sections')
        .update(updateData)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('id, name, color, parent_id, sort_order, created_at, updated_at')
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Section not found' });
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /api/sections/:id - Delete section (moves notes to NULL section)
app.delete(
  '/api/sections/:id([0-9a-fA-F-]{36})',
  authMiddleware,
  rateLimit('write'),
  withWorkspaceContext,
  async (req, res) => {
    try {
      const { workspaceId } = req.user;
      const { id } = req.params;

      // Move all notes in this section to NULL section_id
      const { error: updateError } = await supabase
        .from('notes')
        .update({ section_id: null })
        .eq('section_id', id);

      if (updateError) throw updateError;

      const { error: childDetachError } = await supabase
        .from('note_sections')
        .update({ parent_id: null, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('parent_id', id);

      if (childDetachError) throw childDetachError;

      // Delete the section
      const { error: deleteError } = await supabase
        .from('note_sections')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (deleteError) throw deleteError;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PATCH /api/sections/reorder - Bulk reorder sections
app.patch(
  '/api/sections/reorder',
  authMiddleware,
  rateLimit('write'),
  withWorkspaceContext,
  async (req, res) => {
    try {
      const { workspaceId } = req.user;
      const { sections } = req.body; // Array of { id, sort_order, parent_id? }

      if (!Array.isArray(sections)) {
        return res.status(400).json({ error: 'sections must be an array' });
      }

      // Update each section's sort_order
      for (const section of sections) {
        const updatePayload = {
          sort_order: section.sort_order,
          updated_at: new Date().toISOString(),
        };
        if (section.parent_id !== undefined) {
          updatePayload.parent_id = section.parent_id ? String(section.parent_id).trim() : null;
        }
        const { error } = await supabase
          .from('note_sections')
          .update(updatePayload)
          .eq('id', section.id)
          .eq('workspace_id', workspaceId);

        if (error) throw error;
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
