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
const allowedCorsOrigins = new Set(
  [
    'https://ledgerworkspace.com',
    'https://www.ledgerworkspace.com',
    process.env.FRONTEND_URL?.trim(),
    process.env.PUBLIC_FRONTEND_URL?.trim(),
    process.env.DEV_FRONTEND_URL?.trim(),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ].filter((origin) => typeof origin === 'string' && origin.length > 0)
);

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
});

const captureRawBody = (req, _res, buffer) => {
  if (buffer?.length) {
    req.rawBody = buffer.toString('utf8');
  }
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === 'null') {
        return callback(null, true);
      }

      if (allowedCorsOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
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

const getBearerToken = (req) => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const hashExtensionToken = (token) =>
  crypto.createHash('sha256').update(String(token ?? '')).digest('hex');

const createRawExtensionToken = () => `ledger_ext_${crypto.randomBytes(32).toString('base64url')}`;

const mapExtensionTokenStatus = (row) => ({
  exists: Boolean(row?.id && !row?.revoked_at),
  created_at: row?.created_at ?? null,
  last_used_at: row?.last_used_at ?? null,
  revoked_at: row?.revoked_at ?? null,
});

const isUuidLike = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? '').trim()
  );

const clampText = (value, maxLength) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const clampMultilineText = (value, maxLength) => {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const titleCaseLabel = (value) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Inbox';

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

const getPublicErrorStatus = (error) => {
  const statusCode = Number(error?.statusCode ?? error?.status ?? 500);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }
  return 500;
};

const getPublicErrorMessage = (error, statusCode) => {
  if (statusCode >= 500) {
    return 'Internal server error';
  }

  const message = String(error?.message ?? '').trim();
  return message || 'Request failed';
};

const respondWithError = (res, error) => {
  const statusCode = getPublicErrorStatus(error);
  if (statusCode >= 500) {
    console.error('Request failed:', error);
  }

  return res.status(statusCode).json({ error: getPublicErrorMessage(error, statusCode) });
};

const getMobileErrorMessage = (error, statusCode) => {
  if (statusCode === 401) return 'Not authenticated.';
  if (statusCode === 403) return 'Not authorized.';
  if (statusCode === 404) return 'Workspace not found.';
  if (statusCode >= 500) return 'Could not load mobile data.';

  const message = String(error?.message ?? '').trim();
  return message || 'Could not load mobile data.';
};

const respondWithMobileError = (res, error) => {
  const statusCode = getPublicErrorStatus(error);
  if (statusCode >= 500) {
    console.error('Mobile request failed:', error);
  }

  return res.status(statusCode).json({ error: getMobileErrorMessage(error, statusCode) });
};

const authMiddleware = async (req, res, next) => {
  const token = getBearerToken(req);
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

const requireAuth = async (req) => {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Not authenticated.');
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error('Not authenticated.');
    authError.statusCode = 401;
    throw authError;
  }

  req.authUser = data.user;
  return data.user;
};

const loadExtensionTokenContext = async (token) => {
  const tokenHash = hashExtensionToken(token);
  const tokenResult = await supabase
    .from('extension_tokens')
    .select('id, user_id, workspace_id, name, created_at, last_used_at, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (tokenResult.error) throw tokenResult.error;
  const tokenRow = tokenResult.data;
  if (!tokenRow?.id || !tokenRow.user_id) {
    return null;
  }

  const userResult = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, active_workspace_id, preferences, created_at, updated_at')
    .eq('id', tokenRow.user_id)
    .maybeSingle();

  if (userResult.error) throw userResult.error;
  if (!userResult.data?.id) {
    return null;
  }

  const now = new Date().toISOString();
  supabase
    .from('extension_tokens')
    .update({ last_used_at: now })
    .eq('id', tokenRow.id)
    .then(({ error }) => {
      if (error) {
        console.error('Failed to update extension token last_used_at:', error.message);
      }
    });

  return {
    token: tokenRow,
    user: userResult.data,
  };
};

const extensionAuthMiddleware = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const context = await loadExtensionTokenContext(token);
    if (!context) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.extensionToken = context.token;
    req.authUser = context.user;
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
  'id, workspace_id, user_id, title, body, remind_at, status, linked_type, linked_id, completed_at, dismissed_at, snoozed_until, created_at, updated_at, calendar_id, project_id, note_id, notes, color, is_done, created_by, series_id, series_type, recurrence_rule';
const reminderDashboardSelectColumns =
  'id, workspace_id, user_id, title, body, remind_at, status, linked_type, linked_id, completed_at, dismissed_at, snoozed_until, created_at, updated_at, calendar_id, project_id, note_id, notes, color, is_done, created_by, series_id, series_type, recurrence_rule';
const reminderLinkedTypes = ['task', 'event', 'note', 'project', 'inbox', 'none'];
const reminderStatusValues = ['active', 'completed', 'dismissed', 'overdue'];
const reminderLinkedLabels = {
  task: 'Task',
  event: 'Event',
  note: 'Note',
  project: 'Project',
  inbox: 'Inbox item',
};
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

const SPECIFIC_DATES_SERIES_TYPE = 'specific_dates';

const normalizeDateKeyList = (value, fieldName = 'specific_dates') => {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    const error = new Error(`${fieldName} must be an array`);
    error.statusCode = 400;
    throw error;
  }

  const seen = new Set();
  const dates = [];
  for (const rawValue of value) {
    const normalized = normalizeNullableText(rawValue);
    if (!normalized) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const error = new Error(`Invalid ${fieldName} entry`);
      error.statusCode = 400;
      throw error;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    dates.push(normalized);
  }

  return dates.sort();
};

const parseDateKey = (value) => {
  const normalized = normalizeNullableText(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const error = new Error('Invalid date key');
    error.statusCode = 400;
    throw error;
  }

  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Invalid date key');
    error.statusCode = 400;
    throw error;
  }

  return date;
};

const buildLocalDateTimeFromDateKey = (dateKey, sourceDate) => {
  const day = parseDateKey(dateKey);
  const time = sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime()) ? sourceDate : new Date();
  day.setHours(
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
    time.getMilliseconds()
  );
  return day.toISOString();
};

const buildSpecificDateSeriesPayload = ({
  baseStartAt,
  baseEndAt,
  dateKeys,
  sharedFields,
  seriesType = SPECIFIC_DATES_SERIES_TYPE,
  recurrenceRule = null,
  includeEndAt = true,
}) => {
  const startSource = new Date(baseStartAt);
  if (Number.isNaN(startSource.getTime())) {
    const error = new Error('Invalid start_at');
    error.statusCode = 400;
    throw error;
  }

  const endSource = baseEndAt ? new Date(baseEndAt) : null;
  const durationMs =
    endSource && !Number.isNaN(endSource.getTime())
      ? Math.max(1, endSource.getTime() - startSource.getTime())
      : 60 * 60 * 1000;

  return dateKeys.map((dateKey) => {
    const occurrenceStart = buildLocalDateTimeFromDateKey(dateKey, startSource);
    const payload = {
      ...sharedFields,
      start_at: occurrenceStart,
      series_id: sharedFields.series_id,
      series_type: seriesType,
      recurrence_rule: recurrenceRule,
    };
    if (includeEndAt) {
      payload.end_at = new Date(new Date(occurrenceStart).getTime() + durationMs).toISOString();
    }
    return payload;
  });
};

const normalizeEventVisibility = (value) => {
  const normalized = normalizeNullableText(value);
  return normalized === 'workspace' ? 'workspace' : 'private';
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

const noteSelectColumns =
  'id, workspace_id, user_id, updated_by, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at';

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

const getInviteBaseUrl = () => {
  const explicit = normalizeInviteOrigin(process.env.INVITE_BASE_URL?.trim());
  if (explicit) return explicit;

  const frontendUrl = normalizeInviteOrigin(process.env.FRONTEND_URL?.trim());
  if (frontendUrl) return frontendUrl;

  if (process.env.NODE_ENV !== 'production') {
    const publicFrontendUrl = normalizeInviteOrigin(process.env.PUBLIC_FRONTEND_URL?.trim());
    if (publicFrontendUrl) return publicFrontendUrl;
  }

  return null;
};

const mapWorkspaceInvite = (row, nowIso = new Date().toISOString(), includeToken = false) => {
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
    token: includeToken ? row.token ?? null : null,
    invited_by: row.created_by,
    created_by: row.created_by,
    created_at: row.created_at,
  };
};

const userPreferencesDefaults = {
  weekStartsOn: 'monday',
  timeFormat: '12h',
  defaultEventMinutes: 30,
  defaultEventCalendar: 'personal',
  defaultEventStatus: 'planned',
  defaultEventVisibility: 'private',
  reminderLeadMinutes: 15,
  defaultReminderTime: '09:00',
  reminderSnoozePreset: '10m-1h-tomorrow',
  reminderDestination: 'today-calendar',
  missedReminderBehavior: 'needs_attention',
  completedReminderBehavior: 'collapse',
  pastEventBehavior: 'history',
  followUpBehavior: 'offer',
  followUpDefaultTime: 'tomorrow_9',
  eventNotesBehavior: 'enabled',
  linkedProjectFollowUps: 'project_and_today',
  defaultCalendarView: 'week',
  showWeekends: true,
  showRemindersOnCalendar: true,
  showCompletedItems: 'muted',
  calendarScope: 'current_workspace',
  defaultWorkspaceCalendar: 'personal',
  calendarColor: 'ledger-orange',
  openDashboardByDefault: true,
  reduceMotion: false,
  highContrast: false,
  compactDensity: false,
  showTrayIcon: true,
  runInBackground: true,
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

  const defaultEventCalendar = ['personal', 'work', 'projects'].includes(
    String(merged.defaultEventCalendar)
  )
    ? String(merged.defaultEventCalendar)
    : userPreferencesDefaults.defaultEventCalendar;

  const defaultEventStatus = ['planned', 'tentative', 'confirmed'].includes(
    String(merged.defaultEventStatus)
  )
    ? String(merged.defaultEventStatus)
    : userPreferencesDefaults.defaultEventStatus;

  const defaultEventVisibility = ['private', 'workspace'].includes(
    String(merged.defaultEventVisibility)
  )
    ? String(merged.defaultEventVisibility)
    : userPreferencesDefaults.defaultEventVisibility;

  const defaultReminderTime = ['08:00', '09:00', '12:00', '17:00'].includes(
    String(merged.defaultReminderTime)
  )
    ? String(merged.defaultReminderTime)
    : userPreferencesDefaults.defaultReminderTime;

  const reminderSnoozePreset = ['10m-1h-tomorrow', '5m-15m-1h', '15m-1h-tomorrow'].includes(
    String(merged.reminderSnoozePreset)
  )
    ? String(merged.reminderSnoozePreset)
    : userPreferencesDefaults.reminderSnoozePreset;

  const reminderDestination = ['today-calendar', 'today', 'calendar'].includes(
    String(merged.reminderDestination)
  )
    ? String(merged.reminderDestination)
    : userPreferencesDefaults.reminderDestination;

  const missedReminderBehavior = ['needs_attention', 'today', 'hide'].includes(
    String(merged.missedReminderBehavior)
  )
    ? String(merged.missedReminderBehavior)
    : userPreferencesDefaults.missedReminderBehavior;

  const completedReminderBehavior = ['collapse', 'keep_visible', 'hide_immediately'].includes(
    String(merged.completedReminderBehavior)
  )
    ? String(merged.completedReminderBehavior)
    : userPreferencesDefaults.completedReminderBehavior;

  const pastEventBehavior = ['history', 'fade', 'upcoming_only'].includes(
    String(merged.pastEventBehavior)
  )
    ? String(merged.pastEventBehavior)
    : userPreferencesDefaults.pastEventBehavior;

  const followUpBehavior = ['none', 'offer', 'review_prompt'].includes(
    String(merged.followUpBehavior)
  )
    ? String(merged.followUpBehavior)
    : userPreferencesDefaults.followUpBehavior;

  const followUpDefaultTime = ['tomorrow_9', 'today_5', 'next_morning', 'custom'].includes(
    String(merged.followUpDefaultTime)
  )
    ? String(merged.followUpDefaultTime)
    : userPreferencesDefaults.followUpDefaultTime;

  const eventNotesBehavior = ['enabled', 'disabled'].includes(String(merged.eventNotesBehavior))
    ? String(merged.eventNotesBehavior)
    : userPreferencesDefaults.eventNotesBehavior;

  const linkedProjectFollowUps = ['project_and_today', 'project_only', 'today_only'].includes(
    String(merged.linkedProjectFollowUps)
  )
    ? String(merged.linkedProjectFollowUps)
    : userPreferencesDefaults.linkedProjectFollowUps;

  const defaultCalendarView = ['day', 'week', 'month'].includes(String(merged.defaultCalendarView))
    ? String(merged.defaultCalendarView)
    : userPreferencesDefaults.defaultCalendarView;

  const showCompletedItems = ['muted', 'hidden', 'visible'].includes(
    String(merged.showCompletedItems)
  )
    ? String(merged.showCompletedItems)
    : userPreferencesDefaults.showCompletedItems;

  const calendarScope = ['current_workspace', 'all_accessible_workspaces'].includes(
    String(merged.calendarScope)
  )
    ? String(merged.calendarScope)
    : userPreferencesDefaults.calendarScope;

  const defaultWorkspaceCalendar = ['personal', 'workspace', 'projects'].includes(
    String(merged.defaultWorkspaceCalendar)
  )
    ? String(merged.defaultWorkspaceCalendar)
    : userPreferencesDefaults.defaultWorkspaceCalendar;

  const calendarColor = ['ledger-orange', 'blue', 'green', 'gray'].includes(
    String(merged.calendarColor)
  )
    ? String(merged.calendarColor)
    : userPreferencesDefaults.calendarColor;

  return {
    weekStartsOn: String(merged.weekStartsOn).toLowerCase() === 'sunday' ? 'sunday' : 'monday',
    timeFormat: String(merged.timeFormat).toLowerCase() === '24h' ? '24h' : '12h',
    defaultEventMinutes,
    defaultEventCalendar,
    defaultEventStatus,
    defaultEventVisibility,
    reminderLeadMinutes,
    defaultReminderTime,
    reminderSnoozePreset,
    reminderDestination,
    missedReminderBehavior,
    completedReminderBehavior,
    pastEventBehavior,
    followUpBehavior,
    followUpDefaultTime,
    eventNotesBehavior,
    linkedProjectFollowUps,
    defaultCalendarView,
    showWeekends: Boolean(merged.showWeekends),
    showRemindersOnCalendar: Boolean(merged.showRemindersOnCalendar),
    showCompletedItems,
    calendarScope,
    defaultWorkspaceCalendar,
    calendarColor,
    openDashboardByDefault: Boolean(merged.openDashboardByDefault),
    reduceMotion: Boolean(merged.reduceMotion),
    highContrast: Boolean(merged.highContrast),
    compactDensity: Boolean(merged.compactDensity),
    showTrayIcon: Boolean(merged.showTrayIcon),
    runInBackground: Boolean(merged.runInBackground),
  };
};

const notificationPreferencesDefaults = {
  desktopEnabled: false,
  inAppEnabled: true,
  remindersEnabled: true,
  eventsEnabled: true,
  tasksEnabled: false,
  projectDeadlinesEnabled: true,
  inboxCapturesEnabled: false,
  overdueEnabled: true,
  paused: false,
  defaultEventLeadMinutes: 10,
  defaultTaskTiming: 'morning_of',
  defaultProjectDeadlineLeadDays: 1,
  defaultSnoozeMinutes: 10,
  keepOverdueVisible: true,
  notifyWhileFullscreen: false,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};

const notificationPreferencesSelectColumns =
  'id, user_id, desktop_enabled, in_app_enabled, reminders_enabled, events_enabled, tasks_enabled, project_deadlines_enabled, inbox_captures_enabled, overdue_enabled, paused, default_event_lead_minutes, default_task_timing, default_project_deadline_lead_days, default_snooze_minutes, keep_overdue_visible, notify_while_fullscreen, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, created_at, updated_at';

const normalizeNotificationClockTime = (value) => {
  const text = normalizeNullableText(value);
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const normalizeNotificationPreferences = (value) => {
  const raw = value && typeof value === 'object' ? value : {};
  const merged = { ...notificationPreferencesDefaults, ...raw };

  const defaultEventLeadMinutes = [0, 5, 10, 30, 60].includes(Number(merged.defaultEventLeadMinutes))
    ? Number(merged.defaultEventLeadMinutes)
    : notificationPreferencesDefaults.defaultEventLeadMinutes;

  const defaultTaskTiming = ['morning_of', 'at_due_time', 'day_before', 'none'].includes(
    String(merged.defaultTaskTiming)
  )
    ? String(merged.defaultTaskTiming)
    : notificationPreferencesDefaults.defaultTaskTiming;

  const defaultProjectDeadlineLeadDays = [0, 1, 3, 7].includes(
    Number(merged.defaultProjectDeadlineLeadDays)
  )
    ? Number(merged.defaultProjectDeadlineLeadDays)
    : notificationPreferencesDefaults.defaultProjectDeadlineLeadDays;

  const defaultSnoozeMinutes = [10, 30, 60, 1440].includes(Number(merged.defaultSnoozeMinutes))
    ? Number(merged.defaultSnoozeMinutes)
    : notificationPreferencesDefaults.defaultSnoozeMinutes;

  return {
    desktopEnabled: Boolean(merged.desktopEnabled),
    inAppEnabled: Boolean(merged.inAppEnabled),
    remindersEnabled: Boolean(merged.remindersEnabled),
    eventsEnabled: Boolean(merged.eventsEnabled),
    tasksEnabled: Boolean(merged.tasksEnabled),
    projectDeadlinesEnabled: Boolean(merged.projectDeadlinesEnabled),
    inboxCapturesEnabled: Boolean(merged.inboxCapturesEnabled),
    overdueEnabled: Boolean(merged.overdueEnabled),
    paused: Boolean(merged.paused),
    defaultEventLeadMinutes,
    defaultTaskTiming,
    defaultProjectDeadlineLeadDays,
    defaultSnoozeMinutes,
    keepOverdueVisible: Boolean(merged.keepOverdueVisible),
    notifyWhileFullscreen: Boolean(merged.notifyWhileFullscreen),
    quietHoursEnabled: Boolean(merged.quietHoursEnabled),
    quietHoursStart: normalizeNotificationClockTime(merged.quietHoursStart),
    quietHoursEnd: normalizeNotificationClockTime(merged.quietHoursEnd),
  };
};

const mapNotificationPreferencesRow = (row) => ({
  id: row?.id ?? null,
  userId: row?.user_id ?? null,
  desktopEnabled: Boolean(row?.desktop_enabled),
  inAppEnabled: Boolean(row?.in_app_enabled),
  remindersEnabled: Boolean(row?.reminders_enabled),
  eventsEnabled: Boolean(row?.events_enabled),
  tasksEnabled: Boolean(row?.tasks_enabled),
  projectDeadlinesEnabled: Boolean(row?.project_deadlines_enabled),
  inboxCapturesEnabled: Boolean(row?.inbox_captures_enabled),
  overdueEnabled: Boolean(row?.overdue_enabled),
  paused: Boolean(row?.paused),
  defaultEventLeadMinutes: Number(row?.default_event_lead_minutes ?? 10),
  defaultTaskTiming: String(row?.default_task_timing ?? notificationPreferencesDefaults.defaultTaskTiming),
  defaultProjectDeadlineLeadDays: Number(
    row?.default_project_deadline_lead_days ?? notificationPreferencesDefaults.defaultProjectDeadlineLeadDays
  ),
  defaultSnoozeMinutes: Number(row?.default_snooze_minutes ?? 10),
  keepOverdueVisible: Boolean(row?.keep_overdue_visible),
  notifyWhileFullscreen: Boolean(row?.notify_while_fullscreen),
  quietHoursEnabled: Boolean(row?.quiet_hours_enabled),
  quietHoursStart: row?.quiet_hours_start ?? null,
  quietHoursEnd: row?.quiet_hours_end ?? null,
  created_at: row?.created_at ?? null,
  updated_at: row?.updated_at ?? null,
});

const notificationPreferencesInsertPayload = (userId, value) => {
  const prefs = normalizeNotificationPreferences(value);
  return {
    user_id: userId,
    desktop_enabled: prefs.desktopEnabled,
    in_app_enabled: prefs.inAppEnabled,
    reminders_enabled: prefs.remindersEnabled,
    events_enabled: prefs.eventsEnabled,
    tasks_enabled: prefs.tasksEnabled,
    project_deadlines_enabled: prefs.projectDeadlinesEnabled,
    inbox_captures_enabled: prefs.inboxCapturesEnabled,
    overdue_enabled: prefs.overdueEnabled,
    paused: prefs.paused,
    default_event_lead_minutes: prefs.defaultEventLeadMinutes,
    default_task_timing: prefs.defaultTaskTiming,
    default_project_deadline_lead_days: prefs.defaultProjectDeadlineLeadDays,
    default_snooze_minutes: prefs.defaultSnoozeMinutes,
    keep_overdue_visible: prefs.keepOverdueVisible,
    notify_while_fullscreen: prefs.notifyWhileFullscreen,
    quiet_hours_enabled: prefs.quietHoursEnabled,
    quiet_hours_start: prefs.quietHoursStart,
    quiet_hours_end: prefs.quietHoursEnd,
  };
};

const getOrCreateNotificationPreferences = async (userId) => {
  const existing = await supabase
    .from('notification_preferences')
    .select(notificationPreferencesSelectColumns)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data;

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(notificationPreferencesInsertPayload(userId, notificationPreferencesDefaults), {
      onConflict: 'user_id',
    })
    .select(notificationPreferencesSelectColumns)
    .single();

  if (error) throw error;
  return data;
};

const notificationActionValues = new Set(['open', 'dismiss', 'complete', 'snooze']);

const notificationScheduledBucket = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setSeconds(0, 0);
  return date.toISOString();
};

const localDateAtTime = (dateLike, timeText, fallbackHour = 9) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const [hours, minutes] = String(timeText ?? '')
    .split(':')
    .map((part) => Number(part));
  const safeHour = Number.isInteger(hours) ? hours : fallbackHour;
  const safeMinute = Number.isInteger(minutes) ? minutes : 0;
  date.setHours(safeHour, safeMinute, 0, 0);
  return date;
};

const endOfLocalDay = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const startOfLocalDay = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const isSameDay = (left, right) => {
  const a = new Date(left);
  const b = new Date(right);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

const formatNotificationDate = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatNotificationTime = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatNotificationDateTime = (dateLike) => {
  const dateLabel = formatNotificationDate(dateLike);
  const timeLabel = formatNotificationTime(dateLike);
  if (dateLabel && timeLabel) return `${dateLabel} at ${timeLabel}`;
  return dateLabel || timeLabel || null;
};

const isGenericNotificationTitle = (title, sourceType) => {
  const normalized = String(title ?? '').trim().toLowerCase();
  if (!normalized) return true;

  if (sourceType === 'reminder') {
    return /^reminder(?:\s*[:\-]\s*due)?$/.test(normalized);
  }
  if (sourceType === 'event') {
    return /^event(?:\s*(?:soon|starting))?$/.test(normalized);
  }
  if (sourceType === 'task') {
    return /^task(?:\s*due)?$/.test(normalized);
  }
  if (sourceType === 'project') {
    return /^project(?:\s*deadline)?$/.test(normalized);
  }
  if (sourceType === 'inbox') {
    return /^inbox(?:\s*capture)?$/.test(normalized);
  }

  return false;
};

const pickSpecificNotificationTitle = (title, sourceType) => {
  const normalized = normalizeNullableText(title);
  if (!normalized || isGenericNotificationTitle(normalized, sourceType)) {
    return null;
  }
  return normalized;
};

const buildNotificationEventPayload = ({
  userId,
  workspaceId,
  sourceType,
  sourceId,
  notificationType,
  scheduledFor,
  metadata = {},
  deliveredInAppAt = null,
}) => ({
  user_id: userId,
  workspace_id: workspaceId ?? null,
  source_type: sourceType,
  source_id: String(sourceId),
  notification_type: notificationType,
  scheduled_for: scheduledFor,
  delivered_in_app_at: deliveredInAppAt,
  metadata,
});

const mapNotificationEventRow = (row, extras = {}) => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id ?? null,
  sourceType: row.source_type,
  sourceId: row.source_id,
  notificationType: row.notification_type,
  scheduledFor: row.scheduled_for,
  deliveredInAppAt: row.delivered_in_app_at ?? null,
  deliveredDesktopAt: row.delivered_desktop_at ?? null,
  dismissedAt: row.dismissed_at ?? null,
  actionTaken: row.action_taken ?? null,
  metadata: safeJson(row.metadata, {}) ?? {},
  title: extras.title ?? null,
  body: extras.body ?? null,
  workspaceName: extras.workspaceName ?? null,
  workspaceColor: extras.workspaceColor ?? null,
  moduleKind: extras.moduleKind ?? null,
  focusPayload: extras.focusPayload ?? null,
  actions: extras.actions ?? [],
});

const getNotificationSourcePayload = async (userId, candidates) => {
  const workspaceIds = Array.from(new Set(candidates.map((item) => item.workspace_id).filter(Boolean)));
  const projectIds = Array.from(new Set(candidates.map((item) => item.project_id).filter(Boolean)));
  const noteIds = Array.from(new Set(candidates.map((item) => item.note_id).filter(Boolean)));
  const calendarIds = Array.from(new Set(candidates.map((item) => item.calendar_id).filter(Boolean)));

  const [workspaceResult, projectResult, noteResult, calendarResult] = await Promise.all([
    workspaceIds.length
      ? supabase.from('workspaces').select('id, name, color').in('id', workspaceIds)
      : { data: [] },
    projectIds.length ? supabase.from('projects').select('id, name').in('id', projectIds) : { data: [] },
    noteIds.length ? supabase.from('notes').select('id, title').in('id', noteIds) : { data: [] },
    calendarIds.length
      ? supabase.from('calendars').select('id, name, color').in('id', calendarIds)
      : { data: [] },
  ]);

  if (workspaceResult.error) throw workspaceResult.error;
  if (projectResult.error) throw projectResult.error;
  if (noteResult.error) throw noteResult.error;
  if (calendarResult.error) throw calendarResult.error;

  const workspaceById = new Map((workspaceResult.data || []).map((workspace) => [workspace.id, workspace]));
  const projectById = new Map((projectResult.data || []).map((project) => [project.id, project]));
  const noteById = new Map((noteResult.data || []).map((note) => [note.id, note]));
  const calendarById = new Map((calendarResult.data || []).map((calendar) => [calendar.id, calendar]));

  return {
    workspaceById,
    projectById,
    noteById,
    calendarById,
  };
};

const buildDueNotificationCandidates = async (userId, prefs) => {
  const workspaceIds = Array.from(await getUserWorkspaceIds(userId));
  if (!workspaceIds.length) return [];

  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  if (!todayStart || !todayEnd) return [];

  const candidates = [];

  if (prefs.remindersEnabled) {
    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .select(reminderSelectColumns)
        .in('workspace_id', workspaceIds)
        .eq('is_done', false)
        .or('status.eq.active,status.eq.overdue')
        .order('remind_at', { ascending: true })
        .limit(500)
    );
    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      const remindAt = new Date(row?.remind_at ?? '');
      if (Number.isNaN(remindAt.getTime())) continue;
      if (remindAt > now) continue;
      if (row?.dismissed_at) continue;
      const reminderTitle = normalizeNullableText(row.title) || 'Reminder due';
      const dueLabel = formatNotificationDateTime(remindAt);
      const notesLabel = normalizeNullableText(row.body ?? row.notes);
      const reminderBodyParts = [dueLabel ? `Due ${dueLabel}` : null, notesLabel].filter(Boolean);

      candidates.push({
        user_id: userId,
        workspace_id: row.workspace_id ?? null,
        source_type: 'reminder',
        source_id: String(row.id),
        notification_type: 'reminder_due',
        scheduled_for: notificationScheduledBucket(row.remind_at),
        metadata: {
          reminder_id: row.id,
          project_id: row.project_id ?? null,
          note_id: row.note_id ?? null,
          calendar_id: row.calendar_id ?? null,
        },
        title: reminderTitle,
        body: reminderBodyParts.join(' · ') || null,
        moduleKind: 'calendar',
        focusPayload: row.calendar_id
          ? { kind: 'calendar', focusContext: `focus-reminder:${row.id}` }
          : { kind: 'calendar' },
        actions: ['open', 'complete', 'snooze', 'dismiss'],
        workspace_id_for_fetch: row.workspace_id ?? null,
        project_id: row.project_id ?? null,
        note_id: row.note_id ?? null,
        calendar_id: row.calendar_id ?? null,
      });
    }
  }

  if (prefs.eventsEnabled) {
    const leadMinutes = Number(prefs.defaultEventLeadMinutes ?? 10);
    const endWindow = new Date(now.getTime() + Math.max(0, leadMinutes) * 60 * 1000);
    const { data, error } = await supabase
      .from('events')
      .select('id, workspace_id, title, start_at, end_at, calendar_id, color, status, project_id, note_id')
      .in('workspace_id', workspaceIds)
      .gte('start_at', now.toISOString())
      .lte('start_at', endWindow.toISOString())
      .limit(250);

    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      if (String(row?.status ?? '').toLowerCase() === 'done') continue;
      const startAt = new Date(row?.start_at ?? '');
      if (Number.isNaN(startAt.getTime())) continue;
      const scheduledFor = new Date(startAt.getTime() - leadMinutes * 60 * 1000);
      if (scheduledFor > now) continue;
      const eventTitle = normalizeNullableText(row.title) || 'Event starting';
      const startsLabel = formatNotificationDateTime(startAt);

      candidates.push({
        user_id: userId,
        workspace_id: row.workspace_id ?? null,
        source_type: 'event',
        source_id: String(row.id),
        notification_type: 'event_starting',
        scheduled_for: notificationScheduledBucket(scheduledFor.toISOString()),
        metadata: {
          event_id: row.id,
          calendar_id: row.calendar_id ?? null,
          project_id: row.project_id ?? null,
          note_id: row.note_id ?? null,
        },
        title: eventTitle,
        body: startsLabel ? `Starts ${startsLabel}` : null,
        moduleKind: 'calendar',
        focusPayload: { kind: 'calendar', focusContext: `focus-event:${row.id}` },
        actions: ['open', 'dismiss'],
        workspace_id_for_fetch: row.workspace_id ?? null,
        project_id: row.project_id ?? null,
        note_id: row.note_id ?? null,
        calendar_id: row.calendar_id ?? null,
      });
    }
  }

  if (prefs.tasksEnabled) {
    const { data, error } = await supabase
      .from('tasks')
      .select(taskSelectColumns)
      .in('workspace_id', workspaceIds)
      .neq('status', 'completed')
      .limit(500);
    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      if (!row?.due_date) continue;
      const dueDate = new Date(`${String(row.due_date)}T00:00:00`);
      if (Number.isNaN(dueDate.getTime())) continue;

      let scheduledFor = null;
      const dueTime = normalizeNullableText(row.due_time);
      const timing = String(prefs.defaultTaskTiming ?? 'morning_of');
      if (timing === 'none') continue;
      if (timing === 'day_before') {
        const dayBefore = new Date(dueDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        scheduledFor = localDateAtTime(dayBefore, '09:00');
      } else if (timing === 'at_due_time' && dueTime) {
        scheduledFor = localDateAtTime(dueDate, dueTime);
      } else {
        scheduledFor = localDateAtTime(dueDate, '09:00');
      }

      if (!scheduledFor || scheduledFor > now) continue;

      const notificationType = isSameDay(dueDate, now) ? 'task_due' : 'overdue_item';
      const taskDueAt = dueTime ? localDateAtTime(dueDate, dueTime) : dueDate;
      const dueLabel = taskDueAt ? formatNotificationDateTime(taskDueAt) : formatNotificationDate(dueDate);
      const taskTitle = normalizeNullableText(row.title) || 'Task due';
      candidates.push({
        user_id: userId,
        workspace_id: row.workspace_id ?? null,
        source_type: 'task',
        source_id: String(row.id),
        notification_type: notificationType,
        scheduled_for: notificationScheduledBucket(
          notificationType === 'overdue_item' ? todayStart.toISOString() : scheduledFor.toISOString()
        ),
        metadata: {
          task_id: row.id,
          project_id: row.project_id ?? null,
        },
        title: taskTitle,
        body: dueLabel ? `Due ${dueLabel}` : null,
        moduleKind: 'dashboard',
        focusPayload: { kind: 'dashboard', focusTaskId: row.id },
        actions: ['open', 'complete', 'dismiss'],
        workspace_id_for_fetch: row.workspace_id ?? null,
        project_id: row.project_id ?? null,
      });
    }
  }

  const projectLeadDays = Number(prefs.defaultProjectDeadlineLeadDays ?? 1);
  if (prefs.projectDeadlinesEnabled && projectLeadDays >= 0) {
    const { data, error } = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .in('workspace_id', workspaceIds)
      .not('end_date', 'is', null)
      .limit(250);
    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      if (!row?.end_date || isCompletedProjectStatus(row.status)) continue;
      const dueDate = new Date(`${String(row.end_date)}T00:00:00`);
      if (Number.isNaN(dueDate.getTime())) continue;

      const leadDate = new Date(dueDate);
      leadDate.setDate(leadDate.getDate() - projectLeadDays);
      const scheduledFor = localDateAtTime(leadDate, '09:00');
      if (!scheduledFor || scheduledFor > now) continue;

      const notificationType = dueDate < todayStart ? 'overdue_item' : 'project_deadline';
      const dueLabel = formatNotificationDate(dueDate);
      const projectName = normalizeNullableText(row.name);
      candidates.push({
        user_id: userId,
        workspace_id: row.workspace_id ?? null,
        source_type: 'project',
        source_id: String(row.id),
        notification_type: notificationType,
        scheduled_for: notificationScheduledBucket(
          notificationType === 'overdue_item' ? todayStart.toISOString() : scheduledFor.toISOString()
        ),
        metadata: {
          project_id: row.id,
        },
        title: projectName || 'Project deadline',
        body: dueLabel ? `Project deadline · Due ${dueLabel}` : 'Project deadline',
        moduleKind: 'projects',
        focusPayload: { kind: 'projects', focusProjectId: row.id },
        actions: ['open', 'dismiss'],
        workspace_id_for_fetch: row.workspace_id ?? null,
        project_id: row.id ?? null,
      });
    }
  }

  if (prefs.inboxCapturesEnabled) {
    const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('inbox_items')
      .select('id, workspace_id, title, body, source, source_url, status, created_at')
      .in('workspace_id', workspaceIds)
      .eq('status', 'unprocessed')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      candidates.push({
        user_id: userId,
        workspace_id: row.workspace_id ?? null,
        source_type: 'inbox',
        source_id: String(row.id),
        notification_type: 'inbox_capture',
        scheduled_for: notificationScheduledBucket(row.created_at ?? now.toISOString()),
        metadata: {
          inbox_item_id: row.id,
          source: row.source ?? null,
          source_url: row.source_url ?? null,
        },
        title: row.title ?? 'Inbox capture',
        body: row.body ?? row.source_url ?? null,
        moduleKind: 'inbox',
        focusPayload: { kind: 'inbox' },
        actions: ['open', 'dismiss'],
        workspace_id_for_fetch: row.workspace_id ?? null,
      });
    }
  }

  const pendingInviteRows = await supabase
    .from('notification_events')
    .select(
      'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata, created_at, updated_at'
    )
    .eq('user_id', userId)
    .in('workspace_id', workspaceIds)
    .eq('source_type', 'workspace_invite')
    .eq('notification_type', 'invite.accepted')
    .is('delivered_in_app_at', null)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (pendingInviteRows.error) throw pendingInviteRows.error;

  for (const row of Array.isArray(pendingInviteRows.data) ? pendingInviteRows.data : []) {
    candidates.push({
      user_id: userId,
      workspace_id: row.workspace_id ?? null,
      source_type: 'workspace_invite',
      source_id: String(row.source_id ?? row.id),
      notification_type: 'invite.accepted',
      scheduled_for: row.scheduled_for ?? notificationScheduledBucket(row.created_at ?? now.toISOString()),
      metadata: safeJson(row.metadata, {}) ?? {},
      title: normalizeNullableText(row.metadata?.title) ?? 'Invite accepted',
      body: normalizeNullableText(row.metadata?.body) ?? 'Someone joined your workspace.',
      moduleKind: 'dashboard',
      focusPayload: normalizeNullableText(row.metadata?.focusPayload) ? safeJson(row.metadata.focusPayload, null) : null,
      actions: Array.isArray(row.metadata?.actions) ? row.metadata.actions : [],
      workspace_id_for_fetch: row.workspace_id ?? null,
    });
  }

  return candidates;
};

const buildNotificationCenterSourceMaps = async (rows) => {
  const workspaceIds = Array.from(new Set(rows.map((item) => item.workspace_id).filter(Boolean)));
  const reminderIds = Array.from(
    new Set(
      rows
        .filter((item) => String(item.source_type ?? '') === 'reminder')
        .map((item) => String(item.source_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const eventIds = Array.from(
    new Set(
      rows
        .filter((item) => String(item.source_type ?? '') === 'event')
        .map((item) => String(item.source_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const taskIds = Array.from(
    new Set(
      rows
        .filter((item) => String(item.source_type ?? '') === 'task')
        .map((item) => String(item.source_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const projectIds = Array.from(
    new Set(
      rows
        .filter((item) => String(item.source_type ?? '') === 'project')
        .map((item) => String(item.source_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const inboxIds = Array.from(
    new Set(
      rows
        .filter((item) => String(item.source_type ?? '') === 'inbox')
        .map((item) => String(item.source_id ?? '').trim())
        .filter(Boolean)
    )
  );

  const [workspaceResult, reminderResult, eventResult, taskResult, projectResult, inboxResult] =
    await Promise.all([
      workspaceIds.length
        ? supabase.from('workspaces').select('id, name, color').in('id', workspaceIds)
        : { data: [] },
      reminderIds.length
        ? withReminderTable((table) =>
            supabase
              .from(table)
              .select(reminderSelectColumns)
              .in('id', reminderIds)
              .limit(reminderIds.length)
          )
        : Promise.resolve({ data: [] }),
      eventIds.length
        ? supabase
            .from('events')
            .select('id, workspace_id, title, start_at, end_at, calendar_id, color, status, project_id, note_id')
            .in('id', eventIds)
        : { data: [] },
      taskIds.length
        ? supabase
            .from('tasks')
            .select(taskSelectColumns)
            .in('id', taskIds)
        : { data: [] },
      projectIds.length
        ? supabase.from('projects').select(projectSelectColumns).in('id', projectIds)
        : { data: [] },
      inboxIds.length
        ? supabase
            .from('inbox_items')
            .select('id, workspace_id, title, body, source, source_url, status, created_at')
            .in('id', inboxIds)
        : { data: [] },
    ]);

  const fetchErrors = [
    workspaceResult.error,
    reminderResult.error,
    eventResult.error,
    taskResult.error,
    projectResult.error,
    inboxResult.error,
  ].filter(Boolean);
  if (fetchErrors.length) throw fetchErrors[0];

  return {
    workspaceById: new Map((workspaceResult.data || []).map((workspace) => [workspace.id, workspace])),
    reminderById: new Map((reminderResult.data || []).map((item) => [String(item.id), item])),
    eventById: new Map((eventResult.data || []).map((item) => [String(item.id), item])),
    taskById: new Map((taskResult.data || []).map((item) => [String(item.id), item])),
    projectById: new Map((projectResult.data || []).map((item) => [String(item.id), item])),
    inboxById: new Map((inboxResult.data || []).map((item) => [String(item.id), item])),
  };
};

const mapNotificationCenterRow = (row, maps) => {
  const metadata = safeJson(row.metadata, {}) ?? {};
  const sourceId = String(row.source_id ?? '');
  const sourceType = String(row.source_type ?? '');
  const workspace = maps.workspaceById.get(row.workspace_id ?? '') ?? null;

  let title = pickSpecificNotificationTitle(metadata.title, sourceType);
  let body = normalizeNullableText(metadata.body);
  let context = normalizeNullableText(metadata.context);
  let moduleKind = metadata.moduleKind ?? null;
  let focusPayload = metadata.focusPayload ?? null;
  let actions = Array.isArray(metadata.actions) ? metadata.actions : null;

  if (sourceType === 'reminder') {
    const reminder = maps.reminderById.get(sourceId) ?? null;
    const reminderTitle = pickSpecificNotificationTitle(reminder?.title, sourceType);
    const remindAt = reminder?.remind_at ? new Date(reminder.remind_at) : null;
    const dueLabel = remindAt ? formatNotificationDateTime(remindAt) : null;
    const reminderBody = normalizeNullableText(reminder?.body ?? reminder?.notes);
    title = title ?? reminderTitle ?? 'Reminder due';
    body = body ?? ([dueLabel ? `Due ${dueLabel}` : null, reminderBody].filter(Boolean).join(' · ') || null);
    moduleKind = moduleKind ?? 'calendar';
    focusPayload = focusPayload ?? { kind: 'calendar', focusContext: `focus-reminder:${sourceId}` };
    context = reminder?.calendar_id
      ? 'Calendar reminder'
      : reminder?.project_id
      ? 'Project reminder'
      : 'Reminder';
    actions = actions ?? ['open', 'complete', 'snooze', 'dismiss'];
  } else if (sourceType === 'event') {
    const event = maps.eventById.get(sourceId) ?? null;
    const eventTitle = pickSpecificNotificationTitle(event?.title, sourceType);
    const startAt = event?.start_at ? new Date(event.start_at) : null;
    title = title ?? eventTitle ?? 'Event soon';
    body = body ?? (startAt && !Number.isNaN(startAt.getTime()) ? `Starts ${formatNotificationDateTime(startAt)}` : null);
    moduleKind = moduleKind ?? 'calendar';
    focusPayload = focusPayload ?? { kind: 'calendar', focusContext: `focus-event:${sourceId}` };
    context = event?.calendar_id ? 'Calendar event' : 'Event';
    actions = actions ?? ['open', 'dismiss'];
  } else if (sourceType === 'task') {
    const task = maps.taskById.get(sourceId) ?? null;
    const taskTitle = pickSpecificNotificationTitle(task?.title, sourceType);
    title = title ?? taskTitle ?? 'Task due';
    if (!body && task?.due_date) {
      const dueDate = new Date(`${String(task.due_date)}T00:00:00`);
      const dueAt = task?.due_time ? localDateAtTime(dueDate, task.due_time) : dueDate;
      const dueLabel = dueAt ? formatNotificationDateTime(dueAt) : formatNotificationDate(dueDate);
      body = dueLabel ? `Due ${dueLabel}` : null;
    }
    moduleKind = moduleKind ?? 'dashboard';
    focusPayload = focusPayload ?? { kind: 'dashboard', focusTaskId: sourceId };
    context = task?.project_id ? 'Task' : 'Today item';
    actions = actions ?? ['open', 'complete', 'dismiss'];
  } else if (sourceType === 'project') {
    const project = maps.projectById.get(sourceId) ?? null;
    const projectTitle = pickSpecificNotificationTitle(project?.name, sourceType);
    title = title ?? projectTitle ?? 'Project deadline';
    if (!body && project?.end_date) {
      const dueDate = new Date(`${String(project.end_date)}T00:00:00`);
      const dueLabel = formatNotificationDate(dueDate);
      body = dueLabel ? `Project deadline · Due ${dueLabel}` : 'Project deadline';
    }
    moduleKind = moduleKind ?? 'projects';
    focusPayload = focusPayload ?? { kind: 'projects', focusProjectId: sourceId };
    context = 'Project';
    actions = actions ?? ['open', 'dismiss'];
  } else if (sourceType === 'inbox') {
    const inbox = maps.inboxById.get(sourceId) ?? null;
    title = title ?? inbox?.title ?? 'Inbox capture';
    body = body ?? inbox?.body ?? inbox?.source_url ?? 'Waiting in Inbox';
    moduleKind = moduleKind ?? 'inbox';
    focusPayload = focusPayload ?? { kind: 'inbox' };
    context = inbox?.source ? `Capture from ${String(inbox.source)}` : 'Inbox capture';
    actions = actions ?? ['open', 'dismiss'];
  } else if (sourceType === 'workspace_invite') {
    title = title ?? 'Invite accepted';
    body = body ?? 'Someone joined your workspace.';
    moduleKind = moduleKind ?? 'dashboard';
    context = context ?? 'Workspace invite';
    actions = actions ?? [];
  }

  const actionTaken = String(row.action_taken ?? '').trim().toLowerCase();
  const event = sourceType === 'event' ? maps.eventById.get(sourceId) ?? null : null;
  const eventStartAt = event?.start_at ? new Date(event.start_at) : null;
  const eventHasStarted =
    eventStartAt instanceof Date &&
    !Number.isNaN(eventStartAt.getTime()) &&
    eventStartAt <= new Date();
  const isActive = !row.dismissed_at && actionTaken !== 'complete' && !eventHasStarted;

  return {
    id: row.id,
    sourceType,
    sourceId,
    notificationType: row.notification_type,
    title,
    body,
    context,
    workspaceName: workspace?.name ?? null,
    workspaceColor: workspace?.color ?? null,
    moduleKind,
    focusPayload,
    actions: Array.from(new Set((actions || []).map((action) => String(action).trim()).filter(Boolean))),
    scheduledFor: row.scheduled_for,
    deliveredInAppAt: row.delivered_in_app_at ?? null,
    deliveredDesktopAt: row.delivered_desktop_at ?? null,
    dismissedAt: row.dismissed_at ?? null,
    actionTaken: row.action_taken ?? null,
    status: isActive ? 'active' : 'earlier',
  };
};

const getNotificationCenterItems = async (userId) => {
  const { data, error } = await supabase
    .from('notification_events')
    .select(
      'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata, created_at, updated_at'
    )
    .eq('user_id', userId)
    .not('delivered_in_app_at', 'is', null)
    .order('scheduled_for', { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const maps = await buildNotificationCenterSourceMaps(rows);
  const items = rows.map((row) => mapNotificationCenterRow(row, maps));
  const active = items.filter((item) => item.status === 'active');
  const earlier = items.filter((item) => item.status !== 'active');

  return {
    active,
    earlier,
    counts: {
      active: active.length,
      earlier: earlier.length,
      total: items.length,
    },
  };
};

let notificationSchedulerTimer = null;
let notificationSchedulerInFlight = false;

const processNotificationEventsForUser = async (userId) => {
  const prefsRow = await getOrCreateNotificationPreferences(userId);
  const prefs = normalizeNotificationPreferences(mapNotificationPreferencesRow(prefsRow));
  if (prefs.paused) return [];
  const candidates = await buildDueNotificationCandidates(userId, prefs);
  if (!candidates.length) return [];

  const payload = candidates.map((candidate) =>
    buildNotificationEventPayload({
      userId: candidate.user_id,
      workspaceId: candidate.workspace_id,
      sourceType: candidate.source_type,
      sourceId: candidate.source_id,
      notificationType: candidate.notification_type,
      scheduledFor: candidate.scheduled_for,
      metadata: candidate.metadata,
    })
  );

  const { data: insertedRows, error: insertError } = await supabase
    .from('notification_events')
    .upsert(payload, {
      onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for',
    })
    .select(
      'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata'
    );

  if (insertError) throw insertError;

  return Array.isArray(insertedRows) ? insertedRows : [];
};

const runNotificationScheduler = async () => {
  if (notificationSchedulerInFlight) return;
  notificationSchedulerInFlight = true;

  try {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('user_id')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const userIds = Array.from(new Set((data ?? []).map((row) => row?.user_id).filter(Boolean)));
    for (const userId of userIds) {
      try {
        await processNotificationEventsForUser(userId);
      } catch (userError) {
        console.error('[notifications] Scheduler user failed:', userId, userError?.message ?? userError);
      }
    }
  } catch (error) {
    console.error('[notifications] Scheduler failed:', error?.message ?? error);
  } finally {
    notificationSchedulerInFlight = false;
  }
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

const getCalendarById = async (calendarId) => {
  const result = await supabase
    .from('calendars')
    .select('id, workspace_id, name, color, is_personal, is_visible, is_default, created_by')
    .eq('id', calendarId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const resolveExtensionWorkspaceId = async (userId, requestedWorkspaceId = null, tokenWorkspaceId = null) => {
  if (requestedWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, requestedWorkspaceId);
    if (!allowed) {
      const error = new Error('Workspace access denied');
      error.statusCode = 403;
      throw error;
    }
    return requestedWorkspaceId;
  }

  if (tokenWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, tokenWorkspaceId);
    if (allowed) {
      return tokenWorkspaceId;
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
  }
  return createdWorkspace.data?.id ?? null;
};

const getWorkspaceSummary = async (workspaceId) => {
  if (!workspaceId) return null;

  const result = await supabase
    .from('workspaces')
    .select('id, name, owner_id, is_personal, created_at, updated_at')
    .eq('id', workspaceId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const getAccessibleWorkspaces = async (userId) => {
  const workspaceIds = Array.from(await getUserWorkspaceIds(userId));
  if (!workspaceIds.length) return [];

  const result = await supabase
    .from('workspaces')
    .select('id, name, owner_id, is_personal, created_at, updated_at')
    .in('id', workspaceIds)
    .order('created_at', { ascending: true });

  if (result.error) throw result.error;
  return result.data ?? [];
};

const getUserWorkspaces = async (userId) => {
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
  const memberRoleByWorkspaceId = new Map(
    (memberResult.data ?? []).map((row) => [row.workspace_id, String(row.role ?? '').toLowerCase()])
  );

  let memberWorkspaces = [];
  if (memberWorkspaceIds.length > 0) {
    const memberWorkspaceResult = await supabase
      .from('workspaces')
      .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
      .in('id', memberWorkspaceIds);

    if (memberWorkspaceResult.error) throw memberWorkspaceResult.error;
    memberWorkspaces = memberWorkspaceResult.data ?? [];
  }

  const dedupedById = new Map();
  for (const workspace of [...(ownedResult.data ?? []), ...memberWorkspaces]) {
    if (!workspace?.id) continue;
    const role =
      workspace.owner_id === userId
        ? 'owner'
        : memberRoleByWorkspaceId.get(workspace.id) ?? 'member';

    dedupedById.set(workspace.id, {
      ...workspace,
      role,
    });
  }

  return [...dedupedById.values()].sort((a, b) => {
    if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
};

const requireWorkspaceMember = async (userId, workspaceId) => {
  const access = await getWorkspaceAccess(userId, workspaceId);
  if (!access) {
    const error = new Error('Not authorized.');
    error.statusCode = 403;
    throw error;
  }

  return access;
};

const resolveMobileWorkspaceScope = async (userId, workspaceId = 'all') => {
  const normalizedWorkspaceId = normalizeNullableText(workspaceId) || 'all';

  if (normalizedWorkspaceId === 'all') {
    const workspaces = await getUserWorkspaces(userId);
    return {
      workspaceIds: workspaces.map((workspace) => workspace.id).filter(Boolean),
      label: 'All Workspaces',
      workspaceId: 'all',
      workspace: null,
    };
  }

  if (!isUuidLike(normalizedWorkspaceId)) {
    const error = new Error('Workspace not found.');
    error.statusCode = 404;
    throw error;
  }

  const workspace = await getWorkspaceSummary(normalizedWorkspaceId);
  if (!workspace) {
    const error = new Error('Workspace not found.');
    error.statusCode = 404;
    throw error;
  }

  await requireWorkspaceMember(userId, normalizedWorkspaceId);

  return {
    workspaceIds: [normalizedWorkspaceId],
    label: workspace.name ?? 'Workspace',
    workspaceId: normalizedWorkspaceId,
    workspace,
  };
};

const MOBILE_TODAY_TASK_SELECT_COLUMNS =
  'id, workspace_id, project_id, title, due_date, due_time, status, priority, show_in_today, is_today_focus, completed_at, created_at, updated_at';
const MOBILE_TODAY_PROJECT_SELECT_COLUMNS =
  'id, workspace_id, name, status, completeness, color, start_date, end_date, created_at, updated_at';

// Temporary fallback until mobile user timezone preferences are wired through the backend.
const getLocalDateKey = (dateLike = new Date()) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseMobileDateKey = (value) => {
  const normalized = normalizeNullableText(value);
  if (!normalized) return getLocalDateKey(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const error = new Error('Invalid date.');
    error.statusCode = 400;
    throw error;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('Invalid date.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const getMobileDateWindow = (dateKey) => {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(`${dateKey}T23:59:59.999`);

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

const hasExplicitTimeComponent = (value) => {
  const text = String(value ?? '');
  return /T\d{2}:\d{2}/.test(text);
};

const isTimeBasedDateValue = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getHours() !== 0 ||
    date.getMinutes() !== 0 ||
    date.getSeconds() !== 0 ||
    date.getMilliseconds() !== 0
  );
};

const getTaskPriorityRank = (priority) => {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'highest') return 4;
  if (normalized === 'high') return 3;
  if (normalized === 'medium' || normalized === 'normal') return 2;
  if (normalized === 'low' || normalized === 'lowest') return 1;
  return 0;
};

const loadMobileTodayData = async ({ userId, scope, dateKey }) => {
  const selectedDateKey = parseMobileDateKey(dateKey);
  const currentDateKey = getLocalDateKey(new Date());
  const isCurrentDate = selectedDateKey === currentDateKey;
  const { startIso, endIso } = getMobileDateWindow(selectedDateKey);
  const now = new Date();
  const workspaceIds = Array.isArray(scope.workspaceIds) ? scope.workspaceIds.filter(Boolean) : [];

  if (!workspaceIds.length) {
    return {
      date: selectedDateKey,
      scope: {
        workspaceId: scope.workspaceId,
        label: scope.label,
      },
      upcoming: [],
      today: [],
      captures: {
        count: 0,
        items: [],
      },
    };
  }

  const focusTaskPromise = isCurrentDate
    ? (async () => {
        const result = await supabase
          .from('tasks')
          .select(`${MOBILE_TODAY_TASK_SELECT_COLUMNS}, show_in_today, is_today_focus`)
          .in('workspace_id', workspaceIds)
          .neq('status', 'completed')
          .or('show_in_today.eq.true,is_today_focus.eq.true')
          .order('updated_at', { ascending: false })
          .limit(200);

        if (result.error && isMissingTaskTodayColumnError(result.error)) {
          return { data: [], error: null };
        }

        return result;
      })()
    : Promise.resolve({ data: [] });

  const [workspaceResult, taskResult, focusTaskResult, reminderResult, eventResult, projectResult, captureCountResult, captureItemsResult] =
    await Promise.all([
      supabase.from('workspaces').select('id, name, color').in('id', workspaceIds),
      supabase
        .from('tasks')
        .select(MOBILE_TODAY_TASK_SELECT_COLUMNS)
        .in('workspace_id', workspaceIds)
        .neq('status', 'completed')
        .lte('due_date', selectedDateKey)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(500),
      focusTaskPromise,
      withReminderTable((table) =>
        supabase
          .from(table)
          .select(reminderSelectColumns)
          .in('workspace_id', workspaceIds)
          .or('status.eq.active,status.eq.overdue')
          .is('dismissed_at', null)
          .is('completed_at', null)
          .lte('remind_at', endIso)
          .order('remind_at', { ascending: true })
          .limit(500)
      ),
      supabase
        .from('events')
        .select(
          'id, workspace_id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, project_id, note_id, series_id, series_type, created_at'
        )
        .in('workspace_id', workspaceIds)
        .gte('start_at', startIso)
        .lte('start_at', endIso)
        .neq('status', 'done')
        .order('start_at', { ascending: true })
        .limit(200),
      supabase
        .from('projects')
        .select(MOBILE_TODAY_PROJECT_SELECT_COLUMNS)
        .in('workspace_id', workspaceIds)
        .not('end_date', 'is', null)
        .limit(500),
      supabase
        .from('inbox_items')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds)
        .eq('status', 'unprocessed'),
      supabase
        .from('inbox_items')
        .select(
          'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
        )
        .in('workspace_id', workspaceIds)
        .eq('status', 'unprocessed')
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

  const queryErrors = [
    workspaceResult.error,
    taskResult.error,
    focusTaskResult?.error,
    reminderResult.error,
    eventResult.error,
    projectResult.error,
    captureCountResult.error,
    captureItemsResult.error,
  ].filter(Boolean);
  if (queryErrors.length > 0) throw queryErrors[0];

  const workspaceById = new Map((workspaceResult.data ?? []).map((workspace) => [workspace.id, workspace]));
  const taskRows = Array.isArray(taskResult.data) ? taskResult.data : [];
  const focusRows = isCurrentDate && Array.isArray(focusTaskResult?.data) ? focusTaskResult.data : [];
  const reminderRows = Array.isArray(reminderResult.data) ? reminderResult.data : [];
  const eventRows = Array.isArray(eventResult.data) ? eventResult.data : [];
  const projectRows = Array.isArray(projectResult.data) ? projectResult.data : [];

  const seenKeys = new Set();
  const upcoming = [];
  const today = [];

  const addUpcomingItem = (item, key) => {
    if (!item || !key || seenKeys.has(key)) return;
    seenKeys.add(key);
    upcoming.push(item);
  };

  const addTodayItem = (item, key) => {
    if (!item || !key || seenKeys.has(key)) return;
    seenKeys.add(key);
    today.push(item);
  };

  const focusTaskIds = new Set(focusRows.map((row) => String(row.id)));

  const buildWorkspaceContext = (workspaceId) => ({
    workspaceId,
    workspaceName: workspaceById.get(workspaceId)?.name ?? null,
  });

  const toTaskDueAt = (task) => {
    if (!task?.due_date || !task?.due_time) return null;
    const dueDate = new Date(`${String(task.due_date)}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) return null;
    const dueAt = localDateAtTime(dueDate, task.due_time);
    return dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null;
  };

  const isTaskOverdueForSelectedDate = (task) => {
    if (!task?.due_date) return false;
    const taskDateKey = String(task.due_date);
    if (taskDateKey < selectedDateKey) return true;
    if (!isCurrentDate || taskDateKey !== selectedDateKey) return false;
    const dueAt = toTaskDueAt(task);
    return Boolean(dueAt && dueAt.getTime() <= now.getTime());
  };

  const isTaskTimeBasedUpcoming = (task) => {
    if (!task?.due_date || !task?.due_time) return false;
    const taskDateKey = String(task.due_date);
    if (taskDateKey !== selectedDateKey) return false;
    if (!isCurrentDate) return true;
    const dueAt = toTaskDueAt(task);
    return Boolean(dueAt && dueAt.getTime() > now.getTime());
  };

  const isTaskSelectedDate = (task) => Boolean(task?.due_date && String(task.due_date) === selectedDateKey);

  const buildTaskPayload = (task, overrides = {}) => {
    const dueAt = toTaskDueAt(task);
    const workspaceContext = buildWorkspaceContext(task.workspace_id);
    const hasProject = Boolean(task.project_id);
    const isOverdue = overrides.isOverdue ?? isTaskOverdueForSelectedDate(task);
    const type = overrides.type ?? (hasProject ? 'project_action' : 'task');
    const sourceType = overrides.sourceType ?? (hasProject ? 'project_action' : 'task');
    const meta = overrides.meta ?? (isOverdue ? 'Overdue' : hasProject ? 'Project action' : 'Due today');
    const dueLabel = overrides.dueLabel ?? (isOverdue ? 'Overdue' : 'Today');

    return {
      id: `${sourceType}:${task.id}`,
      type,
      title: task.title ?? 'Untitled task',
      workspaceId: task.workspace_id,
      workspaceName: workspaceContext.workspaceName,
      meta,
      dueLabel,
      status: isOverdue ? 'overdue' : 'active',
      sourceType,
      sourceId: task.id,
      sortAt: dueAt?.toISOString() ?? `${task.due_date ?? selectedDateKey}T00:00:00.000Z`,
      priorityRank: getTaskPriorityRank(task.priority),
    };
  };

  for (const task of taskRows) {
    if (!task?.id || !task.workspace_id) continue;
    const normalizedTaskStatus = String(task.status ?? '').toLowerCase();
    if (
      normalizedTaskStatus === 'completed' ||
      normalizedTaskStatus === 'done' ||
      normalizedTaskStatus.includes('archiv')
    ) {
      continue;
    }
    const taskKey = `task:${task.id}`;
    if (focusTaskIds.has(String(task.id)) && isCurrentDate) {
      const focusItem = buildTaskPayload(task, {
        type: 'focus',
        sourceType: 'task',
        meta: 'Focus',
        dueLabel: 'Today',
      });
      addTodayItem(focusItem, taskKey);
      continue;
    }

    if (isTaskTimeBasedUpcoming(task)) {
      const dueAt = toTaskDueAt(task);
      const upcomingItem = {
        id: `task:${task.id}`,
        type: 'task',
        title: task.title ?? 'Untitled task',
        workspaceId: task.workspace_id,
        workspaceName: workspaceById.get(task.workspace_id)?.name ?? null,
        timeLabel: dueAt ? formatNotificationTime(dueAt) ?? null : null,
        startsAt: dueAt ? dueAt.toISOString() : null,
        endsAt: null,
        status: 'upcoming',
        sourceType: 'task',
        sourceId: task.id,
        sortAt: dueAt?.toISOString() ?? null,
        priorityRank: getTaskPriorityRank(task.priority),
      };
      addUpcomingItem(upcomingItem, taskKey);
      continue;
    }

    if (!isTaskSelectedDate(task) && !isTaskOverdueForSelectedDate(task)) {
      continue;
    }

    const todayItem = buildTaskPayload(task, {
      isOverdue: isTaskOverdueForSelectedDate(task),
      type: task.project_id ? 'project_action' : 'task',
      sourceType: task.project_id ? 'project_action' : 'task',
      meta: task.project_id ? (isTaskOverdueForSelectedDate(task) ? 'Overdue' : 'Project action') : (isTaskOverdueForSelectedDate(task) ? 'Overdue' : 'Due today'),
      dueLabel: isTaskOverdueForSelectedDate(task) ? 'Overdue' : 'Today',
    });
    addTodayItem(todayItem, taskKey);
  }

  for (const reminder of reminderRows) {
    if (!reminder?.id || !reminder.workspace_id) continue;
    const normalizedReminderStatus = String(reminder.status ?? '').toLowerCase();
    if (normalizedReminderStatus === 'dismissed' || normalizedReminderStatus.includes('archiv')) continue;
    if (Boolean(reminder.completed_at)) continue;

    const remindAt = new Date(reminder.remind_at ?? '');
    if (Number.isNaN(remindAt.getTime())) continue;
    const reminderDateKey = getLocalDateKey(remindAt);
    if (!reminderDateKey) continue;
    const hasSpecificTime = isTimeBasedDateValue(remindAt);
    const isOverdue = reminderDateKey < selectedDateKey || (isCurrentDate && reminderDateKey === selectedDateKey && hasSpecificTime && remindAt.getTime() <= now.getTime());
    const isUpcoming = reminderDateKey === selectedDateKey && hasSpecificTime && !isOverdue;
    const reminderKey = `reminder:${reminder.id}`;

    if (isUpcoming) {
      addUpcomingItem(
        {
          id: reminderKey,
          type: 'reminder',
          title: reminder.title ?? 'Untitled reminder',
          workspaceId: reminder.workspace_id,
          workspaceName: workspaceById.get(reminder.workspace_id)?.name ?? null,
          timeLabel: formatNotificationTime(remindAt) ?? null,
          startsAt: remindAt.toISOString(),
          endsAt: null,
          status: 'upcoming',
          sourceType: 'reminder',
          sourceId: reminder.id,
          sortAt: remindAt.toISOString(),
        },
        reminderKey
      );
      continue;
    }

    if (reminderDateKey > selectedDateKey && !isOverdue) {
      continue;
    }

    addTodayItem(
      {
        id: reminderKey,
        type: 'reminder',
        title: reminder.title ?? 'Untitled reminder',
        workspaceId: reminder.workspace_id,
        workspaceName: workspaceById.get(reminder.workspace_id)?.name ?? null,
        meta: isOverdue ? 'Overdue' : 'Due today',
        dueLabel: isOverdue ? 'Overdue' : 'Today',
        status: isOverdue ? 'overdue' : 'active',
        sourceType: 'reminder',
        sourceId: reminder.id,
        sortAt: remindAt.toISOString(),
        priorityRank: 0,
      },
      reminderKey
    );
  }

  for (const event of eventRows) {
    if (!event?.id || !event.workspace_id) continue;
    if (String(event.status ?? '').toLowerCase() === 'done') continue;
    if (Boolean(event.all_day)) continue;

    const startAt = new Date(event.start_at ?? '');
    if (Number.isNaN(startAt.getTime())) continue;
    if (isCurrentDate && startAt.getTime() <= now.getTime()) {
      continue;
    }

    const eventDateKey = getLocalDateKey(startAt);
    if (!eventDateKey || eventDateKey !== selectedDateKey) continue;

    const eventKey = `calendar_event:${event.id}`;
    addUpcomingItem(
      {
        id: eventKey,
        type: 'event',
        title: event.title ?? 'Untitled event',
        workspaceId: event.workspace_id,
        workspaceName: workspaceById.get(event.workspace_id)?.name ?? null,
        timeLabel: formatNotificationTime(startAt) ?? null,
        startsAt: startAt.toISOString(),
        endsAt: event.end_at ?? null,
        status: 'upcoming',
        sourceType: 'calendar_event',
        sourceId: event.id,
        sortAt: startAt.toISOString(),
      },
      eventKey
    );
  }

  for (const project of projectRows) {
    if (!project?.id || !project.workspace_id) continue;
    const normalizedProjectStatus = String(project.status ?? '').toLowerCase();
    if (isCompletedProjectStatus(project.status) || normalizedProjectStatus.includes('archiv')) {
      continue;
    }
    const projectEndDateText = normalizeNullableText(project.end_date);
    if (!projectEndDateText) continue;

    const projectDate = hasExplicitTimeComponent(projectEndDateText)
      ? getLocalDateKey(new Date(projectEndDateText))
      : normalizeNullableDate(projectEndDateText, 'end date');
    if (!projectDate) continue;

    const projectDateKey = String(projectDate);
    if (projectDateKey > selectedDateKey) continue;

    const projectEndAt = hasExplicitTimeComponent(projectEndDateText)
      ? new Date(projectEndDateText)
      : new Date(`${projectDateKey}T00:00:00`);
    if (Number.isNaN(projectEndAt.getTime())) continue;

    const isProjectOverdue = projectDateKey < selectedDateKey;
    const isProjectTimeBased = hasExplicitTimeComponent(projectEndDateText);
    const projectKey = `project:${project.id}`;

    if (isProjectTimeBased && projectDateKey === selectedDateKey) {
      addUpcomingItem(
        {
          id: `deadline:${project.id}`,
          type: 'deadline',
          title: project.name ?? 'Untitled project',
          workspaceId: project.workspace_id,
          workspaceName: workspaceById.get(project.workspace_id)?.name ?? null,
          timeLabel: formatNotificationTime(projectEndAt) ?? null,
          startsAt: projectEndAt.toISOString(),
          endsAt: null,
          status: 'upcoming',
          sourceType: 'project',
          sourceId: project.id,
          sortAt: projectEndAt.toISOString(),
        },
        projectKey
      );
      continue;
    }

    addTodayItem(
      {
        id: `project_action:${project.id}`,
        type: 'project_action',
        title: project.name ?? 'Untitled project',
        workspaceId: project.workspace_id,
        workspaceName: workspaceById.get(project.workspace_id)?.name ?? null,
        meta: isProjectOverdue ? 'Overdue' : 'Project action',
        dueLabel: isProjectOverdue ? 'Overdue' : 'Today',
        status: isProjectOverdue ? 'overdue' : 'active',
        sourceType: 'project_action',
        sourceId: project.id,
        sortAt: projectEndAt.toISOString(),
        priorityRank: 0,
      },
      projectKey
    );
  }

  upcoming.sort((left, right) => {
    const leftTime = new Date(left.sortAt ?? 0).getTime();
    const rightTime = new Date(right.sortAt ?? 0).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftPriority = Number(right.priorityRank ?? 0) - Number(left.priorityRank ?? 0);
    if (leftPriority !== 0) return leftPriority;

    return String(left.title ?? '').localeCompare(String(right.title ?? ''));
  });

  today.sort((left, right) => {
    const bucket = (item) => {
      if (item.type === 'focus') return 0;
      if (item.status === 'overdue') return 1;
      if (item.type === 'project_action') return 3;
      return 2;
    };

    const bucketDiff = bucket(left) - bucket(right);
    if (bucketDiff !== 0) return bucketDiff;

    const priorityDiff = Number(right.priorityRank ?? 0) - Number(left.priorityRank ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    const leftTime = new Date(left.sortAt ?? 0).getTime();
    const rightTime = new Date(right.sortAt ?? 0).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;

    return String(left.title ?? '').localeCompare(String(right.title ?? ''));
  });

  const captureCount = Number(captureCountResult.count ?? 0);
  const captures = (captureItemsResult.data ?? []).map((item) => ({
    id: item.id,
    title: item.title ?? 'Untitled capture',
    source: item.source ?? 'inbox',
    workspaceId: item.workspace_id,
    workspaceName: workspaceById.get(item.workspace_id)?.name ?? null,
    createdAt: item.created_at ?? null,
  }));

  return {
    date: selectedDateKey,
    scope: {
      workspaceId: scope.workspaceId,
      label: scope.label,
    },
    upcoming: upcoming.map(({ sortAt, priorityRank, ...item }) => item),
    today: today.map(({ sortAt, priorityRank, ...item }) => item),
    captures: {
      count: captureCount,
      items: captures,
    },
  };
};

const getCalendarScopeWorkspaceIds = async (req) => {
  const scope = String(req.query?.scope ?? '').trim().toLowerCase();
  if (scope === 'all_accessible_workspaces') {
    const workspaces = await getAccessibleWorkspaces(req.authUser.id);
    return workspaces.map((workspace) => workspace.id).filter(Boolean);
  }

  const workspaceId = await resolveWorkspaceIdForRequest(req);
  return workspaceId ? [workspaceId] : [];
};

const getReminderScopeWorkspaceIds = async (req) => {
  const requestedWorkspaceId = normalizeNullableText(req.query?.workspace_id);
  if (requestedWorkspaceId) {
    await requireWorkspaceAccess(req.authUser.id, requestedWorkspaceId, 'member');
    return [requestedWorkspaceId];
  }

  const scope = String(req.query?.scope ?? '').trim().toLowerCase();
  if (scope === 'all_accessible_workspaces') {
    const workspaces = await getAccessibleWorkspaces(req.authUser.id);
    return workspaces.map((workspace) => workspace.id).filter(Boolean);
  }

  const workspaceId = await resolveWorkspaceIdForRequest(req);
  return workspaceId ? [workspaceId] : [];
};

const resolveExtensionWorkspaceForRequest = async (req) => {
  const requestedWorkspaceId = normalizeNullableText(req.body?.workspace_id);
  return resolveExtensionWorkspaceId(
    req.authUser.id,
    requestedWorkspaceId || null,
    req.extensionToken?.workspace_id ?? null
  );
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
  process.env.SLACK_STATE_SECRET?.trim() ||
  process.env.SLACK_SIGNING_SECRET?.trim() ||
  'ledger-slack-dev-state';

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
    source_label: row.source ? titleCaseLabel(row.source) : 'Inbox',
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

const loadBrowserCapturePayload = (req) => {
  const captureType = String(req.body?.capture_type ?? '').trim().toLowerCase();
  const title = clampText(req.body?.title, 300);
  const body = clampMultilineText(req.body?.body, 20_000);
  const sourceUrl = clampText(req.body?.source_url, 2_000) || null;
  const projectId = normalizeNullableText(req.body?.project_id);
  const rawPayload = req.body?.raw_payload ?? {};

  return {
    captureType,
    title: title || '',
    body,
    sourceUrl,
    projectId,
    rawPayload,
  };
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
    return respondWithError(res, error);
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
      return { ...result, table };
    }

    lastError = result.error;
    if (!isMissingTableError(result.error)) {
      return result;
    }
  }

  return { data: null, error: lastError ?? new Error('Reminder table lookup failed') };
};

const normalizeReminderLinkedType = (value) => {
  const normalized = normalizeNullableText(value);
  if (normalized === null) return null;

  const linkedType = normalized.toLowerCase();
  if (linkedType === 'null') return null;
  if (!reminderLinkedTypes.includes(linkedType)) {
    const error = new Error('Invalid linked_type');
    error.statusCode = 400;
    throw error;
  }

  return linkedType;
};

const normalizeReminderStatus = (value, fallback = 'active') => {
  const normalized = normalizeNullableText(value);
  if (normalized === null) return fallback;

  const status = normalized.toLowerCase();
  if (!reminderStatusValues.includes(status)) {
    const error = new Error('Invalid status');
    error.statusCode = 400;
    throw error;
  }

  return status;
};

const isReminderOverdue = (row, nowMs = Date.now()) => {
  const remindAtMs = new Date(row?.remind_at ?? 0).getTime();
  if (!Number.isFinite(remindAtMs)) return false;

  const status = String(row?.status ?? 'active').toLowerCase();
  return status === 'overdue' || (status === 'active' && remindAtMs < nowMs);
};

const mapReminderRow = (row, nowMs = Date.now()) => {
  if (!row) return row;

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id ?? row.created_by ?? null,
    title: row.title,
    body: row.body ?? row.notes ?? null,
    remind_at: row.remind_at ?? null,
    status: String(row.status ?? 'active').toLowerCase(),
    is_overdue: isReminderOverdue(row, nowMs),
    linked_type: row.linked_type ?? null,
    linked_id: row.linked_id ?? null,
    calendar_id: row.calendar_id ?? null,
    project_id: row.project_id ?? null,
    note_id: row.note_id ?? null,
    notes: row.notes ?? null,
    color: row.color ?? null,
    is_done: Boolean(row.is_done ?? false),
    created_by: row.created_by ?? null,
    series_id: row.series_id ?? null,
    series_type: row.series_type ?? null,
    recurrence_rule: row.recurrence_rule ?? null,
    completed_at: row.completed_at ?? null,
    dismissed_at: row.dismissed_at ?? null,
    snoozed_until: row.snoozed_until ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
};

const getReminderLegacyFields = ({
  userId,
  linkedType,
  linkedId,
  body,
  status,
  calendarId,
  recurrenceRule = null,
  seriesId = null,
  seriesType = null,
}) => ({
  created_by: userId,
  notes: body,
  is_done: status === 'completed' || status === 'dismissed',
  calendar_id: calendarId ?? null,
  project_id: linkedType === 'project' ? linkedId : null,
  note_id: linkedType === 'note' ? linkedId : null,
  recurrence_rule: recurrenceRule,
  series_id: seriesId,
  series_type: seriesType,
});

const validateReminderLink = async ({ workspaceId, linkedType, linkedId }) => {
  if (!linkedType || linkedType === 'none') return;

  if (!linkedId) {
    const error = new Error('linked_id is required when linked_type is set');
    error.statusCode = 400;
    throw error;
  }

  const tableMap = {
    task: 'tasks',
    event: 'events',
    note: 'notes',
    project: 'projects',
    inbox: 'inbox_items',
  };

  const label = reminderLinkedLabels[linkedType] ?? 'Linked item';
  const table = tableMap[linkedType];
  if (!table) return;

  const allowed = await ensureWorkspaceResource(table, linkedId, workspaceId);
  if (!allowed) {
    const error = new Error(`${label} not found`);
    error.statusCode = 404;
    throw error;
  }
};

const parseReminderTimestamp = (value, fieldName) => {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`Invalid ${fieldName}`);
    error.statusCode = 400;
    throw error;
  }

  return date.toISOString();
};

const resolveReminderWorkspaceIdForRequest = async (req) => {
  const requestedWorkspaceId = normalizeNullableText(req.query?.workspace_id);
  if (requestedWorkspaceId) {
    await requireWorkspaceAccess(req.authUser.id, requestedWorkspaceId, 'member');
    return requestedWorkspaceId;
  }

  return resolveWorkspaceIdForRequest(req);
};

const getReminderById = async (reminderId) => {
  const result = await supabase
    .from('reminders')
    .select(reminderDashboardSelectColumns)
    .eq('id', reminderId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
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

const loadActiveExtensionTokenForSettings = async (userId, workspaceId) => {
  const result = await supabase
    .from('extension_tokens')
    .select('id, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const createExtensionTokenForSettings = async (userId, workspaceId) => {
  const rawToken = createRawExtensionToken();
  const insertResult = await supabase
    .from('extension_tokens')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      name: 'Browser Extension',
      token_hash: hashExtensionToken(rawToken),
    })
    .select('id, created_at, last_used_at, revoked_at')
    .single();

  if (insertResult.error) throw insertResult.error;

  return {
    token: rawToken,
    status: mapExtensionTokenStatus(insertResult.data),
  };
};

const revokeActiveExtensionTokensForSettings = async (userId, workspaceId) => {
  const revokeResult = await supabase
    .from('extension_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null);

  if (revokeResult.error) throw revokeResult.error;
};

app.get('/api/extension/token/status', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const tokenRow = await loadActiveExtensionTokenForSettings(req.authUser.id, workspaceId);
    res.json(mapExtensionTokenStatus(tokenRow));
  } catch (error) {
    if (isMissingRelationError(error, 'extension_tokens')) {
      return res.json({ exists: false, created_at: null, last_used_at: null, revoked_at: null });
    }
    return respondWithError(res, error);
  }
});

app.post('/api/extension/token', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

    const existing = await loadActiveExtensionTokenForSettings(req.authUser.id, workspaceId);
    if (existing?.id) {
      return res.status(409).json({ error: 'An active browser extension token already exists.' });
    }

    const payload = await createExtensionTokenForSettings(req.authUser.id, workspaceId);
    res.status(201).json(payload);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post(
  '/api/extension/token/regenerate',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
      await revokeActiveExtensionTokensForSettings(req.authUser.id, workspaceId);
      const payload = await createExtensionTokenForSettings(req.authUser.id, workspaceId);
      res.status(201).json(payload);
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.post('/api/extension/token/revoke', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    await revokeActiveExtensionTokensForSettings(req.authUser.id, workspaceId);
    res.json({ exists: false, created_at: null, last_used_at: null, revoked_at: new Date().toISOString() });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/extension/me', extensionAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const defaultWorkspaceId = await resolveExtensionWorkspaceId(
      req.authUser.id,
      null,
      req.extensionToken?.workspace_id ?? null
    );
    const defaultWorkspace = await getWorkspaceSummary(defaultWorkspaceId);

    res.json({
      ok: true,
      user: {
        id: req.authUser.id,
        email: req.authUser.email ?? null,
        full_name: req.authUser.full_name ?? null,
        avatar_url: req.authUser.avatar_url ?? null,
      },
      default_workspace_id: defaultWorkspaceId,
      default_workspace: defaultWorkspace,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get(
  '/api/extension/workspaces',
  extensionAuthMiddleware,
  rateLimit('read'),
  async (req, res) => {
    try {
      const defaultWorkspaceId = await resolveExtensionWorkspaceId(
        req.authUser.id,
        null,
        req.extensionToken?.workspace_id ?? null
      );
      const workspaces = await getAccessibleWorkspaces(req.authUser.id);

      res.json({
        ok: true,
        default_workspace_id: defaultWorkspaceId,
        workspaces,
      });
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.post('/api/inbox/browser', extensionAuthMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const { captureType, title, body, sourceUrl, projectId, rawPayload } =
      loadBrowserCapturePayload(req);

    if (!['link', 'selection', 'manual'].includes(captureType)) {
      return res.status(400).json({ error: 'Invalid capture type' });
    }

    if (
      rawPayload !== null &&
      (typeof rawPayload !== 'object' || Array.isArray(rawPayload))
    ) {
      return res.status(400).json({ error: 'raw_payload must be an object' });
    }

    if (projectId && !isUuidLike(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id' });
    }

    const workspaceId = await resolveExtensionWorkspaceForRequest(req);
    if (!workspaceId) {
      return res.status(400).json({ error: 'No workspace available' });
    }

    if (projectId) {
      const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
      if (!projectAllowed) {
        return res.status(403).json({ error: 'Project does not belong to the selected workspace' });
      }
    }

    const fallbackTitle =
      captureType === 'selection'
        ? 'Selected text'
        : captureType === 'link'
          ? 'Page link'
          : 'Manual note';

    const insertPayload = {
      workspace_id: workspaceId,
      user_id: req.authUser.id,
      source: 'browser',
      source_id: null,
      source_url: sourceUrl,
      title: title || fallbackTitle,
      body,
      raw_payload: rawPayload ?? {},
      suggested_type: 'unknown',
      status: 'unprocessed',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('inbox_items')
      .insert(insertPayload)
      .select(
        'id, workspace_id, user_id, source, source_id, source_url, title, body, raw_payload, suggested_type, status, converted_type, converted_id, created_at, updated_at'
      )
      .single();

    if (error) throw error;

    res.status(201).json({
      ok: true,
      item: mapInboxItemResponse(data),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/slack/install', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    res.redirect(buildSlackAuthorizeUrl({ workspaceId, installedBy: req.authUser.id }));
  } catch (error) {
    return respondWithError(res, error);
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
      console.error('Slack OAuth token exchange failed', tokenPayload?.error ?? 'unknown_error');
      return res.status(400).type('text').send('Slack OAuth failed');
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
    const statusCode = getPublicErrorStatus(error);
    const message = getPublicErrorMessage(error, statusCode);
    res.status(statusCode).type('text').send(message);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

app.delete('/api/inbox/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!allowed) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }

    const { error } = await supabase
      .from('inbox_items')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    return respondWithError(res, error);
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
          noteSelectColumns
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
          'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id, series_id, series_type'
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

app.get('/api/notifications/preferences', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const data = await getOrCreateNotificationPreferences(req.authUser.id);
    res.json(mapNotificationPreferencesRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch(
  '/api/notifications/preferences',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const existing = await getOrCreateNotificationPreferences(req.authUser.id);
      const mergedInput = {
        ...mapNotificationPreferencesRow(existing),
        ...req.body,
      };
      const updatePayload = notificationPreferencesInsertPayload(req.authUser.id, mergedInput);

      const { data, error } = await supabase
        .from('notification_preferences')
        .upsert(updatePayload, { onConflict: 'user_id' })
        .select(notificationPreferencesSelectColumns)
        .single();

      if (error) throw error;
      res.json(mapNotificationPreferencesRow(data));
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.post('/api/notifications/check', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const prefsRow = await getOrCreateNotificationPreferences(req.authUser.id);
    const prefs = normalizeNotificationPreferences(mapNotificationPreferencesRow(prefsRow));
    if (prefs.paused) {
      return res.json([]);
    }
    const candidates = await buildDueNotificationCandidates(req.authUser.id, prefs);

    if (!candidates.length) {
      return res.json([]);
    }

    const payload = candidates.map((candidate) =>
      buildNotificationEventPayload({
        userId: candidate.user_id,
        workspaceId: candidate.workspace_id,
        sourceType: candidate.source_type,
        sourceId: candidate.source_id,
        notificationType: candidate.notification_type,
        scheduledFor: candidate.scheduled_for,
        metadata: candidate.metadata,
      })
    );

    const { data: insertedRows, error: insertError } = await supabase
      .from('notification_events')
      .upsert(payload, {
        onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for',
      })
      .select(
        'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata'
      );

    if (insertError) throw insertError;

    const eventRows = Array.isArray(insertedRows) ? insertedRows : [];
    const eventIds = eventRows.map((row) => row.id).filter(Boolean);

    if (!eventIds.length) {
      return res.json([]);
    }

    const nowIso = new Date().toISOString();
    const { data: workspaceData, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name, color')
      .in(
        'id',
        Array.from(new Set(eventRows.map((row) => row.workspace_id).filter(Boolean)))
      );
    if (workspaceError) throw workspaceError;
    const workspaceById = new Map((workspaceData || []).map((workspace) => [workspace.id, workspace]));

    const candidateByEventKey = new Map(
      candidates.map((candidate) => [
        [
          candidate.source_type,
          candidate.source_id,
          candidate.notification_type,
          candidate.scheduled_for,
        ].join('|'),
        candidate,
      ])
    );

    const { data: claimedRows, error: claimError } = await supabase
      .from('notification_events')
      .update({ delivered_in_app_at: nowIso, updated_at: nowIso })
      .in('id', eventIds)
      .is('delivered_in_app_at', null)
      .is('dismissed_at', null)
      .select(
        'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata'
      );

    if (claimError) throw claimError;

    if (!claimedRows?.length) {
      return res.json([]);
    }

    res.json(
      claimedRows.map((row) => {
        const candidate = candidateByEventKey.get(
          [row.source_type, row.source_id, row.notification_type, row.scheduled_for].join('|')
        );
        const workspace = workspaceById.get(row.workspace_id ?? '') ?? null;
        return mapNotificationEventRow(row, {
          title: candidate?.title ?? null,
          body: candidate?.body ?? null,
          workspaceName: workspace?.name ?? null,
          workspaceColor: workspace?.color ?? null,
          moduleKind: candidate?.moduleKind ?? null,
          focusPayload: candidate?.focusPayload ?? null,
          actions: candidate?.actions ?? [],
        });
      })
    );
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/notifications/:id/action', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const action = String(req.body?.action ?? '').trim().toLowerCase();
    if (!notificationActionValues.has(action)) {
      return res.status(400).json({ error: 'Invalid notification action' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('notification_events')
      .select(
        'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, dismissed_at, metadata'
      )
      .eq('id', req.params.id)
      .eq('user_id', req.authUser.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing?.id) {
      return res.status(404).json({ error: 'Notification event not found' });
    }

    const workspaceIds = Array.from(await getUserWorkspaceIds(req.authUser.id));
    const nowIso = new Date().toISOString();
    let sourceUpdateResult = null;

    if (existing.source_type === 'reminder') {
      const prefsRow = await getOrCreateNotificationPreferences(req.authUser.id);
      const prefs = normalizeNotificationPreferences(mapNotificationPreferencesRow(prefsRow));
      const snoozeUntil = parseReminderTimestamp(
        req.body?.snooze_until ??
          (action === 'snooze'
            ? new Date(Date.now() + prefs.defaultSnoozeMinutes * 60 * 1000).toISOString()
            : null),
        'snooze_until'
      );

      const { data, error, table } = await withReminderTable((table) =>
        supabase
          .from(table)
          .select(reminderSelectColumns)
          .eq('id', existing.source_id)
          .in('workspace_id', workspaceIds)
          .maybeSingle()
      );
      if (error) throw error;

      if (data?.id) {
        const updatePayload = { updated_at: nowIso };
        if (action === 'complete') {
          updatePayload.status = 'completed';
          updatePayload.completed_at = nowIso;
          updatePayload.dismissed_at = null;
          updatePayload.snoozed_until = null;
          updatePayload.remind_at = data.remind_at ?? nowIso;
        } else if (action === 'dismiss') {
          updatePayload.status = 'dismissed';
          updatePayload.dismissed_at = nowIso;
          updatePayload.completed_at = null;
          updatePayload.snoozed_until = null;
        } else if (action === 'snooze' && snoozeUntil) {
          updatePayload.status = 'active';
          updatePayload.dismissed_at = null;
          updatePayload.completed_at = null;
          updatePayload.snoozed_until = snoozeUntil;
          updatePayload.remind_at = snoozeUntil;
        }

        const { data: reminderUpdated, error: reminderUpdateError } = await supabase
          .from(table)
          .update(updatePayload)
          .eq('id', data.id)
          .select(reminderSelectColumns)
          .single();
        if (reminderUpdateError) throw reminderUpdateError;
        sourceUpdateResult = reminderUpdated ?? null;
      }
    } else if (existing.source_type === 'task' && action === 'complete') {
      const { data, error } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', existing.source_id)
        .in('workspace_id', workspaceIds)
        .maybeSingle();
      if (error) throw error;
      if (data?.id) {
        const { data: taskUpdated, error: taskUpdateError } = await supabase
          .from('tasks')
          .update({ status: 'completed', completed_at: nowIso, updated_at: nowIso })
          .eq('id', data.id)
          .select(taskSelectColumns)
          .single();
        if (taskUpdateError) throw taskUpdateError;
        sourceUpdateResult = taskUpdated ?? null;
      }
    } else if (existing.source_type === 'event' && action === 'complete') {
      const { data, error } = await supabase
        .from('events')
        .select('id')
        .eq('id', existing.source_id)
        .in('workspace_id', workspaceIds)
        .maybeSingle();
      if (error) throw error;
      if (data?.id) {
        const { data: eventUpdated, error: eventUpdateError } = await supabase
          .from('events')
          .update({ status: 'done', updated_at: nowIso, completed_at: nowIso })
          .eq('id', data.id)
          .select('id, workspace_id, title, start_at, end_at, calendar_id, color, status, project_id, note_id')
          .single();
        if (eventUpdateError) throw eventUpdateError;
        sourceUpdateResult = eventUpdated ?? null;
      }
    }

    const update = {
      action_taken: action,
      updated_at: nowIso,
    };
    if (action === 'dismiss' || action === 'snooze') {
      update.dismissed_at = nowIso;
    }

    const { data, error } = await supabase
      .from('notification_events')
      .update(update)
      .eq('id', existing.id)
      .eq('user_id', req.authUser.id)
      .select(
        'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, dismissed_at, action_taken, metadata'
      )
      .single();

    if (error) throw error;
    res.json({ ok: true, notification: data, source: sourceUpdateResult });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/notifications/summary', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const data = await getNotificationCenterItems(req.authUser.id);
    res.json({ counts: data.counts });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/notifications', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const data = await getNotificationCenterItems(req.authUser.id);
    res.json(data);
  } catch (error) {
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

// Mobile API
app.get('/api/mobile/session', async (req, res) => {
  try {
    const user = await requireAuth(req);
    const { data, error } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;

    res.json({
      user: {
        id: user.id,
        email: user.email ?? null,
        name:
          normalizeNullableText(data?.full_name) ??
          normalizeNullableText(user.user_metadata?.full_name) ??
          normalizeNullableText(user.user_metadata?.name) ??
          null,
      },
    });
  } catch (error) {
    return respondWithMobileError(res, error);
  }
});

app.get('/api/mobile/workspaces', async (req, res) => {
  try {
    const user = await requireAuth(req);
    const [workspaces, activeWorkspaceId] = await Promise.all([
      getUserWorkspaces(user.id),
      getUserActiveWorkspaceId(user.id),
    ]);

    const accessibleWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const defaultWorkspaceId =
      activeWorkspaceId && accessibleWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null;

    res.json({
      defaultWorkspaceId,
      scopeOptions: [
        {
          id: 'all',
          name: 'All Workspaces',
          type: 'scope',
        },
        ...workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          type: workspace.is_personal || workspace.role === 'owner' ? 'personal' : 'workspace',
          role: workspace.role,
          isDefault: workspace.id === defaultWorkspaceId,
        })),
      ],
    });
  } catch (error) {
    return respondWithMobileError(res, error);
  }
});

app.get('/api/mobile/today', async (req, res) => {
  try {
    const user = await requireAuth(req);
    const requestedWorkspaceId = normalizeNullableText(req.query?.workspace_id) || 'all';
    const scope = await resolveMobileWorkspaceScope(user.id, requestedWorkspaceId);
    const payload = await loadMobileTodayData({
      userId: user.id,
      scope,
      dateKey: req.query?.date,
    });

    res.json(payload);
  } catch (error) {
    return respondWithMobileError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      try {
        // Dismiss any outstanding notifications for the removed user scoped to this workspace
        const nowIso = new Date().toISOString();
        await supabase
          .from('notification_events')
          .update({ dismissed_at: nowIso, updated_at: nowIso })
          .eq('user_id', targetUserId)
          .eq('workspace_id', workspaceId)
          .is('dismissed_at', null);
      } catch (err) {
        console.error('Failed to dismiss notifications for removed workspace member', err?.message ?? err);
      }
      res.json({ success: true });
    } catch (error) {
      return respondWithError(res, error);
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
        .select('id, email, role, expires_at, accepted_at, accepted_by, created_by, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (invitationsResult.error) throw invitationsResult.error;

      res.json({
        current_user_role: access.role,
        invitations: (invitationsResult.data ?? []).map((invite) => mapWorkspaceInvite(invite)),
      });
    } catch (error) {
      return respondWithError(res, error);
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

      const inviteBaseUrl = getInviteBaseUrl();
      if (!inviteBaseUrl) {
        return res.status(400).json({
          error:
            'Invite base URL is required. Set INVITE_BASE_URL or FRONTEND_URL on the backend.',
        });
      }
      const inviteUrl = `${inviteBaseUrl}/invite/${encodeURIComponent(token)}`;

      res.json({
        invitation: mapWorkspaceInvite(insertResult.data, new Date().toISOString(), false),
        invite_url: inviteUrl,
        invite_token: token,
        current_user_role: access.role,
      });
    } catch (error) {
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      .select(
        'id, workspace_id, email, role, expires_at, accepted_at, accepted_by, created_at, created_by'
      )
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

    const inviterResult = invite.created_by
      ? await supabase
          .from('users')
          .select('id, email, full_name')
          .eq('id', invite.created_by)
          .maybeSingle()
      : { data: null, error: null };

    if (inviterResult.error) throw inviterResult.error;

    const mapped = mapWorkspaceInvite(invite, new Date().toISOString(), false);
    if (mapped.status === 'expired') {
      return res.status(400).json({ error: 'Invitation has expired', status: 'expired' });
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
        invited_by: inviterResult.data
          ? {
              id: inviterResult.data.id,
              email: inviterResult.data.email ?? null,
              full_name: inviterResult.data.full_name ?? null,
            }
          : null,
      },
    });
  } catch (error) {
    return respondWithError(res, error);
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

    try {
      const { data: workspaceRow, error: workspaceLookupError } = await supabase
        .from('workspaces')
        .select('id, name')
        .eq('id', invitation.workspace_id)
        .maybeSingle();
      if (workspaceLookupError) throw workspaceLookupError;

      // Create in-app notification events for existing workspace members
      const { data: memberRows } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', invitation.workspace_id)
        .neq('user_id', req.authUser.id);

      const notificationPayloads = (memberRows || [])
        .map((r) =>
          buildNotificationEventPayload({
            userId: r.user_id,
            workspaceId: invitation.workspace_id,
            sourceType: 'workspace_invite',
            sourceId: invitation.id,
            notificationType: 'invite.accepted',
            scheduledFor: nowIso,
            metadata: {
              title: 'Invite accepted',
              body: `${req.authUser.full_name ?? req.authUser.email ?? 'Someone'} joined ${
                workspaceRow?.name ?? 'the workspace'
              }`,
              context: 'Workspace invite',
              moduleKind: 'settings',
              focusPayload: { kind: 'settings', focusContext: 'invites' },
              actions: ['open', 'dismiss'],
              joined_user_id: req.authUser.id,
              joined_email: req.authUser.email ?? null,
              joined_full_name: req.authUser.full_name ?? null,
              workspace_name: workspaceRow?.name ?? null,
            },
            delivered_in_app_at: nowIso,
          })
        )
        .filter(Boolean);

      if (notificationPayloads.length) {
        // Upsert to avoid duplicates if called twice
        await supabase.from('notification_events').upsert(notificationPayloads, {
          onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for',
        });
      }
    } catch (err) {
      // Non-fatal: log and continue; invite acceptance should not fail due to notification issues
      console.error('Failed to create invite-accepted notifications', err?.message ?? err);
    }

    res.json({
      success: true,
      workspace_id: invitation.workspace_id,
    });
  } catch (error) {
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
      created_by: null,
      created_by_name: null,
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
        .select(reminderDashboardSelectColumns)
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
      created_by: r.created_by ?? null,
      created_by_name: null,
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
      created_by: null,
      created_by_name: null,
    }));

    const completedReminderResult = await withReminderTable((table) =>
      supabase
        .from(table)
        .select(reminderDashboardSelectColumns)
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
      created_by: r.created_by ?? null,
      created_by_name: null,
    }));

    res.json({ active: mapped, reminders, completed: completedMapped, completed_reminders: completedReminders });
  } catch (error) {
    return respondWithError(res, error);
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
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

app.get('/api/calendars', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getCalendarScopeWorkspaceIds(req);
    if (!workspaceIds.length) {
      return res.json([]);
    }

    const { data, error } = await supabase
      .from('calendars')
      .select('id, name, color, workspace_id, is_personal, is_visible, created_by')
      .in('workspace_id', workspaceIds)
      .order('is_personal', { ascending: false })
      .order('workspace_id', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
  }
});

app.get('/api/events', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getCalendarScopeWorkspaceIds(req);
    if (!workspaceIds.length) {
      return res.json([]);
    }
    let query = supabase
      .from('events')
      .select(
        'id, title, start_at, end_at, all_day, calendar_id, color, status, recurrence_rule, notes, project_id, note_id, series_id, series_type, created_at'
      )
      .in('workspace_id', workspaceIds);

    if (req.query?.startDate) {
      query = query.gte('start_at', String(req.query.startDate));
    }
    if (req.query?.endDate) {
      query = query.lte('start_at', String(req.query.endDate));
    }

    const { data, error } = await query.order('start_at', { ascending: true }).limit(500);
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const workspaceRowIds = Array.from(new Set(rows.map((event) => event.workspace_id).filter(Boolean)));
    const { data: workspaceData, error: workspaceError } = workspaceRowIds.length
      ? await supabase.from('workspaces').select('id, name, color').in('id', workspaceRowIds)
      : { data: [] };
    if (workspaceError) throw workspaceError;
    const workspaceById = new Map((workspaceData || []).map((workspace) => [workspace.id, workspace]));
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
          ? {
              ...event,
              status: 'done',
              workspace_name: workspaceById.get(event.workspace_id)?.name ?? null,
              workspace_color: workspaceById.get(event.workspace_id)?.color ?? null,
            }
          : {
              ...event,
              workspace_name: workspaceById.get(event.workspace_id)?.name ?? null,
              workspace_color: workspaceById.get(event.workspace_id)?.color ?? null,
            }
      )
    );
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/events/upcoming', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getCalendarScopeWorkspaceIds(req);
    if (!workspaceIds.length) {
      return res.json([]);
    }
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 30);

    const { data, error } = await supabase
      .from('events')
      .select(
        'id, workspace_id, title, start_at, end_at, all_day, calendar_id, color, status, visibility, recurrence_rule, series_id, series_type'
      )
      .in('workspace_id', workspaceIds)
      .gte('start_at', now.toISOString())
      .lte('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(20);

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const workspaceIdsForRows = Array.from(new Set(rows.map((event) => event.workspace_id).filter(Boolean)));
    const { data: workspaceData, error: workspaceError } = workspaceIdsForRows.length
      ? await supabase.from('workspaces').select('id, name, color').in('id', workspaceIdsForRows)
      : { data: [] };
    if (workspaceError) throw workspaceError;
    const workspaceById = new Map((workspaceData || []).map((workspace) => [workspace.id, workspace]));
    const filtered = rows.filter((event) => {
      const isDone = String(event.status ?? '') === 'done';
      if (isDone) return false;

      const endAt = new Date(event.end_at ?? event.start_at ?? 0).getTime();
      return Number.isFinite(endAt) && endAt > now.getTime();
    });

    res.json(
      filtered.map((event) => ({
        ...event,
        workspace_name: workspaceById.get(event.workspace_id)?.name ?? null,
        workspace_color: workspaceById.get(event.workspace_id)?.color ?? null,
      }))
    );
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post(
  '/api/events',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('events'),
  async (req, res) => {
    try {
      let workspaceId = req.workspaceId ?? (await resolveWorkspaceIdForRequest(req));
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        return res.status(400).json({ error: 'Event title required' });
      }

      const requestedCalendarId = normalizeNullableText(req.body?.calendar_id);
      let calendarId = null;
      if (requestedCalendarId) {
        if (!isUuidLike(requestedCalendarId)) {
          return res.status(400).json({ error: 'Invalid calendar_id' });
        }
        const calendar = await getCalendarById(requestedCalendarId);
        if (!calendar) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
        await requireWorkspaceAccess(req.authUser.id, calendar.workspace_id, 'member');
        workspaceId = calendar.workspace_id;
        calendarId = calendar.id;
      } else {
        calendarId = await getCalendarId(workspaceId, req.authUser.id);
      }

      const projectId = normalizeNullableText(req.body?.project_id);
      if (projectId) {
        if (!isUuidLike(projectId)) {
          return res.status(400).json({ error: 'Invalid project_id' });
        }
        const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }

      const noteId = normalizeNullableText(req.body?.note_id);
      if (noteId) {
        if (!isUuidLike(noteId)) {
          return res.status(400).json({ error: 'Invalid note_id' });
        }
        const noteAllowed = await ensureWorkspaceResource('notes', noteId, workspaceId);
        if (!noteAllowed) {
          return res.status(404).json({ error: 'Note not found' });
        }
      }

      const startAt = String(req.body?.start_at ?? '');
      const parsedStartAt = startAt ? new Date(startAt) : null;
      const endAt = req.body?.end_at
        ? String(req.body.end_at)
        : parsedStartAt
        ? new Date(parsedStartAt.getTime() + 60 * 60 * 1000).toISOString()
        : null;
      const recurrenceRuleRaw = normalizeNullableText(req.body?.recurrence_rule);
      const recurrenceRule = recurrenceRuleRaw ? recurrenceRuleRaw.toLowerCase() : null;
      const specificDates = normalizeDateKeyList(req.body?.specific_dates);
      const isSpecificDates = recurrenceRule === SPECIFIC_DATES_SERIES_TYPE || specificDates.length > 0;
      if (isSpecificDates && specificDates.length === 0) {
        return res.status(400).json({ error: 'specific_dates is required for specific date events' });
      }
      const seriesId = isSpecificDates ? crypto.randomUUID() : null;
      const basePayload = {
        workspace_id: workspaceId,
        calendar_id: calendarId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title,
        color: req.body?.color || null,
        status: req.body?.status || 'planned',
        visibility: normalizeEventVisibility(req.body?.visibility),
        recurrence_rule: isSpecificDates ? null : recurrenceRule,
        notes: req.body?.notes || null,
        location: req.body?.location || null,
        all_day: Boolean(req.body?.all_day ?? false),
        project_id: projectId || null,
        linked_project_id: projectId || null,
        note_id: noteId || null,
        series_id: seriesId,
        series_type: isSpecificDates ? SPECIFIC_DATES_SERIES_TYPE : null,
      };

      if (isSpecificDates) {
        const specificDatePayloads = buildSpecificDateSeriesPayload({
          baseStartAt: req.body?.start_at,
          baseEndAt: endAt,
          dateKeys: specificDates,
          sharedFields: {
            ...basePayload,
            recurrence_rule: null,
            series_id: seriesId,
            series_type: SPECIFIC_DATES_SERIES_TYPE,
          },
          seriesType: SPECIFIC_DATES_SERIES_TYPE,
          recurrenceRule: null,
        });

        const { data, error } = await supabase
          .from('events')
          .insert(specificDatePayloads)
          .select(
            'id, title, start_at, end_at, all_day, calendar_id, color, status, visibility, recurrence_rule, notes, project_id, note_id, series_id, series_type'
          );

        if (error) throw error;
        res.json({
          created: Array.isArray(data) ? data : [],
          series_id: seriesId,
          series_type: SPECIFIC_DATES_SERIES_TYPE,
        });
        return;
      }

      const { data, error } = await supabase
        .from('events')
        .insert({
          ...basePayload,
          start_at: req.body?.start_at,
          end_at: endAt,
        })
        .select(
          'id, title, start_at, end_at, all_day, calendar_id, color, status, visibility, recurrence_rule, notes, project_id, note_id, series_id, series_type'
        )
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.patch('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const { data: existingEvent, error: existingError } = await supabase
      .from('events')
      .select('id, workspace_id, start_at, end_at, calendar_id, project_id, note_id')
      .eq('id', req.params.id)
      .single();

    if (existingError) throw existingError;
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const eventWorkspaceId = existingEvent.workspace_id;
    await requireWorkspaceAccess(req.authUser.id, eventWorkspaceId, 'member');

    const existingEnd = existingEvent?.end_at ? new Date(existingEvent.end_at) : null;
    const isPastEvent = existingEnd ? existingEnd.getTime() < Date.now() : false;
    if (isPastEvent) {
      return res.status(409).json({ error: 'Past events cannot be edited' });
    }

    const hasCalendarId = req.body?.calendar_id !== undefined;
    const nextCalendarId = hasCalendarId ? normalizeNullableText(req.body.calendar_id) : null;
    if (hasCalendarId && nextCalendarId && !isUuidLike(nextCalendarId)) {
      return res.status(400).json({ error: 'Invalid calendar_id' });
    }

    let targetWorkspaceId = eventWorkspaceId;
    let resolvedCalendarId = hasCalendarId ? nextCalendarId : existingEvent.calendar_id ?? null;
    if (hasCalendarId && nextCalendarId) {
      const calendar = await getCalendarById(nextCalendarId);
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      await requireWorkspaceAccess(req.authUser.id, calendar.workspace_id, 'member');
      targetWorkspaceId = calendar.workspace_id;
      resolvedCalendarId = calendar.id;
    }

    const hasProjectId = req.body?.project_id !== undefined;
    const nextProjectId = hasProjectId ? normalizeNullableText(req.body.project_id) : null;
    if (nextProjectId && !isUuidLike(nextProjectId)) {
      return res.status(400).json({ error: 'Invalid project_id' });
    }
    const hasNoteId = req.body?.note_id !== undefined;
    const nextNoteId = hasNoteId ? normalizeNullableText(req.body.note_id) : null;
    if (nextNoteId && !isUuidLike(nextNoteId)) {
      return res.status(400).json({ error: 'Invalid note_id' });
    }

    const effectiveProjectId = hasProjectId ? nextProjectId : existingEvent.project_id ?? null;
    const effectiveNoteId = hasNoteId ? nextNoteId : existingEvent.note_id ?? null;
    if (effectiveProjectId) {
      const projectAllowed = await ensureWorkspaceResource(
        'projects',
        effectiveProjectId,
        targetWorkspaceId
      );
      if (!projectAllowed) {
        return res.status(404).json({ error: 'Project not found' });
      }
    }
    if (effectiveNoteId) {
      const noteAllowed = await ensureWorkspaceResource('notes', effectiveNoteId, targetWorkspaceId);
      if (!noteAllowed) {
        return res.status(404).json({ error: 'Note not found' });
      }
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
    if (hasCalendarId) {
      update.calendar_id = resolvedCalendarId;
    }
    if (req.body?.visibility !== undefined) {
      update.visibility = normalizeEventVisibility(req.body.visibility);
    }
    if (req.body?.project_id !== undefined) {
      update.project_id = nextProjectId;
      update.linked_project_id = nextProjectId;
    }
    if (req.body?.note_id !== undefined) {
      update.note_id = nextNoteId;
    }
    if (targetWorkspaceId !== eventWorkspaceId) {
      update.workspace_id = targetWorkspaceId;
    }
    update.updated_by = req.authUser.id;

    const { data, error } = await supabase
      .from('events')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', eventWorkspaceId)
      .select(
        'id, title, start_at, end_at, all_day, calendar_id, color, status, visibility, recurrence_rule, notes, project_id, note_id, series_id, series_type'
      )
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const { data: existingEvent, error: existingError } = await supabase
      .from('events')
      .select('id, workspace_id')
      .eq('id', req.params.id)
      .single();

    if (existingError) throw existingError;
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const workspaceId = existingEvent.workspace_id;
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
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
      return respondWithError(res, error);
    }
  }
);

const loadRemindersForWorkspaces = async ({
  workspaceIds,
  statusFilter = 'default',
  from = null,
  to = null,
  linkedType = null,
  linkedId = null,
  limit = 500,
}) => {
  const normalizedWorkspaceIds = Array.isArray(workspaceIds)
    ? workspaceIds.filter(Boolean)
    : workspaceIds
      ? [workspaceIds]
      : [];

  if (!normalizedWorkspaceIds.length) {
    return [];
  }

  let query = supabase
    .from('reminders')
    .select(reminderSelectColumns)
    .in('workspace_id', normalizedWorkspaceIds);

  if (statusFilter === 'active') {
    query = query.eq('status', 'active');
  } else if (statusFilter === 'completed' || statusFilter === 'dismissed') {
    query = query.eq('status', statusFilter);
  } else if (statusFilter === 'overdue') {
    query = query.in('status', ['active', 'overdue']);
  } else if (statusFilter !== 'all' && statusFilter !== 'default') {
    query = query.in('status', ['active', 'overdue']);
  } else if (statusFilter === 'default') {
    query = query.in('status', ['active', 'overdue']);
  }

  if (from) query = query.gte('remind_at', from);
  if (to) query = query.lte('remind_at', to);
  if (linkedType) query = query.eq('linked_type', linkedType);
  if (linkedId) query = query.eq('linked_id', linkedId);
  if (limit) query = query.limit(limit);

  const { data, error } = await query.order('remind_at', { ascending: true });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const workspaceIdsForRows = Array.from(new Set(rows.map((row) => row.workspace_id).filter(Boolean)));
  const calendarIdsForRows = Array.from(new Set(rows.map((row) => row.calendar_id).filter(Boolean)));
  const workspaceResult = workspaceIdsForRows.length
    ? await supabase.from('workspaces').select('id, name, color').in('id', workspaceIdsForRows)
    : { data: [] };
  const calendarResult = calendarIdsForRows.length
    ? await supabase.from('calendars').select('id, name, color').in('id', calendarIdsForRows)
    : { data: [] };
  if (workspaceResult.error) throw workspaceResult.error;
  if (calendarResult.error) throw calendarResult.error;
  const workspaceById = new Map((workspaceResult.data || []).map((workspace) => [workspace.id, workspace]));
  const calendarById = new Map((calendarResult.data || []).map((calendar) => [calendar.id, calendar]));
  const mapped = rows.map((row) => {
    const base = mapReminderRow(row);
    return {
      ...base,
      workspace_name: workspaceById.get(row.workspace_id)?.name ?? null,
      workspace_color: workspaceById.get(row.workspace_id)?.color ?? null,
      calendar_name: row.calendar_id ? calendarById.get(row.calendar_id)?.name ?? null : null,
      calendar_color: row.calendar_id ? calendarById.get(row.calendar_id)?.color ?? null : null,
    };
  });
  if (statusFilter === 'overdue') {
    return mapped.filter((row) => row.is_overdue);
  }
  return mapped;
};

const loadRemindersForWorkspace = async (options) =>
  loadRemindersForWorkspaces({ ...options, workspaceIds: options.workspaceId });

app.get('/api/reminders', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getReminderScopeWorkspaceIds(req);
    const statusFilter = normalizeNullableText(req.query?.status)?.toLowerCase() ?? 'default';
    if (!['active', 'completed', 'dismissed', 'overdue', 'all', 'default'].includes(statusFilter)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const from = req.query?.from ? parseReminderTimestamp(req.query.from, 'from') : null;
    const to = req.query?.to ? parseReminderTimestamp(req.query.to, 'to') : null;
    const linkedType =
      req.query?.linked_type !== undefined ? normalizeReminderLinkedType(req.query.linked_type) : null;
    const linkedId = normalizeNullableText(req.query?.linked_id);
    if (linkedId && !isUuidLike(linkedId)) {
      return res.status(400).json({ error: 'Invalid linked_id' });
    }

    const reminders = await loadRemindersForWorkspaces({
      workspaceIds,
      statusFilter,
      from,
      to,
      linkedType,
      linkedId,
    });

    res.json(reminders);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/reminders/due', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getReminderScopeWorkspaceIds(req);
    const before = req.query?.before ? parseReminderTimestamp(req.query.before, 'before') : new Date().toISOString();
    const reminders = await loadRemindersForWorkspaces({
      workspaceIds,
      statusFilter: 'default',
      to: before,
    });

    res.json(reminders);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/reminders/overdue', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getReminderScopeWorkspaceIds(req);
    const reminders = await loadRemindersForWorkspaces({
      workspaceIds,
      statusFilter: 'overdue',
    });

    res.json(reminders);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/reminders/today', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await getReminderScopeWorkspaceIds(req);
    const now = new Date();
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
    );
    const reminders = await loadRemindersForWorkspaces({
      workspaceIds,
      statusFilter: 'default',
      to: endOfDay.toISOString(),
    });

    res.json(reminders);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post(
  '/api/reminders',
  authMiddleware,
  rateLimit('write'),
  quotaGuard('reminders'),
  async (req, res) => {
    try {
      let workspaceId = req.workspaceId ?? (await resolveReminderWorkspaceIdForRequest(req));
      await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }
      if (title.length > 300) {
        return res.status(400).json({ error: 'title must be 300 characters or less' });
      }

      const body = normalizeNullableText(req.body?.body);
      if (body && body.length > 5000) {
        return res.status(400).json({ error: 'body must be 5000 characters or less' });
      }

      const remindAt = parseReminderTimestamp(req.body?.remind_at, 'remind_at');
      const requestedCalendarId = normalizeNullableText(req.body?.calendar_id);
      let calendarId = null;
      if (requestedCalendarId) {
        if (!isUuidLike(requestedCalendarId)) {
          return res.status(400).json({ error: 'Invalid calendar_id' });
        }
        const calendar = await getCalendarById(requestedCalendarId);
        if (!calendar) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
        await requireWorkspaceAccess(req.authUser.id, calendar.workspace_id, 'member');
        workspaceId = calendar.workspace_id;
        calendarId = calendar.id;
      }

      const linkedType = normalizeReminderLinkedType(req.body?.linked_type);
      const linkedId = normalizeNullableText(req.body?.linked_id);
      const recurrenceRuleRaw = normalizeNullableText(req.body?.recurrence_rule);
      const recurrenceRule = recurrenceRuleRaw ? recurrenceRuleRaw.toLowerCase() : null;
      const specificDates = normalizeDateKeyList(req.body?.specific_dates);

      if (linkedId && !isUuidLike(linkedId)) {
        return res.status(400).json({ error: 'Invalid linked_id' });
      }
      if ((linkedType === null || linkedType === 'none') && linkedId) {
        return res.status(400).json({ error: 'linked_type is required when linked_id is provided' });
      }

      await validateReminderLink({ workspaceId, linkedType, linkedId });

      const status = 'active';
      const isSpecificDates = recurrenceRule === SPECIFIC_DATES_SERIES_TYPE || specificDates.length > 0;
      if (isSpecificDates && specificDates.length === 0) {
        return res.status(400).json({ error: 'specific_dates is required for specific date reminders' });
      }
      const seriesId = isSpecificDates ? crypto.randomUUID() : null;
      const legacyFields = getReminderLegacyFields({
        userId: req.authUser.id,
        linkedType,
        linkedId,
        body,
        status,
        calendarId,
        recurrenceRule: isSpecificDates ? null : recurrenceRule,
        seriesId,
        seriesType: isSpecificDates ? SPECIFIC_DATES_SERIES_TYPE : null,
      });

      const insertPayload = {
        workspace_id: workspaceId,
        user_id: req.authUser.id,
        title,
        body,
        remind_at: remindAt,
        status,
        calendar_id: calendarId,
        linked_type: linkedType,
        linked_id: linkedId,
        completed_at: null,
        dismissed_at: null,
        snoozed_until: null,
        ...legacyFields,
      };

      if (isSpecificDates) {
        const specificDatePayloads = buildSpecificDateSeriesPayload({
          baseStartAt: remindAt,
          baseEndAt: null,
          dateKeys: specificDates,
          sharedFields: {
            ...insertPayload,
            recurrence_rule: null,
            series_id: seriesId,
            series_type: SPECIFIC_DATES_SERIES_TYPE,
          },
          seriesType: SPECIFIC_DATES_SERIES_TYPE,
          recurrenceRule: null,
          includeEndAt: false,
        });

        const { data, error } = await supabase
          .from('reminders')
          .insert(specificDatePayloads)
          .select(reminderSelectColumns);

        if (error) throw error;
        res.json({
          created: Array.isArray(data) ? data.map((row) => mapReminderRow(row)) : [],
          series_id: seriesId,
          series_type: SPECIFIC_DATES_SERIES_TYPE,
        });
        return;
      }

      const { data, error } = await supabase
        .from('reminders')
        .insert(insertPayload)
        .select(reminderSelectColumns)
        .single();

      if (error) throw error;
      res.json(mapReminderRow(data));
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.patch('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (String(reminder.user_id ?? reminder.created_by ?? '') !== String(req.authUser.id)) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await requireWorkspaceAccess(req.authUser.id, reminder.workspace_id, 'member');

    const nextTitle = req.body?.title !== undefined ? String(req.body.title ?? '').trim() : null;
    if (nextTitle !== null && !nextTitle) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (nextTitle !== null && nextTitle.length > 300) {
      return res.status(400).json({ error: 'title must be 300 characters or less' });
    }

    const nextBody = req.body?.body !== undefined ? normalizeNullableText(req.body.body) : undefined;
    if (nextBody !== undefined && nextBody !== null && nextBody.length > 5000) {
      return res.status(400).json({ error: 'body must be 5000 characters or less' });
    }

    const hasRemindAt = req.body?.remind_at !== undefined;
    const nextRemindAt = hasRemindAt ? parseReminderTimestamp(req.body.remind_at, 'remind_at') : null;
    const hasStatus = req.body?.status !== undefined;
    const nextStatus = hasStatus ? normalizeReminderStatus(req.body.status) : null;

    const hasLinkedType = req.body?.linked_type !== undefined;
    const nextLinkedType = hasLinkedType ? normalizeReminderLinkedType(req.body.linked_type) : null;
    const hasLinkedId = req.body?.linked_id !== undefined;
    const nextLinkedId = hasLinkedId ? normalizeNullableText(req.body.linked_id) : null;
    const hasCalendarId = req.body?.calendar_id !== undefined;
    const nextCalendarId = hasCalendarId ? normalizeNullableText(req.body.calendar_id) : null;

    if (nextLinkedId && !isUuidLike(nextLinkedId)) {
      return res.status(400).json({ error: 'Invalid linked_id' });
    }
    if (hasLinkedId && nextLinkedId && (nextLinkedType === null || nextLinkedType === 'none')) {
      return res.status(400).json({ error: 'linked_type is required when linked_id is provided' });
    }
    if (hasCalendarId && nextCalendarId && !isUuidLike(nextCalendarId)) {
      return res.status(400).json({ error: 'Invalid calendar_id' });
    }

    const currentStatus = String(reminder.status ?? 'active').toLowerCase();
    const effectiveStatus = nextStatus ?? currentStatus;
    const effectiveLinkedType = hasLinkedType ? nextLinkedType : reminder.linked_type ?? null;
    const effectiveLinkedId = hasLinkedId ? nextLinkedId : reminder.linked_id ?? null;
    let targetWorkspaceId = reminder.workspace_id;
    let resolvedCalendarId = hasCalendarId ? nextCalendarId : reminder.calendar_id ?? null;

    if (hasCalendarId && nextCalendarId) {
      const calendar = await getCalendarById(nextCalendarId);
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      await requireWorkspaceAccess(req.authUser.id, calendar.workspace_id, 'member');
      targetWorkspaceId = calendar.workspace_id;
      resolvedCalendarId = calendar.id;
    }

    if ((currentStatus === 'completed' || currentStatus === 'dismissed') && hasRemindAt && effectiveStatus !== 'active') {
      return res.status(400).json({ error: 'Set status to active before changing remind_at' });
    }

    await validateReminderLink({
      workspaceId: targetWorkspaceId,
      linkedType: effectiveLinkedType,
      linkedId: effectiveLinkedId,
    });

    const bodyForLegacy = nextBody !== undefined ? nextBody : reminder.body ?? reminder.notes ?? null;
    const legacyFields = getReminderLegacyFields({
      userId: req.authUser.id,
      linkedType: effectiveLinkedType,
      linkedId: effectiveLinkedId,
      body: bodyForLegacy,
      status: effectiveStatus,
      calendarId: resolvedCalendarId,
    });

    const updatePayload = {
      updated_at: new Date().toISOString(),
      ...legacyFields,
    };

    if (targetWorkspaceId && targetWorkspaceId !== reminder.workspace_id) {
      updatePayload.workspace_id = targetWorkspaceId;
    }

    if (nextTitle !== null) updatePayload.title = nextTitle;
    if (nextBody !== undefined) updatePayload.body = nextBody;
    if (hasRemindAt) updatePayload.remind_at = nextRemindAt;
    if (hasStatus) updatePayload.status = nextStatus;
    if (hasLinkedType) updatePayload.linked_type = nextLinkedType;
    if (hasLinkedId) updatePayload.linked_id = nextLinkedId;
    if (hasCalendarId) updatePayload.calendar_id = resolvedCalendarId;

    if (effectiveStatus === 'active') {
      updatePayload.completed_at = null;
      updatePayload.dismissed_at = null;
      updatePayload.is_done = false;
    } else if (effectiveStatus === 'completed') {
      updatePayload.completed_at = reminder.completed_at ?? new Date().toISOString();
      updatePayload.dismissed_at = null;
      updatePayload.is_done = true;
    } else if (effectiveStatus === 'dismissed') {
      updatePayload.dismissed_at = reminder.dismissed_at ?? new Date().toISOString();
      updatePayload.completed_at = null;
      updatePayload.is_done = true;
    }

    if (req.body?.snoozed_until !== undefined) {
      const snoozedUntil = parseReminderTimestamp(req.body.snoozed_until, 'snoozed_until');
      updatePayload.snoozed_until = snoozedUntil;
      updatePayload.remind_at = snoozedUntil;
      updatePayload.status = 'active';
      updatePayload.completed_at = null;
      updatePayload.dismissed_at = null;
      updatePayload.is_done = false;
    }

    const { data, error } = await supabase
      .from('reminders')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('workspace_id', reminder.workspace_id)
      .eq('user_id', req.authUser.id)
      .select(reminderSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapReminderRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/reminders/:id/complete', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (String(reminder.user_id ?? reminder.created_by ?? '') !== String(req.authUser.id)) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await requireWorkspaceAccess(req.authUser.id, reminder.workspace_id, 'member');

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('reminders')
      .update({
        status: 'completed',
        completed_at: nowIso,
        dismissed_at: null,
        snoozed_until: null,
        is_done: true,
        updated_at: nowIso,
      })
      .eq('id', req.params.id)
      .eq('workspace_id', reminder.workspace_id)
      .eq('user_id', req.authUser.id)
      .select(reminderSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapReminderRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/reminders/:id/dismiss', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (String(reminder.user_id ?? reminder.created_by ?? '') !== String(req.authUser.id)) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await requireWorkspaceAccess(req.authUser.id, reminder.workspace_id, 'member');

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('reminders')
      .update({
        status: 'dismissed',
        dismissed_at: nowIso,
        completed_at: null,
        snoozed_until: null,
        is_done: true,
        updated_at: nowIso,
      })
      .eq('id', req.params.id)
      .eq('workspace_id', reminder.workspace_id)
      .eq('user_id', req.authUser.id)
      .select(reminderSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapReminderRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/reminders/:id/snooze', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (String(reminder.user_id ?? reminder.created_by ?? '') !== String(req.authUser.id)) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await requireWorkspaceAccess(req.authUser.id, reminder.workspace_id, 'member');

    const snoozedUntil = parseReminderTimestamp(req.body?.snooze_until, 'snooze_until');
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('reminders')
      .update({
        remind_at: snoozedUntil,
        snoozed_until: snoozedUntil,
        status: 'active',
        completed_at: null,
        dismissed_at: null,
        is_done: false,
        updated_at: nowIso,
      })
      .eq('id', req.params.id)
      .eq('workspace_id', reminder.workspace_id)
      .eq('user_id', req.authUser.id)
      .select(reminderSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapReminderRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (String(reminder.user_id ?? reminder.created_by ?? '') !== String(req.authUser.id)) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await requireWorkspaceAccess(req.authUser.id, reminder.workspace_id, 'member');

    const { error } = await supabase
      .from('reminders')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', reminder.workspace_id)
      .eq('user_id', req.authUser.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/notes', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('notes')
      .select(
        noteSelectColumns
      )
      .eq('workspace_id', workspaceId)
      .limit(500);

    if (error) throw error;
    const mapped = (data ?? []).map((row) => mapNoteResponse(row));
    const tree = buildNotesTree(mapped);
    const flat = flattenNotesTree(tree, []);
    res.json({ notes: flat, tree });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/notes/:id', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('notes')
      .select(
        noteSelectColumns
      )
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Note not found.' });
    res.json(mapNoteResponse(data));
  } catch (error) {
    return respondWithError(res, error);
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
          updated_by: req.authUser.id,
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
          noteSelectColumns
        )
        .single();

      if (error) throw error;
      res.json(mapNoteResponse(data));
    } catch (error) {
      return respondWithError(res, error);
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
        noteSelectColumns
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
    update.updated_by = req.authUser.id;
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('notes')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(
        noteSelectColumns
      )
      .single();

    if (error) throw error;
    res.json(mapNoteResponse(data));
  } catch (error) {
    return respondWithError(res, error);
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
          updated_by: req.authUser.id,
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
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
          noteSelectColumns
        )
        .single();

      if (error) throw error;
      res.json(mapNoteResponse(data));
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

app.delete('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data: existing, error: existingError } = await supabase
      .from('notes')
      .select(
        noteSelectColumns
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
        noteSelectColumns
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
    return respondWithError(res, error);
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
          noteSelectColumns
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
        updated_by: req.authUser.id,
        updated_at: new Date().toISOString(),
      };

      const { data: restored, error: restoreError } = await supabase
        .from('notes')
        .update(payload)
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .select(
          noteSelectColumns
        )
        .single();
      if (restoreError) throw restoreError;

      res.json(mapNoteResponse(restored));
    } catch (error) {
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
    return respondWithError(res, error);
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
      return respondWithError(res, error);
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
    return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
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
      return respondWithError(res, error);
    }
  }
);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  void runNotificationScheduler();
  notificationSchedulerTimer = setInterval(() => {
    void runNotificationScheduler();
  }, 60_000);
});
