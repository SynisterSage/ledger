import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import {
  parseExternalUrl,
  createOrGetExternalReference,
  resolveExternalReference,
  linkExternalReference,
  unlinkExternalReference,
  getExternalReferencesForTarget,
  searchExternalReferences,
} from './integrations/external-references.js';
import {
  generateExternalReferencePreview,
  getExternalReferencePreview,
  getFigmaPreviewConsent,
} from './integrations/external-previews.js';
import { assertFigmaCapability, getFigmaCapabilityMinimumRole } from './integrations/figma/figma-policy.js';
import { checkExternalReferenceChange, getExternalReferenceChangeState, getFigmaAutomationSettings, markFigmaReferencesForCheck, updateFigmaAutomationSettings } from './integrations/external-change-awareness.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp/server.js';
import { OPENAI_APPS_CHALLENGE_PATH, getOpenAiAppsChallengeToken } from './mcp/openai-challenge.js';
import { createGithubAppJwt, createGithubState, exchangeGithubCode, getAccessibleInstallations, getCanonicalInstallation, getGithubUser, createInstallationToken, listInstallationRepositories, normalizeGithubRepository, revokeGithubUserToken, hashGithubState, verifyGithubWebhookSignature } from './integrations/github/github-app.js';
import { findGithubPullRequestsForCommit, resolveGithubMetadata, searchGithubWork, githubSafeMessage, GithubProviderError } from './integrations/github/github-adapter.js';
import { parseGithubUrl } from './integrations/github/github-url-parser.js';
import { findLinkedGithubReferences, listGithubAttention, reconcileGithubAttention } from './integrations/github/github-live-awareness.js';
import { GITHUB_CAPTURE_EVENT_TYPES, buildGithubIntakePayload, githubCaptureEventType, githubCaptureFingerprint, githubCaptureRuleMatches, githubNotificationCategory, normalizeGithubCaptureRule } from './integrations/github/github-capture.js';
import { findActiveGithubTasks, githubTaskDescription, projectRepositoryRole } from './integrations/github/github-project-workflows.js';
import { githubConnectionHealth, githubSafeErrorCode, githubSafeErrorMessage, isStaleGithubEvent } from './integrations/github/github-health.js';
import { createSupabaseTraceFetch } from './request-instrumentation.js';
import { getAllowedCorsOrigins, isAllowedCorsOrigin } from './cors-origins.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const allowedCorsOrigins = getAllowedCorsOrigins();

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
  global: { fetch: createSupabaseTraceFetch() },
});

const captureRawBody = (req, _res, buffer) => {
  if (buffer?.length) {
    req.rawBody = buffer.toString('utf8');
  }
};

app.use(
  cors({
    origin(origin, callback) {
      return isAllowedCorsOrigin(origin, allowedCorsOrigins)
        ? callback(null, true)
        : callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
// Notes can carry pasted images and rich HTML that exceed the old 256kb cap.
const REQUEST_BODY_LIMIT = '5mb';
app.use(express.json({ limit: REQUEST_BODY_LIMIT, verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, limit: REQUEST_BODY_LIMIT, verify: captureRawBody }));

// Keep OAuth/MCP scan diagnostics visible in Render without logging credentials,
// request bodies, authorization codes, or bearer tokens.
app.use((req, res, next) => {
  if (!req.path.startsWith('/oauth') && req.path !== '/mcp') return next();
  const startedAt = Date.now();
  res.on('finish', () => console.log(JSON.stringify({
    type: 'mcp_oauth_request',
    method: req.method,
    path: req.path,
    status: res.statusCode,
    duration_ms: Date.now() - startedAt,
    user_agent: req.get('user-agent') || null,
    origin: req.get('origin') || null,
  })));
  next();
});

const TIER_LIMITS = {
  free: { projects: 5, events: 100, notes: 100, reminders: 100 },
  pro: { projects: Infinity, events: Infinity, notes: Infinity, reminders: Infinity },
};

const REMINDER_TABLES = ['reminders', 'calendar_reminders'];

const WINDOW_MS = 60_000;
const RATE_LIMITS = {
  auth: { max: 60 },
  // Navigation-heavy desktop use can burst a lot of reads quickly; keep this high enough
  // for normal paging while still protecting against sustained scraping or abuse.
  read: { max: 600 },
  write: { max: 60 },
  figma_resolve: { max: 30 },
  figma_preview: { max: 12 },
  figma_linked: { max: 120 },
  figma_unlink: { max: 30 },
  figma_update: { max: 60 },
  figma_change_check: { max: 30 },
  figma_webhook: { max: 120 },
  figma_cleanup: { max: 2 },
  github_connect: { max: 10 },
  github_callback: { max: 20 },
  github_refresh: { max: 20 },
  github_disconnect: { max: 10 },
  github_webhook: { max: 120 },
  mcp_auth: { max: 20 },
  mcp_poll: { max: 60 },
  mcp_request: { max: 120 },
  mcp_write_create: { max: 20 },
  mcp_write_task: { max: 60 },
  mcp_write_focus: { max: 30 },
};

const rateBuckets = new Map();

const getBucketKey = (scope, req, userId) => `${scope}:${scope.startsWith('mcp') ? (req.mcpContext?.connection?.id ?? userId ?? req.ip) : (userId ?? req.ip)}`;

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
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Intake';

const inboxItemSelectColumns = [
  'id',
  'workspace_id',
  'user_id',
  'updated_by',
  'source',
  'source_provider',
  'source_id',
  'source_url',
  'title',
  'body',
  'raw_payload',
  'suggested_type',
  'suggested_project_id',
  'suggested_assignee_id',
  'suggested_calendar_id',
  'suggested_note_section_id',
  'suggested_date',
  'suggested_due_at',
  'status',
  'converted_type',
  'converted_id',
  'converted_at',
  'converted_by',
  'archived_at',
  'archived_by',
  'snoozed_until',
  'created_at',
  'updated_at',
].join(', ');

const normalizeSourceUrl = (value) => {
  const text = clampText(value, 2_000);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

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
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
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

const FIGMA_PLUGIN_CLIENT_ID = 'ledger-figma-plugin';
const FIGMA_PLUGIN_SCOPES = [
  'workspace:read',
  'figma-context:read',
  'external-reference:create',
  'external-reference:link',
  'external-reference:unlink',
  'intake:create',
  'task:create',
  'work:search',
  'work:update:status',
  'work:update:assignee',
  'work:update:priority',
  'work:update:project',
  'work:update:due-date',
  'external-reference:check-version',
  'external-reference:refresh-preview',
];
const FIGMA_PLUGIN_CLIENT_SCOPES = new Set(FIGMA_PLUGIN_SCOPES);
const hashPluginValue = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const pluginValueMatches = (value, hash) => {
  const actual = Buffer.from(hashPluginValue(value));
  const expected = Buffer.from(String(hash ?? ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const getPluginAuthorizeUrl = (sessionId, code) => {
  const base = process.env.FIGMA_PLUGIN_AUTH_URL?.trim() || process.env.PUBLIC_FRONTEND_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/?figmaPluginAuth=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}`;
};

const loadPluginCredential = async (req) => {
  const token = getBearerToken(req);
  if (!token || !token.startsWith('ledger_figma_plugin_')) return null;
  const result = await supabase.from('figma_plugin_credentials').select('id, user_id, client_id, scopes, expires_at, revoked_at').eq('token_hash', hashPluginValue(token)).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.revoked_at || new Date(result.data.expires_at).getTime() <= Date.now() || result.data.client_id !== FIGMA_PLUGIN_CLIENT_ID) return null;
  void supabase.from('figma_plugin_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', result.data.id);
  return { token, credential: result.data };
};

const pluginAuthMiddleware = async (req, res, next) => {
  try {
    const loaded = await loadPluginCredential(req);
    if (!loaded) return res.status(401).json({ error: 'Your Ledger session expired.' });
    req.pluginCredential = loaded.credential;
    req.authUser = { id: loaded.credential.user_id };
    next();
  } catch (error) { return respondWithError(res, error); }
};
const requirePluginScope = (req, scope) => {
  if (!req.pluginCredential?.scopes?.includes(scope)) {
    const error = new Error('Plugin permission denied.');
    error.statusCode = 403;
    throw error;
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
const projectMilestoneTypes = [
  'Deadline',
  'Decision',
  'Review',
  'Event',
  'Reminder',
  'Handoff',
  'Custom',
];
const projectTypes = ['code', 'design', 'personal', 'ops', 'writing', 'other'];

const normalizeProjectMilestoneType = (value) => {
  const raw = String(value ?? 'Custom').trim().toLowerCase();
  return projectMilestoneTypes.find((type) => type.toLowerCase() === raw) ?? 'Custom';
};
const normalizeProjectType = (value) => {
  const raw = String(value ?? 'other').trim().toLowerCase();
  return projectTypes.includes(raw) ? raw : 'other';
};

const projectSelectColumns =
  'id, workspace_id, name, description, status, completeness, color, start_date, end_date, project_type, lead_id, owner_team_id, created_by, created_at, updated_at';
const eventSelectColumns =
  'id, workspace_id, title, start_at, end_at, all_day, calendar_id, color, status, visibility, recurrence_rule, notes, location, project_id, note_id, series_id, series_type, source, source_platform, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at';
const workspaceTeamSelectColumns =
  'id, workspace_id, created_by, updated_by, name, identifier, description, color, archived_at, archived_by, default_task_scope, default_project_visibility, default_assignee_behavior, created_at, updated_at';
const projectMilestoneSelectColumns =
  'id, workspace_id, project_id, title, milestone_date, type, note, completed, linked_note_id, linked_reminder_id, linked_event_id, assigned_to_user_id, assigned_to_team_id, assigned_team_id, assigned_by_user_id, assigned_at, created_by, updated_by, created_at, updated_at';
const taskSelectColumns =
  'id, workspace_id, project_id, milestone_id, title, description, notes, due_date, due_time, status, priority, assigned_to, assigned_to_user_id, assigned_to_team_id, assigned_team_id, assigned_by_user_id, assigned_at, tags, completed_at, source, source_platform, created_at, updated_at';
const taskSelectWithHorizonColumns = `${taskSelectColumns}, task_horizon`;
const reminderSelectColumns =
  'id, workspace_id, user_id, title, body, remind_at, status, linked_type, linked_id, completed_at, dismissed_at, snoozed_until, source, source_platform, created_at, updated_at, calendar_id, project_id, note_id, notes, color, is_done, created_by, series_id, series_type, recurrence_rule, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at';
const reminderDashboardSelectColumns =
  'id, workspace_id, user_id, title, body, remind_at, status, linked_type, linked_id, completed_at, dismissed_at, snoozed_until, source, source_platform, created_at, updated_at, calendar_id, project_id, note_id, notes, color, is_done, created_by, series_id, series_type, recurrence_rule, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at';
const noteSmartLinkSelectColumns =
  'id, workspace_id, note_id, source_key, source_text, source_start_offset, source_end_offset, linked_event_id, linked_reminder_id, dismissed_at, created_by, updated_by, created_at, updated_at';
const notePersonLinkSelectColumns =
  'id, workspace_id, note_id, person_user_id, source_key, source_text, created_by, updated_by, created_at, updated_at';
const reminderLinkedTypes = ['task', 'event', 'note', 'project', 'inbox', 'none'];
const reminderStatusValues = ['active', 'completed', 'dismissed', 'overdue'];
const reminderLinkedLabels = {
  task: 'Task',
  event: 'Event',
  note: 'Note',
  project: 'Project',
  inbox: 'Intake item',
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

const normalizeCaptureSource = (value, fallback = 'workspace') => {
  const text = normalizeNullableText(value);
  return text ? text.toLowerCase() : fallback;
};

const normalizeCaptureSourcePlatform = (value) => {
  const text = normalizeNullableText(value);
  return text ? text.toLowerCase() : null;
};

const intakeSourceValues = [
  'quick_capture',
  'browser',
  'meeting',
  'calendar',
  'manual',
  'slack later',
  'email later',
  'system_suggestion',
];

const intakeSuggestedTypeValues = [
  'task',
  'note',
  'event',
  'reminder',
  'deadline',
  'project',
  'milestone',
  'capture',
];

const normalizeIntakeSource = (value) => {
  const source = normalizeNullableText(value)?.toLowerCase();
  if (!source || !intakeSourceValues.includes(source)) {
    const error = new Error('Invalid source');
    error.statusCode = 400;
    throw error;
  }
  return source;
};

const normalizeIntakeSuggestedType = (value) => {
  const type = normalizeNullableText(value)?.toLowerCase() ?? 'capture';
  if (!intakeSuggestedTypeValues.includes(type)) {
    const error = new Error('Invalid suggested_type');
    error.statusCode = 400;
    throw error;
  }
  return type;
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
  'id, workspace_id, user_id, updated_by, title, content, content_html, date, mood, source, source_platform, mode, mind_map_structure, parent_id, section_id, sort_order, depth, created_at, updated_at';
const noteSummarySelectColumns =
  'id, workspace_id, user_id, updated_by, title, preview, date, mood, source, source_platform, mode, parent_id, section_id, sort_order, depth, created_at, updated_at';

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
  mobileNotificationPreferences: {
    pushNotifications: false,
    remindersEnabled: true,
    eventsEnabled: true,
    projectActionsEnabled: true,
    overdueItemsEnabled: true,
  },
  mobileSiriPreferences: {
    defaultWorkspaceId: null,
    askEveryTime: false,
  },
  mobileAppPreferences: {
    hapticsEnabled: true,
    reduceMotionEnabled: false,
  },
  mobileNotificationOnboardingCompleted: false,
  mobileNotificationOnboardingChoice: null,
};

const normalizeUserPreferences = (value) => {
  const raw = value && typeof value === 'object' ? value : {};
  const merged = { ...userPreferencesDefaults, ...raw };
  const mobileNotificationsRaw =
    merged.mobileNotificationPreferences && typeof merged.mobileNotificationPreferences === 'object'
      ? merged.mobileNotificationPreferences
      : {};
  const mobileNotificationPreferences = {
    pushNotifications: Boolean(
      mobileNotificationsRaw.pushNotifications ??
        mobileNotificationsRaw.push_notifications ??
        userPreferencesDefaults.mobileNotificationPreferences.pushNotifications
    ),
    remindersEnabled: Boolean(
      mobileNotificationsRaw.remindersEnabled ??
        mobileNotificationsRaw.reminders_enabled ??
        userPreferencesDefaults.mobileNotificationPreferences.remindersEnabled
    ),
    eventsEnabled: Boolean(
      mobileNotificationsRaw.eventsEnabled ??
        mobileNotificationsRaw.events_enabled ??
        userPreferencesDefaults.mobileNotificationPreferences.eventsEnabled
    ),
    projectActionsEnabled: Boolean(
      mobileNotificationsRaw.projectActionsEnabled ??
        mobileNotificationsRaw.project_actions_enabled ??
        userPreferencesDefaults.mobileNotificationPreferences.projectActionsEnabled
    ),
    overdueItemsEnabled: Boolean(
      mobileNotificationsRaw.overdueItemsEnabled ??
        mobileNotificationsRaw.overdue_items_enabled ??
      userPreferencesDefaults.mobileNotificationPreferences.overdueItemsEnabled
    ),
  };
  const mobileSiriPreferencesRaw =
    merged.mobileSiriPreferences && typeof merged.mobileSiriPreferences === 'object'
      ? merged.mobileSiriPreferences
      : {};
  const mobileSiriPreferences = {
    defaultWorkspaceId:
      typeof mobileSiriPreferencesRaw.defaultWorkspaceId === 'string' &&
      mobileSiriPreferencesRaw.defaultWorkspaceId.trim()
        ? mobileSiriPreferencesRaw.defaultWorkspaceId.trim()
        : null,
    askEveryTime: Boolean(
      mobileSiriPreferencesRaw.askEveryTime ?? mobileSiriPreferencesRaw.ask_every_time ?? false
    ),
  };
  const mobileAppPreferencesRaw =
    merged.mobileAppPreferences && typeof merged.mobileAppPreferences === 'object'
      ? merged.mobileAppPreferences
      : {};
  const mobileAppPreferences = {
    hapticsEnabled: Boolean(
      mobileAppPreferencesRaw.hapticsEnabled ??
        mobileAppPreferencesRaw.haptics_enabled ??
        userPreferencesDefaults.mobileAppPreferences.hapticsEnabled
    ),
    reduceMotionEnabled: Boolean(
      mobileAppPreferencesRaw.reduceMotionEnabled ??
        mobileAppPreferencesRaw.reduce_motion_enabled ??
        userPreferencesDefaults.mobileAppPreferences.reduceMotionEnabled
    ),
  };
  const mobileNotificationOnboardingChoice = ['enabled', 'denied', 'skipped'].includes(
    String(merged.mobileNotificationOnboardingChoice)
  )
    ? String(merged.mobileNotificationOnboardingChoice)
    : userPreferencesDefaults.mobileNotificationOnboardingChoice;

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
    mobileNotificationPreferences,
    mobileSiriPreferences,
    mobileAppPreferences,
    mobileNotificationOnboardingCompleted: Boolean(merged.mobileNotificationOnboardingCompleted),
    mobileNotificationOnboardingChoice,
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

const mobilePushTokenSelectColumns =
  'id, user_id, platform, push_token, enabled, last_registered_at, revoked_at, created_at, updated_at';

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

const normalizeMobilePushPlatform = (value) => {
  const normalized = String(value ?? 'ios').trim().toLowerCase();
  return ['ios', 'android'].includes(normalized) ? normalized : 'ios';
};

const normalizeMobilePushToken = (value) => {
  const normalized = normalizeNullableText(value);
  return normalized ? normalized : null;
};

const mapMobilePushTokenRow = (row) => ({
  id: row?.id ?? null,
  userId: row?.user_id ?? null,
  platform: normalizeMobilePushPlatform(row?.platform),
  pushToken: row?.push_token ?? null,
  enabled: Boolean(row?.enabled),
  lastRegisteredAt: row?.last_registered_at ?? null,
  revokedAt: row?.revoked_at ?? null,
  created_at: row?.created_at ?? null,
  updated_at: row?.updated_at ?? null,
});

const mobilePushTokenInsertPayload = (userId, value = {}) => {
  const pushToken = normalizeMobilePushToken(value.pushToken ?? value.push_token);
  if (!pushToken) {
    const error = new Error('Missing push token');
    error.statusCode = 400;
    throw error;
  }

  const platform = normalizeMobilePushPlatform(value.platform);
  const nowIso = new Date().toISOString();

  return {
    user_id: userId,
    platform,
    push_token: pushToken,
    enabled: value.enabled !== false,
    last_registered_at: nowIso,
    revoked_at: null,
    updated_at: nowIso,
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
  deliveredMobileAt: row.delivered_mobile_at ?? null,
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

const getMobilePushTokensForUser = async (userId, platform = 'ios') => {
  const { data, error } = await supabase
    .from('mobile_push_tokens')
    .select(mobilePushTokenSelectColumns)
    .eq('user_id', userId)
    .eq('platform', normalizeMobilePushPlatform(platform))
    .eq('enabled', true)
    .is('revoked_at', null);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const sendExpoPushMessages = async (messages) => {
  const payload = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!payload.length) return null;

  const chunks = [];
  for (let index = 0; index < payload.length; index += 100) {
    chunks.push(payload.slice(index, index + 100));
  }

  const results = [];
  for (const chunk of chunks) {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `Expo push request failed with status ${response.status}`);
    }

    if (!text) {
      results.push(null);
      continue;
    }

    try {
      results.push(JSON.parse(text));
    } catch {
      results.push(text);
    }
  }

  return results;
};

const notificationTypeFallbackLabel = (notificationType, sourceType) => {
  const normalizedType = String(notificationType ?? '').trim();
  if (normalizedType === 'reminder_due') return 'Reminder';
  if (normalizedType === 'event_starting') return 'Calendar event';
  if (normalizedType === 'task_due') return 'Task';
  if (normalizedType === 'project_deadline') return 'Project deadline';
  if (normalizedType === 'inbox_capture') return 'Intake capture';
  if (normalizedType === 'invite.accepted') return 'Workspace invite';
  if (normalizedType === 'overdue_item') {
    if (sourceType === 'project') return 'Project deadline';
    if (sourceType === 'task') return 'Overdue task';
    return 'Overdue item';
  }
  return 'Ledger';
};

const buildStoredNotificationMetadata = (candidate) => {
  const metadata = safeJson(candidate?.metadata, {}) ?? {};
  return {
    ...metadata,
    title: normalizeNullableText(candidate?.title) ?? metadata.title ?? null,
    body: normalizeNullableText(candidate?.body) ?? metadata.body ?? null,
    context: normalizeNullableText(candidate?.context) ?? metadata.context ?? null,
    moduleKind: candidate?.moduleKind ?? metadata.moduleKind ?? null,
    focusPayload: candidate?.focusPayload ?? metadata.focusPayload ?? null,
    actions: Array.isArray(candidate?.actions) ? candidate.actions : Array.isArray(metadata.actions) ? metadata.actions : [],
  };
};

const normalizePushDetail = (detail, context) => {
  const normalizedDetail = normalizeNullableText(detail);
  const normalizedContext = normalizeNullableText(context);
  if (!normalizedDetail || !normalizedContext) return normalizedDetail;
  if (normalizedDetail === normalizedContext) return null;

  const duplicatedPrefix = `${normalizedContext} · `;
  if (normalizedDetail.startsWith(duplicatedPrefix)) {
    return normalizeNullableText(normalizedDetail.slice(duplicatedPrefix.length));
  }

  return normalizedDetail;
};

const buildMobilePushMessage = ({ row, candidate, workspace }) => {
  const metadata = safeJson(row?.metadata, {}) ?? {};
  const sourceType = String(row?.source_type ?? '');
  const title =
    pickSpecificNotificationTitle(candidate?.title, sourceType) ??
    pickSpecificNotificationTitle(metadata.title, sourceType) ??
    notificationTypeFallbackLabel(row?.notification_type, sourceType);
  const context =
    normalizeNullableText(candidate?.context) ??
    normalizeNullableText(metadata.context) ??
    notificationTypeFallbackLabel(row?.notification_type, sourceType);
  const detail = normalizePushDetail(candidate?.body ?? metadata.body, context);
  const body =
    [context, detail, normalizeNullableText(workspace?.name)]
      .filter(Boolean)
      .join(' · ') || 'You have something waiting in Ledger.';
  const moduleKind = candidate?.moduleKind ?? metadata.moduleKind ?? null;
  const focusPayload = candidate?.focusPayload ?? metadata.focusPayload ?? null;

  return {
    to: null,
    sound: 'default',
    title,
    body,
    data: {
      notificationId: row.id,
      workspaceId: row.workspace_id ?? null,
      workspaceName: workspace?.name ?? null,
      sourceType: row.source_type,
      sourceId: row.source_id,
      notificationType: row.notification_type,
      scheduledFor: row.scheduled_for,
      title,
      body,
      moduleKind,
      focusPayload,
      context,
      route: '/(tabs)/notifications',
      routeParams: {
        notificationId: row.id,
        workspaceId: row.workspace_id ?? null,
        sourceType: row.source_type,
        sourceId: row.source_id,
      },
    },
  };
};

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

const formatNotificationRelativeTime = (dateLike, now = new Date()) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  if (absMinutes < 1) return diffMs >= 0 ? 'now' : 'just now';
  if (absMinutes < 60) return diffMs >= 0 ? `in ${absMinutes} min` : `${absMinutes} min ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return diffMs >= 0 ? `in ${absHours} hr` : `${absHours} hr ago`;
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays} days` : `${absDays} days ago`;
};

const joinNotificationParts = (parts) =>
  parts.map((part) => normalizeNullableText(part)).filter(Boolean).join(' · ') || null;

const buildNotificationLedgerContext = (candidate, sourceMaps) => {
  const metadata = safeJson(candidate?.metadata, {}) ?? {};
  const calendar = sourceMaps.calendarById.get(candidate.calendar_id ?? metadata.calendar_id ?? '') ?? null;
  const project = sourceMaps.projectById.get(candidate.project_id ?? metadata.project_id ?? '') ?? null;
  const note = sourceMaps.noteById.get(candidate.note_id ?? metadata.note_id ?? '') ?? null;
  const workspace =
    sourceMaps.workspaceById.get(
      candidate.workspace_id ?? candidate.workspace_id_for_fetch ?? metadata.workspace_id ?? ''
    ) ?? null;

  return joinNotificationParts([
    calendar?.name ? `Calendar: ${calendar.name}` : null,
    project?.name ? `Project: ${project.name}` : null,
    note?.title ? `Note: ${note.title}` : null,
    workspace?.name ? `Workspace: ${workspace.name}` : null,
  ]);
};

const enrichDueNotificationCandidate = (candidate, sourceMaps, now = new Date()) => {
  const metadata = safeJson(candidate?.metadata, {}) ?? {};
  const sourceType = String(candidate?.source_type ?? '');
  const context = buildNotificationLedgerContext(candidate, sourceMaps) ?? candidate.context ?? null;
  const title = pickSpecificNotificationTitle(candidate?.title, sourceType) ?? candidate.title ?? null;

  if (sourceType === 'event') {
    const startAt = metadata.start_at ?? null;
    const startLabel = startAt ? formatNotificationDateTime(startAt) : null;
    const relativeLabel = startAt ? formatNotificationRelativeTime(startAt, now) : null;
    return {
      ...candidate,
      title: title ?? 'Event starting',
      body: joinNotificationParts([
        startLabel ? `Starts ${startLabel}` : null,
        relativeLabel,
        context,
      ]),
      context: context ?? candidate.context ?? 'Event',
    };
  }

  if (sourceType === 'reminder') {
    const remindAt = metadata.remind_at ?? null;
    const dueLabel = remindAt ? formatNotificationDateTime(remindAt) : null;
    const relativeLabel = remindAt ? formatNotificationRelativeTime(remindAt, now) : null;
    const notesLabel = normalizeNullableText(metadata.notes ?? candidate.notes);
    return {
      ...candidate,
      title: title ?? 'Reminder due',
      body: joinNotificationParts([
        dueLabel ? `Due ${dueLabel}` : null,
        relativeLabel,
        context,
        notesLabel,
      ]),
      context: context ?? candidate.context ?? 'Reminder',
    };
  }

  if (sourceType === 'task') {
    const dueAt = metadata.due_at ?? null;
    const dueLabel = dueAt ? formatNotificationDateTime(dueAt) : null;
    const relativeLabel = dueAt ? formatNotificationRelativeTime(dueAt, now) : null;
    return {
      ...candidate,
      title: title ?? 'Task due',
      body: joinNotificationParts([
        candidate.notification_type === 'overdue_item' && dueLabel
          ? `Overdue since ${dueLabel}`
          : dueLabel
          ? `Due ${dueLabel}`
          : null,
        relativeLabel,
        context,
      ]),
      context: context ?? candidate.context ?? 'Task',
    };
  }

  if (sourceType === 'project') {
    const deadlineAt = metadata.deadline_at ?? null;
    const deadlineLabel = deadlineAt ? formatNotificationDate(deadlineAt) : null;
    const relativeLabel = deadlineAt ? formatNotificationRelativeTime(deadlineAt, now) : null;
    return {
      ...candidate,
      title: title ?? 'Project deadline',
      body: joinNotificationParts([
        candidate.notification_type === 'overdue_item' && deadlineLabel
          ? `Deadline passed ${deadlineLabel}`
          : deadlineLabel
          ? `Deadline ${deadlineLabel}`
          : 'Project deadline',
        relativeLabel,
        context,
      ]),
      context: context ?? candidate.context ?? 'Project deadline',
    };
  }

  if (sourceType === 'inbox') {
    return {
      ...candidate,
      title: title ?? 'Intake item',
      body: joinNotificationParts([candidate.body, context]),
      context: context ?? candidate.context ?? 'Intake capture',
    };
  }

  if (sourceType === 'workspace_invite') {
    return {
      ...candidate,
      title: title ?? 'Invite accepted',
      body: joinNotificationParts([candidate.body, context]),
      context: context ?? candidate.context ?? 'Workspace invite',
    };
  }

  return {
    ...candidate,
    title: title ?? candidate.title ?? notificationTypeFallbackLabel(candidate.notification_type, sourceType),
    body: joinNotificationParts([candidate.body, context]),
    context: context ?? candidate.context ?? notificationTypeFallbackLabel(candidate.notification_type, sourceType),
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
          remind_at: row.remind_at ?? null,
          notes: notesLabel ?? null,
          project_id: row.project_id ?? null,
          note_id: row.note_id ?? null,
          calendar_id: row.calendar_id ?? null,
        },
        title: reminderTitle,
        body: reminderBodyParts.join(' · ') || null,
        context: row.calendar_id
          ? 'Calendar reminder'
          : row.project_id
          ? 'Project reminder'
          : 'Reminder',
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
          start_at: row.start_at ?? null,
          end_at: row.end_at ?? null,
          calendar_id: row.calendar_id ?? null,
          project_id: row.project_id ?? null,
          note_id: row.note_id ?? null,
        },
        title: eventTitle,
        body: startsLabel ? `Starts ${startsLabel}` : null,
        context: row.calendar_id ? 'Calendar event' : 'Event',
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
          due_date: row.due_date ?? null,
          due_time: dueTime ?? null,
          due_at: taskDueAt ? taskDueAt.toISOString() : null,
          project_id: row.project_id ?? null,
        },
        title: taskTitle,
        body: dueLabel ? `Due ${dueLabel}` : null,
        context: row.project_id ? 'Project task' : 'Task',
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
          deadline_at: row.end_date ? `${String(row.end_date)}T00:00:00` : null,
        },
        title: projectName || 'Project deadline',
        body: dueLabel ? `Project deadline · Due ${dueLabel}` : 'Project deadline',
        context: 'Project deadline',
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
        title: row.title ?? 'Intake capture',
        body: row.body ?? row.source_url ?? null,
        context: row.source ? `Capture from ${String(row.source)}` : 'Intake capture',
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
      context: 'Workspace invite',
      moduleKind: 'dashboard',
      focusPayload: normalizeNullableText(row.metadata?.focusPayload) ? safeJson(row.metadata.focusPayload, null) : null,
      actions: Array.isArray(row.metadata?.actions) ? row.metadata.actions : [],
      workspace_id_for_fetch: row.workspace_id ?? null,
    });
  }

  const sourceMaps = await getNotificationSourcePayload(userId, candidates);
  return candidates.map((candidate) => enrichDueNotificationCandidate(candidate, sourceMaps, now));
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
    title = title ?? inbox?.title ?? 'Intake capture';
    body = body ?? inbox?.body ?? inbox?.source_url ?? 'Waiting in Intake';
    moduleKind = moduleKind ?? 'inbox';
    focusPayload = focusPayload ?? { kind: 'inbox' };
    context = inbox?.source ? `Capture from ${String(inbox.source)}` : 'Intake capture';
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
  const eventEndAt = event?.end_at ? new Date(event.end_at) : eventStartAt;
  const eventHasStarted =
    eventEndAt instanceof Date && !Number.isNaN(eventEndAt.getTime()) && eventEndAt <= new Date();
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
    unread: actionTaken !== 'open',
    readAt: actionTaken === 'open' ? row.updated_at ?? null : null,
    deliveredInAppAt: row.delivered_in_app_at ?? null,
    deliveredDesktopAt: row.delivered_desktop_at ?? null,
    dismissedAt: row.dismissed_at ?? null,
    actionTaken: row.action_taken ?? null,
    status: isActive ? 'active' : 'earlier',
  };
};

const getNotificationCenterItems = async (userId, workspaceId = null) => {
  const normalizedWorkspaceId = normalizeNullableText(workspaceId);
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

  let rows = Array.isArray(data) ? data : [];
  if (normalizedWorkspaceId && normalizedWorkspaceId !== 'all') {
    const access = await requireWorkspaceAccess(userId, normalizedWorkspaceId, 'member');
    rows = rows.filter((row) => String(row.workspace_id ?? '') === access.workspace.id);
  }

  rows = rows.filter((row) => {
    const actionTaken = String(row.action_taken ?? '').trim().toLowerCase();
    if (row.dismissed_at) return false;
    if (actionTaken === 'dismiss' || actionTaken === 'snooze' || actionTaken === 'complete') {
      return false;
    }
    return true;
  });

  const maps = await buildNotificationCenterSourceMaps(rows);
  const items = rows.map((row) => mapNotificationCenterRow(row, maps));
  const active = items.filter((item) => item.status === 'active');
  const earlier = items.filter((item) => item.status !== 'active');
  const unread = items.filter((item) => item.unread);

  return {
    active,
    earlier,
    counts: {
      active: active.length,
      unread: unread.length,
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
      metadata: buildStoredNotificationMetadata(candidate),
    })
  );

  const { data: insertedRows, error: insertError } = await supabase
    .from('notification_events')
    .upsert(payload, {
      onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for',
    })
    .select(
      'id, user_id, workspace_id, source_type, source_id, notification_type, scheduled_for, delivered_in_app_at, delivered_desktop_at, delivered_mobile_at, dismissed_at, action_taken, metadata'
    );

  if (insertError) throw insertError;
  const eventRows = Array.isArray(insertedRows) ? insertedRows : [];
  if (!eventRows.length) return [];

  const eventIds = eventRows.map((row) => row.id).filter(Boolean);
  const workspaceIds = Array.from(new Set(eventRows.map((row) => row.workspace_id).filter(Boolean)));

  const [workspaceResult, tokenRows] = await Promise.all([
    workspaceIds.length
      ? supabase.from('workspaces').select('id, name, color').in('id', workspaceIds)
      : Promise.resolve({ data: [], error: null }),
    getMobilePushTokensForUser(userId, 'ios'),
  ]);

  if (workspaceResult.error) throw workspaceResult.error;

  const workspaceById = new Map(
    (workspaceResult.data ?? []).map((workspace) => [workspace.id, workspace])
  );
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

  const mobileTokens = Array.isArray(tokenRows)
    ? tokenRows
        .map((row) => normalizeMobilePushToken(row?.push_token))
        .filter(Boolean)
    : [];

  if (!mobileTokens.length) {
    return eventRows;
  }

  const pushMessages = eventRows
    .filter((row) => !row.delivered_mobile_at && !row.dismissed_at)
    .flatMap((row) => {
      const candidate = candidateByEventKey.get(
        [row.source_type, row.source_id, row.notification_type, row.scheduled_for].join('|')
      );
      const workspace = workspaceById.get(row.workspace_id ?? '') ?? null;
      return mobileTokens.map((token) => ({
        ...buildMobilePushMessage({ row, candidate, workspace }),
        to: token,
      }));
    });

  if (!pushMessages.length) {
    return eventRows;
  }

  try {
    await sendExpoPushMessages(pushMessages);
    const nowIso = new Date().toISOString();
    await supabase
      .from('notification_events')
      .update({ delivered_mobile_at: nowIso, updated_at: nowIso })
      .in('id', eventIds)
      .is('delivered_mobile_at', null)
      .is('dismissed_at', null);
  } catch (error) {
    console.error('[notifications] Mobile push delivery failed:', error?.message ?? error);
  }

  return eventRows;
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
    (error?.code === '42P01' || error?.code === 'PGRST205' || message.includes('does not exist') || message.includes('could not find the table')) &&
    message.includes(String(relationName).toLowerCase())
  );
};

const isMissingTaskTodayColumnError = (error) =>
  isMissingColumnError(error, 'show_in_today') ||
  isMissingColumnError(error, 'is_today_focus') ||
  isMissingColumnError(error, 'task_horizon');

const taskTodaySelectAttempts = [
  {
    columns: `${taskSelectWithHorizonColumns}, show_in_today, is_today_focus`,
    filter: 'show_in_today',
  },
  { columns: `${taskSelectColumns}, show_in_today, is_today_focus`, filter: 'show_in_today' },
  { columns: `${taskSelectWithHorizonColumns}, show_in_today`, filter: 'show_in_today' },
  { columns: `${taskSelectColumns}, show_in_today`, filter: 'show_in_today' },
  { columns: `${taskSelectWithHorizonColumns}, is_today_focus`, filter: 'is_today_focus' },
  { columns: `${taskSelectColumns}, is_today_focus`, filter: 'is_today_focus' },
  { columns: taskSelectWithHorizonColumns, filter: 'task_horizon' },
  { columns: taskSelectColumns, filter: 'show_in_today' },
];

const taskDueSelectAttempts = [...taskTodaySelectAttempts, { columns: taskSelectColumns, filter: null }];

const buildTaskSelectColumns = ({
  includeTaskHorizon = false,
  includeShowInToday = false,
  includeIsTodayFocus = false,
} = {}) =>
  [
    taskSelectColumns,
    includeTaskHorizon ? 'task_horizon' : null,
    includeShowInToday ? 'show_in_today' : null,
    includeIsTodayFocus ? 'is_today_focus' : null,
  ]
    .filter(Boolean)
    .join(', ');

const normalizeAssignmentTarget = (body = {}) => {
  const nextUserId = normalizeNullableText(body.assigned_to_user_id ?? body.assigned_to);
  const nextTeamId = normalizeNullableText(body.assigned_to_team_id ?? body.assigned_team_id);

  if (nextUserId && nextTeamId) {
    const error = new Error('Choose either a person or a team assignment');
    error.statusCode = 400;
    throw error;
  }

  return {
    assigned_to_user_id: nextUserId,
    assigned_to_team_id: nextTeamId,
  };
};

const buildAssignmentPersistenceFields = (assignmentTarget, actorUserId, nowIso) => {
  const assignedToUserId = assignmentTarget?.assigned_to_user_id ?? null;
  const assignedToTeamId = assignmentTarget?.assigned_to_team_id ?? null;
  const hasAssignment = Boolean(assignedToUserId || assignedToTeamId);

  return {
    assigned_to: assignedToUserId,
    assigned_to_user_id: assignedToUserId,
    assigned_to_team_id: assignedToTeamId,
    assigned_team_id: assignedToTeamId,
    assigned_by_user_id: hasAssignment ? actorUserId : null,
    assigned_at: hasAssignment ? nowIso : null,
  };
};

const buildEventAssignmentPersistenceFields = (assignmentTarget, actorUserId, nowIso) => {
  const assignedToUserId = assignmentTarget?.assigned_to_user_id ?? null;
  const assignedToTeamId = assignmentTarget?.assigned_to_team_id ?? null;
  const hasAssignment = Boolean(assignedToUserId || assignedToTeamId);

  return {
    assigned_to_user_id: assignedToUserId,
    assigned_to_team_id: assignedToTeamId,
    assigned_by_user_id: hasAssignment ? actorUserId : null,
    assigned_at: hasAssignment ? nowIso : null,
  };
};

const buildMilestoneAssignmentPersistenceFields = (assignmentTarget, actorUserId, nowIso) => {
  const fields = buildAssignmentPersistenceFields(assignmentTarget, actorUserId, nowIso);
  delete fields.assigned_to;
  return fields;
};

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

const resolveTodayWorkspaceIds = async (req) => {
  const requestedWorkspaceId = getRequestedWorkspaceId(req);
  if (requestedWorkspaceId) {
    await requireWorkspaceAccess(req.authUser.id, requestedWorkspaceId, 'member');
    return [requestedWorkspaceId];
  }

  const workspaceIdsSet = await getUserWorkspaceIds(req.authUser.id);
  return Array.from(workspaceIdsSet);
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

const MCP_CLIENT_ID = 'ledger-mcp';
const MCP_READ_SCOPES = ['workspace:read', 'projects:read', 'tasks:read', 'notes:read', 'calendar:read', 'daily:read'];
const MCP_WRITE_SCOPES = ['intake:write', 'tasks:write', 'notes:write', 'daily:write', 'projects:write'];
const MCP_SCOPES = [...MCP_READ_SCOPES, ...MCP_WRITE_SCOPES];
const mcpEphemeralCredentials = new Map();
const hashMcpValue = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const mcpValueMatches = (value, hash) => {
  const actual = Buffer.from(hashMcpValue(value));
  const expected = Buffer.from(String(hash ?? ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const createMcpCredential = () => `ledger_mcp_${crypto.randomBytes(32).toString('base64url')}`;
const createMcpCode = () => `${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const getMcpAuthorizeUrl = (sessionId, code) => {
  const base = process.env.MCP_AUTH_URL?.trim() || process.env.PUBLIC_FRONTEND_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/?mcpAuth=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}`;
};
const getMcpScopeUpgradeAuthorizeUrl = (sessionId, code) => {
  const base = process.env.MCP_AUTH_URL?.trim() || process.env.PUBLIC_FRONTEND_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/?mcpScopeUpgrade=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}`;
};

const MCP_OAUTH_RESOURCE = `${(process.env.PUBLIC_BACKEND_URL?.trim() || 'https://api.ledgerworkspace.com').replace(/\/$/, '')}/mcp`;
const MCP_OAUTH_ISSUER = (process.env.PUBLIC_BACKEND_URL?.trim() || 'https://api.ledgerworkspace.com').replace(/\/$/, '');
const MCP_OAUTH_FRONTEND = (process.env.PUBLIC_FRONTEND_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'https://ledgerworkspace.com').replace(/\/$/, '');
const MCP_OAUTH_SCOPES = new Set(MCP_SCOPES);
const MCP_OAUTH_WRITE_SCOPES = new Set(MCP_WRITE_SCOPES);
const MCP_OAUTH_ACCESS_TTL_SECONDS = 15 * 60;
const MCP_OAUTH_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const MCP_OAUTH_AUTH_TTL_SECONDS = 10 * 60;
const createMcpOAuthSecret = (prefix) => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
const hashMcpOAuthSecret = (value) => hashMcpValue(value);
const mcpOAuthJson = (res, status, payload) => res.status(status).type('application/json').json(payload);
const oauthScopes = (value) => [...new Set(String(value ?? '').split(/[\s]+/).map((scope) => scope.trim()).filter(Boolean))];
const oauthScopeString = (scopes) => [...new Set(scopes)].join(' ');

const validateMcpRedirectUris = (redirectUris) => {
  if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 20) throw Object.assign(new Error('redirect_uris must contain 1 to 20 URLs.'), { statusCode: 400 });
  return redirectUris.map((value) => {
    if (typeof value !== 'string' || value.length > 2_048) throw Object.assign(new Error('Invalid redirect URI.'), { statusCode: 400 });
    let parsed;
    try { parsed = new URL(value); } catch { throw Object.assign(new Error('Invalid redirect URI.'), { statusCode: 400 }); }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.hash || parsed.username || parsed.password || parsed.hostname.includes('*') || (!localhost && parsed.protocol !== 'https:') || (localhost && !['http:', 'https:'].includes(parsed.protocol))) throw Object.assign(new Error('Redirect URIs must use HTTPS and cannot contain fragments or wildcards.'), { statusCode: 400 });
    return parsed.toString();
  });
};

const oauthClientAuthentication = (req, body) => {
  const header = String(req.headers.authorization ?? '');
  if (/^Basic\s+/i.test(header)) {
    try {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      return { clientId: decodeURIComponent(separator >= 0 ? decoded.slice(0, separator) : decoded), clientSecret: separator >= 0 ? decodeURIComponent(decoded.slice(separator + 1)) : '' };
    } catch { return { clientId: '', clientSecret: '' }; }
  }
  return { clientId: String(body.client_id ?? ''), clientSecret: String(body.client_secret ?? '') };
};

const loadMcpOAuthClient = async (clientId) => {
  if (!clientId) return null;
  const result = await supabase.from('mcp_oauth_clients').select('id, client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, disabled_at').eq('client_id', clientId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.disabled_at) return null;
  return result.data;
};

const mcpOAuthRedirect = (redirectUri, params) => {
  const target = new URL(redirectUri);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null) target.searchParams.set(key, String(value)); });
  return target.toString();
};

const mcpOAuthError = (code, description) => Object.assign(new Error(description), { statusCode: 400, oauthCode: code });

const writeMcpAuditLog = async ({ connectionId = null, userId = null, workspaceId = null, action, toolName = null, metadata = {} }) => {
  const result = await supabase.from('mcp_audit_logs').insert({
    connection_id: connectionId,
    user_id: userId,
    workspace_id: workspaceId,
    action,
    tool_name: toolName,
    metadata,
  });
  if (result.error) console.error('Failed to write MCP audit log:', result.error.message);
};

const loadMcpConnection = async (token) => {
  if (!token || !token.startsWith('ledger_mcp_')) return null;
  const result = await supabase.from('mcp_connections')
    .select('id, user_id, client_name, status, expires_at, revoked_at')
    .eq('credential_hash', hashMcpValue(token)).maybeSingle();
  if (result.error) throw result.error;
  const connection = result.data;
  if (!connection || connection.status !== 'active' || connection.revoked_at || new Date(connection.expires_at).getTime() <= Date.now()) return null;

  const [scopeResult, workspaceResult] = await Promise.all([
    supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', connection.id),
    supabase.from('mcp_connection_workspaces').select('workspace_id').eq('connection_id', connection.id),
  ]);
  if (scopeResult.error || workspaceResult.error) throw scopeResult.error || workspaceResult.error;
  const workspaceIds = (workspaceResult.data ?? []).map((row) => row.workspace_id).filter(Boolean);
  if (workspaceIds.length !== 1) return null;
  const access = await getWorkspaceAccess(connection.user_id, workspaceIds[0]);
  if (!access) return null;
  void supabase.from('mcp_connections').update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', connection.id);
  return { connection, userId: connection.user_id, workspaceId: workspaceIds[0], role: access.role, scopes: (scopeResult.data ?? []).map((row) => row.scope) };
};

const loadMcpOAuthAccessToken = async (token) => {
  if (!token || !token.startsWith('ledger_mcp_access_')) return null;
  const result = await supabase.from('mcp_oauth_access_tokens').select('id, connection_id, client_id, user_id, workspace_id, scopes, resource, expires_at, revoked_at').eq('token_hash', hashMcpOAuthSecret(token)).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row || row.resource !== MCP_OAUTH_RESOURCE || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  const [connection, client, access, connectionScopes] = await Promise.all([
    supabase.from('mcp_connections').select('id, client_name, status, expires_at, revoked_at').eq('id', row.connection_id).maybeSingle(),
    supabase.from('mcp_oauth_clients').select('id, client_name, disabled_at').eq('id', row.client_id).maybeSingle(),
    getWorkspaceAccess(row.user_id, row.workspace_id),
    supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', row.connection_id),
  ]);
  if (connection.error || client.error || connectionScopes.error || access === null) throw connection.error || client.error || connectionScopes.error || Object.assign(new Error('Workspace access is no longer available.'), { statusCode: 401 });
  if (!connection.data || connection.data.status !== 'active' || connection.data.revoked_at || new Date(connection.data.expires_at).getTime() <= Date.now() || !client.data || client.data.disabled_at) return null;
  void supabase.from('mcp_oauth_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);
  void supabase.from('mcp_connections').update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.connection_id);
  const scopes = (row.scopes ?? []).filter((scope) => (connectionScopes.data ?? []).some((current) => current.scope === scope));
  return { connection: { ...connection.data, client_name: client.data.client_name }, userId: row.user_id, workspaceId: row.workspace_id, role: access.role, scopes, oauthClientId: row.client_id, oauthTokenId: row.id };
};

const mcpAuthMiddleware = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    const context = await loadMcpOAuthAccessToken(token) || await loadMcpConnection(token);
    if (!context) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${MCP_OAUTH_ISSUER}/.well-known/oauth-protected-resource/mcp"`);
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    req.mcpContext = context;
    req.authUser = { id: context.userId };
    await writeMcpAuditLog({ connectionId: context.connection.id, userId: context.userId, workspaceId: context.workspaceId, action: 'credential.used' });
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
};

const requireMcpScope = (req, scope) => {
  if (!req.mcpContext?.scopes?.includes(scope)) {
    const error = new Error('Required scope is missing.');
    error.statusCode = 403;
    throw error;
  }
};

const createMcpScopeUpgradeSession = async ({ connectionId, userId, requestedScopes }) => {
  if (!Array.isArray(requestedScopes) || !requestedScopes.length || requestedScopes.some((scope) => !MCP_WRITE_SCOPES.includes(scope))) throw new Error('Only supported write permissions can be requested.');
  const connection = await supabase.from('mcp_connections').select('id, user_id, client_name, status, expires_at').eq('id', connectionId).eq('user_id', userId).maybeSingle();
  if (connection.error) throw connection.error;
  if (!connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) { const error = new Error('Connection expired or revoked.'); error.statusCode = 401; throw error; }
  const [scopes, bindings] = await Promise.all([
    supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', connectionId),
    supabase.from('mcp_connection_workspaces').select('workspace_id').eq('connection_id', connectionId),
  ]);
  if (scopes.error || bindings.error) throw scopes.error || bindings.error;
  const currentScopes = (scopes.data ?? []).map((row) => row.scope);
  const newScopes = [...new Set(requestedScopes)].filter((scope) => !currentScopes.includes(scope));
  if (!newScopes.length || (bindings.data ?? []).length !== 1) { const error = new Error('No additional permissions are available.'); error.statusCode = 409; throw error; }
  const workspaceId = bindings.data[0].workspace_id;
  await requireWorkspaceAccess(userId, workspaceId, 'member');
  const code = createMcpCode();
  const pollSecret = crypto.randomBytes(24).toString('base64url');
  const session = await supabase.from('mcp_scope_upgrade_sessions').insert({ connection_id: connectionId, user_id: userId, workspace_id: workspaceId, user_code_hash: hashMcpValue(code), poll_secret_hash: hashMcpValue(pollSecret), requested_scopes: newScopes, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id, expires_at').single();
  if (session.error) throw session.error;
  await writeMcpAuditLog({ connectionId, userId, workspaceId, action: 'scope_upgrade.initiated', metadata: { requested_scopes: newScopes } });
  return { sessionId: session.data.id, verificationCode: code, pollSecret, clientName: connection.data.client_name, currentScopes, requestedScopes: newScopes, authorizationUrl: getMcpScopeUpgradeAuthorizeUrl(session.data.id, code), expiresAt: session.data.expires_at };
};

const createMcpWorkspaceSwitchSession = async ({ connectionId, userId, requestedWorkspaceId = null }) => {
  const connection = await supabase.from('mcp_connections').select('id, user_id, client_name, status, expires_at').eq('id', connectionId).eq('user_id', userId).maybeSingle();
  if (connection.error) throw connection.error;
  if (!connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) { const error = new Error('Connection expired or revoked.'); error.statusCode = 401; throw error; }
  const [binding, scopes] = await Promise.all([
    supabase.from('mcp_connection_workspaces').select('workspace_id').eq('connection_id', connectionId).maybeSingle(),
    supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', connectionId),
  ]);
  if (binding.error || scopes.error || !binding.data) throw binding.error || scopes.error || new Error('Workspace binding is unavailable.');
  if (requestedWorkspaceId) {
    const access = await getWorkspaceAccess(userId, requestedWorkspaceId);
    if (!access) { const error = new Error('That workspace is not available to this Ledger account.'); error.statusCode = 404; throw error; }
  }
  if ((scopes.data ?? []).some((row) => MCP_WRITE_SCOPES.includes(row.scope))) {
    if (requestedWorkspaceId) await requireWorkspaceAccess(userId, requestedWorkspaceId, 'member');
  }
  const code = createMcpCode();
  const pollSecret = crypto.randomBytes(24).toString('base64url');
  const session = await supabase.from('mcp_workspace_switch_sessions').insert({ connection_id: connectionId, user_id: userId, current_workspace_id: binding.data.workspace_id, requested_workspace_id: requestedWorkspaceId || null, user_code_hash: hashMcpValue(code), poll_secret_hash: hashMcpValue(pollSecret), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id, expires_at').single();
  if (session.error) throw session.error;
  await writeMcpAuditLog({ connectionId, userId, workspaceId: binding.data.workspace_id, action: 'workspace_switch.initiated', metadata: { requested_workspace_id: requestedWorkspaceId || null } });
  const base = MCP_OAUTH_FRONTEND;
  return { sessionId: session.data.id, verificationCode: code, pollSecret, clientName: connection.data.client_name, currentWorkspaceId: binding.data.workspace_id, requestedWorkspaceId: requestedWorkspaceId || null, authorizationUrl: `${base}/integrations/mcp/switch-workspace?session_id=${encodeURIComponent(session.data.id)}&code=${encodeURIComponent(code)}`, expiresAt: session.data.expires_at };
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

const addDaysToDate = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const getMobileUpcomingWindow = (dateKey, daysAhead = 7) => {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = addDaysToDate(start, daysAhead);
  end.setHours(23, 59, 59, 999);

  return {
    end,
    endDateKey: getLocalDateKey(end) ?? dateKey,
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

const getTaskPriorityLabel = (priority) => {
  const normalized = String(priority ?? '').trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'highest') return 'High';
  if (normalized === 'high') return 'High';
  if (normalized === 'medium' || normalized === 'normal') return 'Medium';
  if (normalized === 'low' || normalized === 'lowest') return 'Low';
  return 'Low';
};

const loadMobileTodayData = async ({ userId, scope, dateKey }) => {
  const selectedDateKey = parseMobileDateKey(dateKey);
  const currentDateKey = getLocalDateKey(new Date());
  const isCurrentDate = selectedDateKey === currentDateKey;
  const { startIso, endIso } = getMobileDateWindow(selectedDateKey);
  const { endDateKey: upcomingEndDateKey, endIso: upcomingEndIso } = getMobileUpcomingWindow(
    selectedDateKey,
    7
  );
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
      notes: [],
    };
  }

  const explicitTaskPromise = (async () => {
    const attempts = [
      {
        columns: `${MOBILE_TODAY_TASK_SELECT_COLUMNS}, show_in_today, is_today_focus, task_horizon`,
        filter: 'show_in_today.eq.true,is_today_focus.eq.true,task_horizon.eq.today',
      },
      {
        columns: `${MOBILE_TODAY_TASK_SELECT_COLUMNS}, show_in_today, is_today_focus`,
        filter: 'show_in_today.eq.true,is_today_focus.eq.true',
      },
      {
        columns: `${MOBILE_TODAY_TASK_SELECT_COLUMNS}, task_horizon`,
        filter: 'task_horizon.eq.today',
      },
    ];

    for (const attempt of attempts) {
      const result = await supabase
        .from('tasks')
        .select(attempt.columns)
        .in('workspace_id', workspaceIds)
        .neq('status', 'completed')
        .or(attempt.filter)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (!result.error) return result;
      if (!isMissingTaskTodayColumnError(result.error)) return result;
    }

    return { data: [], error: null };
  })();

  const upcomingTaskPromise = (async () => {
    const result = await supabase
      .from('tasks')
      .select(MOBILE_TODAY_TASK_SELECT_COLUMNS)
      .in('workspace_id', workspaceIds)
      .neq('status', 'completed')
      .gt('due_date', selectedDateKey)
      .lte('due_date', upcomingEndDateKey)
      .not('due_time', 'is', null)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(500);

    return result;
  })();

  const [workspaceResult, taskResult, explicitTaskResult, upcomingTaskResult, reminderResult, eventResult, projectResult, noteResult, captureCountResult, captureItemsResult] =
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
      explicitTaskPromise,
      upcomingTaskPromise,
      withReminderTable((table) =>
        supabase
          .from(table)
          .select(reminderSelectColumns)
          .in('workspace_id', workspaceIds)
          .or('status.eq.active,status.eq.overdue')
          .is('dismissed_at', null)
          .is('completed_at', null)
          .lte('remind_at', upcomingEndIso)
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
        .lte('start_at', upcomingEndIso)
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
        .from('notes')
        .select('id, workspace_id, title, preview, updated_at, created_at')
        .in('workspace_id', workspaceIds)
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('inbox_items')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds)
        .eq('status', 'unprocessed'),
      supabase
        .from('inbox_items')
        .select(inboxItemSelectColumns)
        .in('workspace_id', workspaceIds)
        .eq('status', 'unprocessed')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

  const queryErrors = [
    workspaceResult.error,
    taskResult.error,
    explicitTaskResult?.error,
    upcomingTaskResult?.error,
    reminderResult.error,
    eventResult.error,
    projectResult.error,
    noteResult.error,
    captureCountResult.error,
    captureItemsResult.error,
  ].filter(Boolean);
  if (queryErrors.length > 0) throw queryErrors[0];

  const workspaceById = new Map((workspaceResult.data ?? []).map((workspace) => [workspace.id, workspace]));
  const taskRows = Array.isArray(taskResult.data) ? taskResult.data : [];
  const explicitTaskRows = Array.isArray(explicitTaskResult?.data) ? explicitTaskResult.data : [];
  const upcomingTaskRows = Array.isArray(upcomingTaskResult?.data) ? upcomingTaskResult.data : [];
  const reminderRows = Array.isArray(reminderResult.data) ? reminderResult.data : [];
  const eventRows = Array.isArray(eventResult.data) ? eventResult.data : [];
  const projectRows = Array.isArray(projectResult.data) ? projectResult.data : [];
  const noteRows = Array.isArray(noteResult.data) ? noteResult.data : [];
  const combinedTaskRows = [...taskRows, ...explicitTaskRows, ...upcomingTaskRows];
  const uniqueTaskRows = [];
  const seenTaskIds = new Set();
  for (const row of combinedTaskRows) {
    if (!row?.id) continue;
    const taskId = String(row.id);
    if (seenTaskIds.has(taskId)) continue;
    seenTaskIds.add(taskId);
    uniqueTaskRows.push(row);
  }

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

  const focusTaskIds = new Set(
    explicitTaskRows.filter((row) => row?.is_today_focus).map((row) => String(row.id))
  );
  const explicitTaskIds = new Set(explicitTaskRows.map((row) => String(row.id)));
  const upcomingTaskIds = new Set(upcomingTaskRows.map((row) => String(row.id)));

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
    return false;
  };

  const isTaskSelectedDate = (task) => Boolean(task?.due_date && String(task.due_date) === selectedDateKey);

  const buildTaskPayload = (task, overrides = {}) => {
    const dueAt = toTaskDueAt(task);
    const dueDateKey = String(task.due_date ?? '').trim();
    const workspaceContext = buildWorkspaceContext(task.workspace_id);
    const hasProject = Boolean(task.project_id);
    const isOverdue = overrides.isOverdue ?? isTaskOverdueForSelectedDate(task);
    const type = overrides.type ?? (hasProject ? 'project_action' : 'task');
    const sourceType = overrides.sourceType ?? (hasProject ? 'project_action' : 'task');
    const meta = overrides.meta ?? (isOverdue ? 'Overdue' : hasProject ? 'Project action' : 'Due today');
    const dueLabel = overrides.dueLabel ?? (isOverdue ? 'Overdue' : 'Today');
    const dateLabel =
      overrides.dateLabel ??
      (dueAt
        ? formatNotificationDateTime(dueAt)
        : dueDateKey
        ? formatNotificationDate(`${dueDateKey}T00:00:00`)
        : null);
    const timeLabel =
      overrides.timeLabel ??
      (dueAt && String(task.due_date ?? '') === selectedDateKey ? formatNotificationTime(dueAt) ?? null : null);

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
      startsAt: dueAt?.toISOString() ?? null,
      timeLabel,
      dateLabel,
      sortAt: dueAt?.toISOString() ?? `${task.due_date ?? selectedDateKey}T00:00:00.000Z`,
      priorityRank: getTaskPriorityRank(task.priority),
    };
  };

  for (const task of uniqueTaskRows) {
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
        urgency: getTaskPriorityLabel(task.priority),
      });
      addTodayItem(focusItem, taskKey);
      continue;
    }

    if (explicitTaskIds.has(String(task.id))) {
      const dueDateKey = String(task.due_date ?? '').trim();
      const dueAt = toTaskDueAt(task);
      const isDueOnSelectedDate = dueDateKey === selectedDateKey;
      const explicitDueLabel = isDueOnSelectedDate
        ? 'Today'
        : dueAt
          ? formatNotificationDateTime(dueAt) ?? formatNotificationDate(dueAt)
          : dueDateKey
            ? formatNotificationDate(`${dueDateKey}T00:00:00`)
            : 'Today';
      const explicitItem = buildTaskPayload(task, {
        type: task.project_id ? 'project_action' : 'task',
        sourceType: task.project_id ? 'project_action' : 'task',
        meta: task.project_id
          ? 'Project action'
          : isDueOnSelectedDate
            ? 'Due today'
            : 'Due later',
        dueLabel: explicitDueLabel,
      });
      addTodayItem(explicitItem, taskKey);
      continue;
    }

    if (upcomingTaskIds.has(String(task.id))) {
      const dueAt = toTaskDueAt(task);
      const upcomingItem = {
        id: `task:${task.id}`,
        type: 'task',
        title: task.title ?? 'Untitled task',
        workspaceId: task.workspace_id,
        workspaceName: workspaceById.get(task.workspace_id)?.name ?? null,
        timeLabel: dueAt ? formatNotificationTime(dueAt) ?? null : null,
        dateLabel:
          dueAt
            ? formatNotificationDateTime(dueAt)
            : task.due_date
            ? formatNotificationDate(`${String(task.due_date)}T00:00:00`)
            : null,
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
    const reminderKey = `reminder:${reminder.id}`;

    if (reminderDateKey > selectedDateKey && hasSpecificTime) {
      addUpcomingItem(
        {
          id: reminderKey,
          type: 'reminder',
          title: reminder.title ?? 'Untitled reminder',
          workspaceId: reminder.workspace_id,
          workspaceName: workspaceById.get(reminder.workspace_id)?.name ?? null,
          timeLabel: formatNotificationTime(remindAt) ?? null,
          dateLabel: formatNotificationDateTime(remindAt),
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

    if (reminderDateKey === selectedDateKey && hasSpecificTime && !isOverdue) {
      addTodayItem(
        {
          id: reminderKey,
          type: 'reminder',
          title: reminder.title ?? 'Untitled reminder',
          workspaceId: reminder.workspace_id,
          workspaceName: workspaceById.get(reminder.workspace_id)?.name ?? null,
          meta: 'Due today',
          dueLabel: 'Today',
          status: 'active',
          sourceType: 'reminder',
          sourceId: reminder.id,
          sortAt: remindAt.toISOString(),
          startsAt: remindAt.toISOString(),
          timeLabel: formatNotificationTime(remindAt) ?? null,
          dateLabel: formatNotificationDateTime(remindAt),
        },
        reminderKey
      );
      continue;
    }

    if (reminderDateKey > selectedDateKey && !hasSpecificTime) {
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
          startsAt: remindAt.toISOString(),
          dateLabel: formatNotificationDateTime(remindAt),
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
    const eventDateKey = getLocalDateKey(startAt);
    if (!eventDateKey) continue;
    if (eventDateKey < selectedDateKey) continue;
    if (eventDateKey === selectedDateKey && isCurrentDate) {
      const eventEndAt = new Date(event.end_at ?? event.start_at ?? 0);
      if (Number.isNaN(eventEndAt.getTime()) || eventEndAt.getTime() <= now.getTime()) {
        continue;
      }
    }

    const eventKey = `calendar_event:${event.id}`;
    const eventItem = {
      id: eventKey,
      type: 'event',
      title: event.title ?? 'Untitled event',
      workspaceId: event.workspace_id,
      workspaceName: workspaceById.get(event.workspace_id)?.name ?? null,
      timeLabel: formatNotificationTime(startAt) ?? null,
      dateLabel: formatNotificationDateTime(startAt),
      startsAt: startAt.toISOString(),
      endsAt: event.end_at ?? null,
      status: 'upcoming',
      sourceType: 'calendar_event',
      sourceId: event.id,
      sortAt: startAt.toISOString(),
    };

    if (eventDateKey === selectedDateKey) {
      addTodayItem(
        {
          ...eventItem,
          meta: 'Event',
          dueLabel: 'Today',
          status: 'active',
          sourceType: 'calendar_event',
          sourceId: event.id,
          startsAt: startAt.toISOString(),
        },
        eventKey
      );
      continue;
    }

    addUpcomingItem(
      {
        ...eventItem,
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

    const isProjectTimeBased = hasExplicitTimeComponent(projectEndDateText);
    const isProjectOverdue =
      projectDateKey < selectedDateKey ||
      (projectDateKey === selectedDateKey && isCurrentDate && isProjectTimeBased && projectEndAt.getTime() <= now.getTime());
    const projectKey = `project:${project.id}`;
    if (projectDateKey > upcomingEndDateKey) continue;
    if (projectDateKey > selectedDateKey && !isProjectTimeBased) continue;

    if (isProjectTimeBased && projectDateKey > selectedDateKey) {
      addUpcomingItem(
        {
          id: `deadline:${project.id}`,
          type: 'deadline',
          title: project.name ?? 'Untitled project',
          workspaceId: project.workspace_id,
          workspaceName: workspaceById.get(project.workspace_id)?.name ?? null,
          timeLabel: formatNotificationTime(projectEndAt) ?? null,
          dateLabel: formatNotificationDateTime(projectEndAt),
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

    if (isProjectTimeBased && projectDateKey === selectedDateKey) {
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
          timeLabel: formatNotificationTime(projectEndAt) ?? null,
          dateLabel: formatNotificationDateTime(projectEndAt),
          startsAt: projectEndAt.toISOString(),
          sortAt: projectEndAt.toISOString(),
          priorityRank: 0,
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
          dateLabel: formatNotificationDateTime(projectEndAt),
          startsAt: projectEndAt.toISOString(),
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
      if (item.type === 'event') return 0;
      if (item.type === 'focus') return 1;
      if (item.status === 'overdue') return 2;
      if (item.type === 'project_action') return 4;
      return 3;
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
    dateLabel: item.created_at ? formatNotificationDateTime(item.created_at) : null,
  }));
  const notes = noteRows
    .filter((row) => Boolean(row?.id) && Boolean(row?.workspace_id))
    .map((row) => {
      const body = String(row.preview ?? '');
      return {
        id: `note:${row.id}`,
        type: 'note',
        title: row.title ?? 'Untitled note',
        workspaceId: row.workspace_id,
        workspaceName: workspaceById.get(row.workspace_id)?.name ?? null,
        sourceType: 'note',
        sourceId: row.id,
        body: body || null,
        updatedAt: row.updated_at ?? row.created_at ?? null,
        createdAt: row.created_at ?? null,
      };
    });

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
    notes,
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

const SLACK_ACTIVITY_BOT_SCOPES = ['app_mentions:read', 'channels:history', 'groups:history'];

const getFigmaRedirectUri = () => {
  const explicit = process.env.FIGMA_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const publicBackendUrl = process.env.PUBLIC_BACKEND_URL?.trim();
  return publicBackendUrl
    ? `${publicBackendUrl.replace(/\/$/, '')}/api/integrations/figma/oauth/callback`
    : null;
};

const getFigmaStateSecret = () =>
  process.env.FIGMA_STATE_SECRET?.trim() || process.env.SLACK_STATE_SECRET?.trim() || 'ledger-figma-dev-state';

const createFigmaOAuthState = ({ workspaceId, userId }) => {
  const payload = {
    workspace_id: workspaceId,
    user_id: userId,
    nonce: crypto.randomBytes(24).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getFigmaStateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
};

const verifyFigmaOAuthState = (state) => {
  const [encoded, signature] = String(state ?? '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', getFigmaStateSecret()).update(encoded).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  const payload = safeJson(Buffer.from(encoded, 'base64url').toString('utf8'), null);
  const issuedAt = Number(payload?.iat ?? 0);
  if (!payload?.workspace_id || !payload?.user_id || !payload?.nonce || !issuedAt) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > 10 * 60) return null;
  return { ...payload, state_hash: crypto.createHash('sha256').update(String(state)).digest('hex') };
};

const buildFigmaAuthorizeUrl = ({ workspaceId, userId, state }) => {
  const clientId = process.env.FIGMA_CLIENT_ID?.trim();
  const redirectUri = getFigmaRedirectUri();
  if (!clientId || !redirectUri) {
    const error = new Error('Figma OAuth is not configured');
    error.statusCode = 500;
    throw error;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'current_user:read,file_content:read',
    state: state || createFigmaOAuthState({ workspaceId, userId }),
    response_type: 'code',
  });
  return `https://www.figma.com/oauth?${params.toString()}`;
};

const getSlackStateSecret = () =>
  process.env.SLACK_STATE_SECRET?.trim() ||
  process.env.SLACK_SIGNING_SECRET?.trim() ||
  'ledger-slack-dev-state';

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');

const createSlackOAuthState = ({ workspaceId, installedBy, userId, flow = 'workspace' }) => {
  const payload = {
    workspace_id: workspaceId,
    ...(installedBy ? { installed_by: installedBy } : {}),
    ...(userId ? { user_id: userId } : {}),
    flow,
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
  if (!payload?.workspace_id || (!payload?.installed_by && !payload?.user_id) || !issuedAt) return null;
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
    scope: 'commands,chat:write,app_mentions:read,channels:history,groups:history',
    redirect_uri: redirectUri,
    state: createSlackOAuthState({ workspaceId, installedBy }),
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
};

const buildSlackIdentityAuthorizeUrl = ({ workspaceId, userId, teamId }) => {
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
    user_scope: 'channels:read,groups:read,mpim:read,users:read,users:read.email',
    redirect_uri: redirectUri,
    state: createSlackOAuthState({ workspaceId, userId, flow: 'personal_identity' }),
  });
  if (teamId) params.set('team', teamId);
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

const buildSlackIdentityCompleteHtml = ({ success, message = '' }) => {
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Slack identity</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffbf7;color:#111827;font:14px system-ui,-apple-system,sans-serif}.content{width:min(360px,calc(100vw - 40px));text-align:center}h1{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}p{margin:0;color:#6b7280;line-height:1.5}.button{display:inline-flex;margin-top:18px;padding:9px 15px;border-radius:999px;background:#ff5f40;color:white;text-decoration:none;font-weight:600}</style></head><body><main class="content"><h1>${success ? 'Slack identity connected' : 'Slack identity was not connected'}</h1><p>${safeMessage || (success ? 'Return to Ledger to continue.' : 'Authorization was cancelled or denied.')}</p>${success ? '<a class="button" href="ledger://slack">Open Ledger</a><script>setTimeout(()=>{try{window.location.href="ledger://slack"}catch{}} ,250)</script>' : ''}</main></body></html>`;
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

const getSlackEventIdentity = (payload) => {
  const event = payload?.event ?? {};
  const source = event.subtype === 'message_changed' ? (event.message ?? event) : event.subtype === 'message_deleted' ? (event.previous_message ?? event) : event;
  const channelId = event.channel ?? source.channel ?? null;
  const messageTs = source.ts ?? event.ts ?? null;
  const rootThreadTs = source.thread_ts ?? event.thread_ts ?? messageTs;
  return {
    event,
    source,
    channelId,
    messageTs,
    rootThreadTs,
    authorSlackUserId: source.user ?? event.user ?? null,
    messageText: source.text ?? event.text ?? null,
    isEdited: event.subtype === 'message_changed',
    isDeleted: event.subtype === 'message_deleted',
  };
};

const getSlackEventId = (payload) => {
  if (payload?.event_id) return String(payload.event_id);
  const identity = getSlackEventIdentity(payload);
  return crypto.createHash('sha256').update(JSON.stringify({
    team: payload?.team_id ?? payload?.event?.team ?? null,
    channel: identity.channelId,
    ts: identity.messageTs,
    type: payload?.event?.type ?? null,
    subtype: payload?.event?.subtype ?? null,
  })).digest('hex');
};

const upsertSlackActivityMatch = async ({ workspaceId, activityId, watchId = null, contextId = null, ledgerUserId = null, matchType }) => {
  const result = await supabase.from('slack_activity_matches').insert({
    workspace_id: workspaceId,
    activity_id: activityId,
    slack_watch_id: watchId,
    slack_context_id: contextId,
    ledger_user_id: ledgerUserId,
    match_type: matchType,
  });
  if (result.error && result.error.code !== '23505') throw result.error;
};

const updateSlackWatchActivity = async (watch) => {
  const result = await supabase.from('slack_watches').update({
    last_activity_at: new Date().toISOString(),
    activity_count: Number(watch.activity_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', watch.id).eq('status', 'active');
  if (result.error) throw result.error;
};

const processSlackEventDelivery = async (deliveryId) => {
  const deliveryResult = await supabase.from('slack_event_deliveries').select('id, workspace_id, integration_account_id, slack_team_id, slack_event_id, payload, retry_count, status').eq('id', deliveryId).maybeSingle();
  if (deliveryResult.error || !deliveryResult.data) return;
  const delivery = deliveryResult.data;
  const startedAt = Date.now();
  const claim = await supabase.from('slack_event_deliveries').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', delivery.id).in('status', ['received', 'failed']).select('id').maybeSingle();
  if (claim.error || !claim.data?.id) return;

  try {
    const account = await findSlackIntegrationAccount(delivery.slack_team_id);
    if (!account?.workspace_id || (delivery.workspace_id && delivery.workspace_id !== account.workspace_id)) throw Object.assign(new Error('Slack workspace is not connected'), { permanent: true, code: 'missing_workspace' });
    const workspaceId = account.workspace_id;
    const payload = delivery.payload ?? {};
    const eventType = payload.event?.type ?? '';
    const identity = getSlackEventIdentity(payload);

    if (['member_left_channel', 'group_left', 'channel_left'].includes(eventType)) {
      const identities = await supabase.from('slack_identities').select('ledger_user_id, slack_user_id').eq('workspace_id', workspaceId).eq('slack_team_id', delivery.slack_team_id).eq('slack_user_id', payload.event?.user ?? '').eq('status', 'connected');
      if (identities.error && !isMissingRelationError(identities.error, 'slack_identities')) throw identities.error;
      for (const linked of identities.data ?? []) {
        await supabase.from('slack_watches').update({ status: 'access_lost', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('owner_user_id', linked.ledger_user_id).eq('slack_conversation_id', identity.channelId).eq('status', 'active');
        console.info('[slack] watch access lost', { workspaceId, channelId: identity.channelId, ledgerUserId: linked.ledger_user_id });
      }
    } else if (['message', 'app_mention'].includes(eventType) && identity.channelId && identity.messageTs) {
      const watchResult = await supabase.from('slack_watches').select(`${slackWatchSelect}, activity_count`).eq('workspace_id', workspaceId).eq('integration_account_id', account.id).eq('slack_conversation_id', identity.channelId).eq('status', 'active');
      if (watchResult.error) throw watchResult.error;
      const watches = watchResult.data ?? [];
      const linkedIdentities = await supabase.from('slack_identities').select('ledger_user_id, slack_user_id').eq('workspace_id', workspaceId).eq('slack_team_id', delivery.slack_team_id).eq('status', 'connected');
      if (linkedIdentities.error && !isMissingRelationError(linkedIdentities.error, 'slack_identities')) throw linkedIdentities.error;
      const mentionIds = [...String(identity.messageText ?? '').matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]);
      const mentionMatches = (linkedIdentities.data ?? []).filter((linked) => mentionIds.includes(linked.slack_user_id));
      const threadRoot = identity.rootThreadTs ?? identity.messageTs;
      const rootActivity = identity.rootThreadTs && identity.rootThreadTs !== identity.messageTs
        ? await supabase.from('slack_activities').select('author_slack_user_id').eq('workspace_id', workspaceId).eq('slack_team_id', delivery.slack_team_id).eq('slack_conversation_id', identity.channelId).eq('slack_message_ts', identity.rootThreadTs).maybeSingle()
        : { data: null, error: null };
      if (rootActivity.error) throw rootActivity.error;
      const contextResult = await supabase.from('slack_contexts').select('id, message_author_slack_id, captured_message_ts').eq('workspace_id', workspaceId).eq('slack_team_id', delivery.slack_team_id).eq('slack_channel_id', identity.channelId).eq('root_message_ts', threadRoot).maybeSingle();
      if (contextResult.error && !isMissingRelationError(contextResult.error, 'slack_contexts')) throw contextResult.error;
      const context = contextResult.data ?? null;
      const contextReplyMatches = context?.message_author_slack_id ? (linkedIdentities.data ?? []).filter((linked) => linked.slack_user_id === context.message_author_slack_id) : [];
      const replyMatches = rootActivity.data?.author_slack_user_id ? (linkedIdentities.data ?? []).filter((linked) => linked.slack_user_id === rootActivity.data.author_slack_user_id) : contextReplyMatches;
      const followedUsers = context ? await supabase.from('slack_context_follows').select('ledger_user_id').eq('workspace_id', workspaceId).eq('slack_context_id', context.id) : { data: [], error: null };
      if (followedUsers.error) throw followedUsers.error;
      const contextLinkUsers = context ? await supabase.from('slack_context_links').select('created_by').eq('workspace_id', workspaceId).eq('slack_context_id', context.id).not('created_by', 'is', null) : { data: [], error: null };
      if (contextLinkUsers.error) throw contextLinkUsers.error;
      const activeContext = context && ((followedUsers.data ?? []).length || (contextLinkUsers.data ?? []).length) ? context : null;
      const matchingWatches = watches.filter((watch) => watch.watch_type === 'shared' || watch.owner_user_id);
      const hasMatch = matchingWatches.length || mentionMatches.length || activeContext || replyMatches.length || (followedUsers.data ?? []).length || (contextLinkUsers.data ?? []).length;
      if (hasMatch) {
        const conversationType = matchingWatches[0]?.conversation_type ?? 'public_channel';
        const activityType = identity.isDeleted ? 'message_deleted' : identity.isEdited ? 'message_edited' : mentionMatches.length ? 'mention' : identity.rootThreadTs && identity.rootThreadTs !== identity.messageTs ? 'thread_reply' : 'message';
        const permalink = `https://app.slack.com/client/${encodeURIComponent(delivery.slack_team_id)}/${encodeURIComponent(identity.channelId)}/p${String(identity.messageTs).replace('.', '')}`;
        const activity = await supabase.from('slack_activities').upsert({
          workspace_id: workspaceId,
          integration_account_id: account.id,
          slack_team_id: delivery.slack_team_id,
          slack_event_id: delivery.slack_event_id,
          slack_conversation_id: identity.channelId,
          slack_message_ts: identity.messageTs,
          slack_root_thread_ts: threadRoot,
          activity_type: activityType,
          conversation_type: conversationType,
          author_slack_user_id: identity.authorSlackUserId,
          target_slack_user_id: mentionMatches[0]?.slack_user_id ?? replyMatches[0]?.slack_user_id ?? null,
          message_text: identity.isDeleted ? null : identity.messageText,
          permalink,
          source_created_at: parseSlackMessageTimestamp(identity.messageTs),
          processed_at: new Date().toISOString(),
          is_edited: identity.isEdited,
          is_deleted: identity.isDeleted,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,slack_team_id,slack_conversation_id,slack_message_ts' }).select('id').single();
        if (activity.error) throw activity.error;
        for (const watch of matchingWatches) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, watchId: watch.id, ledgerUserId: watch.watch_type === 'personal' ? watch.owner_user_id : null, matchType: watch.watch_type === 'personal' ? 'personal_watch' : 'shared_watch' });
        for (const linked of mentionMatches) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, ledgerUserId: linked.ledger_user_id, matchType: 'mention' });
        for (const linked of replyMatches) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, ledgerUserId: linked.ledger_user_id, contextId: activeContext?.id ?? null, matchType: 'reply' });
        for (const followed of followedUsers.data ?? []) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, ledgerUserId: followed.ledger_user_id, contextId: activeContext?.id ?? null, matchType: 'reply' });
        for (const linked of contextLinkUsers.data ?? []) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, ledgerUserId: linked.created_by, contextId: activeContext?.id ?? null, matchType: 'captured_context' });
        if (activeContext) await upsertSlackActivityMatch({ workspaceId, activityId: activity.data.id, contextId: activeContext.id, matchType: 'captured_context' });
        for (const watch of matchingWatches) await updateSlackWatchActivity(watch);
        if (activeContext) {
          if (identity.rootThreadTs && identity.rootThreadTs !== identity.messageTs) {
            await upsertSlackThreadReply({ workspaceId, contextId: activeContext.id, reply: identity.source, isEdited: identity.isEdited, isDeleted: identity.isDeleted });
            const countResult = await supabase.from('slack_thread_replies').select('id, source_created_at').eq('workspace_id', workspaceId).eq('slack_context_id', activeContext.id).order('source_created_at', { ascending: false });
            if (countResult.error) throw countResult.error;
            await supabase.from('slack_contexts').update({ reply_count: countResult.data?.length ?? 0, latest_reply_at: countResult.data?.[0]?.source_created_at ?? null }).eq('id', activeContext.id).eq('workspace_id', workspaceId);
          }
          await supabase.from('slack_contexts').update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(identity.isEdited && activeContext.captured_message_ts === identity.messageTs && !identity.isDeleted ? { message_text: identity.messageText } : {}) }).eq('id', activeContext.id).eq('workspace_id', workspaceId);
        }
      }
    }
    const durationMs = Date.now() - startedAt;
    await supabase.from('slack_event_deliveries').update({ status: 'processed', processed_at: new Date().toISOString(), processing_duration_ms: durationMs, error_code: null, error_message: null, updated_at: new Date().toISOString() }).eq('id', delivery.id);
    console.info('[slack] event processed', { workspaceId: delivery.workspace_id, teamId: delivery.slack_team_id, eventId: delivery.slack_event_id, durationMs });
  } catch (error) {
    const retryCount = Number(delivery.retry_count ?? 0) + 1;
    const retryable = !error?.permanent && retryCount < 3;
    const nextAttemptAt = retryable ? new Date(Date.now() + retryCount * 30_000).toISOString() : null;
    await supabase.from('slack_event_deliveries').update({ status: retryable ? 'received' : 'failed', retry_count: retryCount, next_attempt_at: nextAttemptAt, error_code: error?.code ?? error?.slackError ?? 'processing_failed', error_message: clampText(error?.message ?? 'processing_failed', 500), processing_duration_ms: Date.now() - startedAt, updated_at: new Date().toISOString() }).eq('id', delivery.id);
    console.error('[slack] event processing failed', { eventId: delivery.slack_event_id, retryCount, retryable, code: error?.code ?? error?.slackError ?? 'processing_failed', durationMs: Date.now() - startedAt });
    if (retryable) setTimeout(() => void processSlackEventDelivery(delivery.id), retryCount * 30_000);
  }
};

const enqueueSlackEventDelivery = async (payload, retryNumber = 0) => {
  const teamId = payload?.team_id ?? payload?.event?.team ?? null;
  if (!teamId) return;
  const account = await findSlackIntegrationAccount(teamId);
  const eventId = getSlackEventId(payload);
  const inserted = await supabase.from('slack_event_deliveries').insert({ workspace_id: account?.workspace_id ?? null, integration_account_id: account?.id ?? null, slack_team_id: teamId, slack_event_id: eventId, event_type: payload?.event?.type ?? payload?.type ?? 'unknown', payload, retry_count: Number(retryNumber) || 0 }).select('id').single();
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      console.info('[slack] duplicate event delivery', { teamId, eventId });
      return;
    }
    throw inserted.error;
  }
  console.info('[slack] event received', { teamId, eventId, retryNumber });
  void processSlackEventDelivery(inserted.data?.id);
};

const runSlackEventDeliveryWorker = async () => {
  try {
    const queued = await supabase.from('slack_event_deliveries').select('id').eq('status', 'received').or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`).order('received_at', { ascending: true }).limit(10);
    if (queued.error) {
      if (isMissingRelationError(queued.error, 'slack_event_deliveries')) return;
      throw queued.error;
    }
    await Promise.all((queued.data ?? []).map((delivery) => processSlackEventDelivery(delivery.id)));
  } catch (error) {
    console.error('[slack] event worker failed', { message: error?.message ?? 'unknown_error' });
  }
};

const slackActivitySelect = 'id, workspace_id, integration_account_id, slack_team_id, slack_event_id, slack_conversation_id, slack_message_ts, slack_root_thread_ts, activity_type, conversation_type, author_slack_user_id, target_slack_user_id, message_text, permalink, source_created_at, processed_at, is_edited, is_deleted, created_at, updated_at';

const loadVisibleSlackActivities = async ({ workspaceId, userId, date, filter = 'all', search = '', watchId = '', unreadOnly = false, limit = 50 }) => {
  const matchResult = await supabase.from('slack_activity_matches').select('activity_id, slack_watch_id, slack_context_id, ledger_user_id, match_type').eq('workspace_id', workspaceId);
  if (matchResult.error) throw matchResult.error;
  const sharedWatchResult = await supabase.from('slack_watches').select('id').eq('workspace_id', workspaceId).eq('watch_type', 'shared');
  if (sharedWatchResult.error) throw sharedWatchResult.error;
  const sharedWatchIds = new Set((sharedWatchResult.data ?? []).map((watch) => watch.id));
  const visibleMatches = (matchResult.data ?? []).filter((match) => match.ledger_user_id === userId || (match.ledger_user_id === null && match.slack_watch_id && sharedWatchIds.has(match.slack_watch_id)));
  const matchesByActivity = new Map();
  for (const match of visibleMatches) {
    const rows = matchesByActivity.get(match.activity_id) ?? [];
    rows.push(match);
    matchesByActivity.set(match.activity_id, rows);
  }
  if (!matchesByActivity.size) return { rows: [], total: 0 };

  const activityIds = [...matchesByActivity.keys()];
  let query = supabase.from('slack_activities').select(slackActivitySelect).eq('workspace_id', workspaceId).in('id', activityIds).order('source_created_at', { ascending: false, nullsFirst: false }).limit(Math.min(Math.max(Number(limit) || 50, 1), 100));
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (!Number.isNaN(start.getTime())) query = query.gte('source_created_at', start.toISOString()).lt('source_created_at', end.toISOString());
  }
  const trimmedSearch = String(search).trim().slice(0, 120);
  if (trimmedSearch) {
    const safeSearch = trimmedSearch.replace(/[%,]/g, '');
    query = query.or(`message_text.ilike.%${safeSearch}%,author_slack_user_id.ilike.%${safeSearch}%`);
  }
  const activityResult = await query;
  if (activityResult.error) throw activityResult.error;
  let rows = activityResult.data ?? [];
  const readStates = await supabase.from('slack_activity_read_states').select('slack_activity_id, read_at, dismissed_at').eq('workspace_id', workspaceId).eq('ledger_user_id', userId).in('slack_activity_id', rows.map((row) => row.id));
  if (readStates.error) throw readStates.error;
  const readByActivity = new Map((readStates.data ?? []).map((state) => [state.slack_activity_id, state]));
  const contextIds = [...new Set(visibleMatches.map((match) => match.slack_context_id).filter(Boolean))];
  const contexts = contextIds.length ? await supabase.from('slack_contexts').select('id, reply_count, latest_reply_at, sync_status').eq('workspace_id', workspaceId).in('id', contextIds) : { data: [], error: null };
  if (contexts.error) throw contexts.error;
  const contextById = new Map((contexts.data ?? []).map((context) => [context.id, context]));
  const follows = contextIds.length ? await supabase.from('slack_context_follows').select('slack_context_id').eq('workspace_id', workspaceId).eq('ledger_user_id', userId).in('slack_context_id', contextIds) : { data: [], error: null };
  if (follows.error) throw follows.error;
  const followedContextIds = new Set((follows.data ?? []).map((follow) => follow.slack_context_id));
  const contextLinks = contextIds.length ? await supabase.from('slack_context_links').select('slack_context_id, target_type, target_id').eq('workspace_id', workspaceId).in('slack_context_id', contextIds) : { data: [], error: null };
  if (contextLinks.error) throw contextLinks.error;
  const intakeIds = [...new Set((contextLinks.data ?? []).filter((link) => link.target_type === 'intake_item').map((link) => link.target_id))];
  const intakeRows = intakeIds.length ? await supabase.from('inbox_items').select('id, status, converted_type, converted_id, title').eq('workspace_id', workspaceId).in('id', intakeIds) : { data: [], error: null };
  if (intakeRows.error) throw intakeRows.error;
  const intakeById = new Map((intakeRows.data ?? []).map((item) => [item.id, item]));
  const contextIntakeById = new Map();
  for (const link of contextLinks.data ?? []) if (link.target_type === 'intake_item' && intakeById.has(link.target_id)) contextIntakeById.set(link.slack_context_id, intakeById.get(link.target_id));
  rows = rows.map((activity) => {
    const matches = matchesByActivity.get(activity.id) ?? [];
    const state = readByActivity.get(activity.id);
    const contextId = matches.find((match) => match.slack_context_id)?.slack_context_id ?? null;
    return { ...activity, matches, context_id: contextId, context: contextId ? contextById.get(contextId) ?? null : null, intake_item: contextId ? contextIntakeById.get(contextId) ?? null : null, is_following: Boolean(contextId && followedContextIds.has(contextId)), is_read: Boolean(state?.read_at), read_at: state?.read_at ?? null, dismissed_at: state?.dismissed_at ?? null };
  });
  rows = rows.filter((row) => {
    if (row.dismissed_at) return false;
    const matches = row.matches;
    if (watchId && !matches.some((match) => match.slack_watch_id === watchId)) return false;
    if (unreadOnly && row.is_read) return false;
    if (filter === 'mentions' && !matches.some((match) => match.match_type === 'mention') && row.activity_type !== 'mention') return false;
    if (filter === 'replies' && !matches.some((match) => match.match_type === 'reply') && !['reply', 'thread_reply'].includes(row.activity_type)) return false;
    if (filter === 'threads' && row.slack_root_thread_ts === row.slack_message_ts) return false;
    if (filter === 'watched' && !matches.some((match) => match.slack_watch_id)) return false;
    if (filter === 'sent_to_intake' && !row.intake_item) return false;
    return true;
  });
  return { rows, total: rows.length };
};

const getIntegrationTokenKey = () => {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() || process.env.FIGMA_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('Integration token encryption is not configured');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('Integration token encryption key must be 32 bytes');
  return key;
};

const protectIntegrationTokenForStorage = (token) => {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getIntegrationTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
};

const readIntegrationToken = (stored) => {
  if (!stored) return null;
  if (!String(stored).startsWith('enc:v1:')) return String(stored);
  const [, version, ivValue, tagValue, encryptedValue] = String(stored).split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getIntegrationTokenKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
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

const normalizeSlackContextTargetType = (value) => {
  const type = String(value ?? '').trim().toLowerCase();
  return type === 'intake' || type === 'inbox' ? 'intake_item' : type;
};

const slackContextTargetTables = {
  intake_item: 'inbox_items',
  task: 'tasks',
  note: 'notes',
  event: 'events',
  reminder: 'reminders',
  project: 'projects',
  project_resource: 'external_references',
};

const linkSlackContextToTarget = async ({ workspaceId, slackContextId, targetType, targetId, userId, relationshipType = 'context' }) => {
  const normalizedType = normalizeSlackContextTargetType(targetType);
  const table = slackContextTargetTables[normalizedType];
  if (!table || !targetId) throw new Error('Unsupported Slack context target');
  const context = await supabase
    .from('slack_contexts')
    .select('id')
    .eq('id', String(slackContextId))
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (context.error) throw context.error;
  if (!context.data?.id) throw new Error('Slack context not found');
  const allowed = await ensureWorkspaceResource(table, String(targetId), workspaceId);
  if (!allowed) throw new Error('Slack context target not found');
  const result = await supabase.from('slack_context_links').upsert(
    {
      workspace_id: workspaceId,
      slack_context_id: slackContextId,
      target_type: normalizedType,
      target_id: String(targetId),
      relationship_type: relationshipType,
      created_by: userId ?? null,
    },
    { onConflict: 'workspace_id,slack_context_id,target_type,target_id' }
  ).select('id, slack_context_id, target_type, target_id, relationship_type, created_at').single();
  if (result.error) throw result.error;
  return result.data;
};

const resolveSlackContextForCapture = async ({ account, teamId, channelId, channelName, message, messageText, messageTs, threadTs, externalUrl }) => {
  const rootMessageTs = threadTs || messageTs;
  if (!account?.workspace_id || !teamId || !channelId || !rootMessageTs || !messageTs) {
    throw new Error('Slack context identity is incomplete');
  }
  const result = await supabase.from('slack_contexts').upsert(
    {
      workspace_id: account.workspace_id,
      integration_account_id: account.id,
      slack_team_id: teamId,
      slack_channel_id: channelId,
      slack_channel_name: channelName ?? null,
      root_message_ts: rootMessageTs,
      captured_message_ts: messageTs,
      message_text: messageText || null,
      message_author_slack_id: message.user ?? null,
      message_author_name: message.username ?? null,
      message_author_avatar_url: message.user_profile?.image_48 ?? message.user_profile?.image_72 ?? null,
      permalink: externalUrl,
      message_created_at: parseSlackMessageTimestamp(messageTs),
      captured_at: new Date().toISOString(),
      sync_status: 'static',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,slack_team_id,slack_channel_id,root_message_ts' }
  ).select('id').single();
  if (result.error) throw result.error;
  return result.data.id;
};

const findSlackIntegrationAccount = async (teamId) => {
  if (!teamId) return null;
  const accountResult = await supabase
    .from('integration_accounts')
    .select('id, workspace_id, installed_by, provider_team_id, provider_team_name')
    .eq('provider', 'slack')
    .eq('provider_team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountResult.error) throw accountResult.error;
  return accountResult.data ?? null;
};

const resolveSlackIdentityLedgerUser = async ({ workspaceId, integrationAccountId, teamId, slackUserId }) => {
  if (!workspaceId || !integrationAccountId || !teamId || !slackUserId) return null;
  const result = await supabase
    .from('slack_identities')
    .select('ledger_user_id, status')
    .eq('workspace_id', workspaceId)
    .eq('integration_account_id', integrationAccountId)
    .eq('slack_team_id', teamId)
    .eq('slack_user_id', slackUserId)
    .eq('status', 'connected')
    .maybeSingle();
  if (result.error) {
    if (isMissingRelationError(result.error, 'slack_identities')) return null;
    throw result.error;
  }
  return result.data?.ledger_user_id ?? null;
};

const loadConnectedSlackIdentity = async ({ workspaceId, userId }) => {
  const result = await supabase
    .from('slack_identities')
    .select('id, workspace_id, ledger_user_id, integration_account_id, slack_team_id, slack_user_id, slack_display_name, status, access_token_encrypted, scopes')
    .eq('workspace_id', workspaceId)
    .eq('ledger_user_id', userId)
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    if (isMissingRelationError(result.error, 'slack_identities')) return null;
    throw result.error;
  }
  const token = readIntegrationToken(result.data?.access_token_encrypted);
  if (!result.data?.id || !token) return null;
  return { ...result.data, access_token_encrypted: token };
};

const loadSlackWorkspaceToken = async (workspaceId, integrationAccountId = null) => {
  let query = supabase.from('integration_accounts').select('id, access_token_encrypted, provider_team_id').eq('workspace_id', workspaceId).eq('provider', 'slack').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (integrationAccountId) query = supabase.from('integration_accounts').select('id, access_token_encrypted, provider_team_id').eq('workspace_id', workspaceId).eq('provider', 'slack').eq('id', integrationAccountId).maybeSingle();
  const result = await query;
  if (result.error) throw result.error;
  const token = readIntegrationToken(result.data?.access_token_encrypted);
  return result.data?.id && token ? { ...result.data, access_token: token } : null;
};

const upsertSlackThreadReply = async ({ workspaceId, contextId, reply, authorName = null, authorAvatarUrl = null, isEdited = false, isDeleted = false }) => {
  if (!contextId || !reply?.ts) return null;
  const now = new Date().toISOString();
  const result = await supabase.from('slack_thread_replies').upsert({
    workspace_id: workspaceId,
    slack_context_id: contextId,
    slack_message_ts: String(reply.ts),
    slack_user_id: reply.user ?? null,
    author_name: authorName ?? reply.username ?? null,
    author_avatar_url: authorAvatarUrl ?? reply.user_profile?.image_48 ?? reply.user_profile?.image_72 ?? null,
    message_text: isDeleted || reply.deleted ? null : reply.text ?? null,
    permalink: reply.permalink ?? null,
    source_created_at: parseSlackMessageTimestamp(reply.ts),
    edited_at: isEdited || reply.edited ? now : null,
    deleted_at: isDeleted || reply.deleted ? now : null,
    is_edited: isEdited || Boolean(reply.edited),
    is_deleted: isDeleted || Boolean(reply.deleted),
    updated_at: now,
  }, { onConflict: 'slack_context_id,slack_message_ts' }).select('id').single();
  if (result.error) throw result.error;
  return result.data?.id ?? null;
};

const syncSlackContextReplies = async ({ workspaceId, context, token }) => {
  if (!context?.id || !token) return { synced: false, reason: 'authorization_unavailable' };
  const payload = await slackApiRequest('conversations.replies', token, { channel: context.slack_channel_id, ts: context.root_message_ts, limit: 200, inclusive: true });
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const replies = messages.filter((message) => String(message.ts) !== String(context.root_message_ts));
  for (const reply of replies) await upsertSlackThreadReply({ workspaceId, contextId: context.id, reply, isEdited: Boolean(reply.edited), isDeleted: Boolean(reply.deleted) });
  const latest = replies.length ? replies[replies.length - 1] : null;
  const now = new Date().toISOString();
  const updated = await supabase.from('slack_contexts').update({ reply_count: replies.length, latest_reply_at: latest ? parseSlackMessageTimestamp(latest.ts) : null, sync_status: 'sync_ready', last_synced_at: now, updated_at: now }).eq('id', context.id).eq('workspace_id', workspaceId);
  if (updated.error) throw updated.error;
  return { synced: true, replyCount: replies.length, latestReplyTs: latest?.ts ?? null, syncedAt: now };
};

const refreshSlackContextBestEffort = async (workspaceId, context) => {
  try {
    const workspaceToken = await loadSlackWorkspaceToken(workspaceId, context?.integration_account_id);
    if (context && workspaceToken?.access_token) return await syncSlackContextReplies({ workspaceId, context, token: workspaceToken.access_token });
  } catch (error) {
    console.warn('[slack] linked thread sync delayed', { workspaceId, contextId: context?.id, code: error?.slackError ?? error?.code ?? 'sync_failed' });
    if (context?.id) await supabase.from('slack_contexts').update({ sync_status: 'sync_error', updated_at: new Date().toISOString() }).eq('id', context.id).eq('workspace_id', workspaceId);
  }
  return null;
};

const slackApiRequest = async (method, token, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const response = await fetch(`https://slack.com/api/${method}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error || `${method}_failed`);
    error.slackError = payload?.error || 'request_failed';
    error.statusCode = response.status;
    throw error;
  }
  return payload;
};

const mapSlackConversation = (conversation, teamId, watched = {}) => {
  const isDirectMessage = Boolean(conversation.is_im);
  const isGroupConversation = Boolean(conversation.is_mpim);
  const isPrivate = Boolean(conversation.is_private);
  const conversationType = isDirectMessage
    ? 'direct_message'
    : isGroupConversation
    ? 'group_conversation'
    : isPrivate
    ? 'private_channel'
    : 'public_channel';
  return {
    id: conversation.id,
    name: conversation.name || (isGroupConversation ? 'Group conversation' : isDirectMessage ? 'Direct message' : 'Untitled conversation'),
    conversation_type: conversationType,
    is_private: isPrivate,
    member_count: conversation.num_members ?? null,
    latest_message_ts: conversation.latest?.ts ?? null,
    is_archived: Boolean(conversation.is_archived),
    permalink: teamId && conversation.id ? `https://app.slack.com/client/${encodeURIComponent(teamId)}/${encodeURIComponent(conversation.id)}` : null,
    personal_watch: watched.personal ?? null,
    shared_watch: watched.shared ?? null,
  };
};

const postSlackCaptureResponse = async (responseUrl, response) => {
  const url = String(responseUrl ?? '').trim();
  if (!url) return;
  try {
    const result = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, ...response }),
    });
    if (!result.ok) {
      console.warn('[slack] capture response failed', { status: result.status });
    }
  } catch (error) {
    console.warn('[slack] capture response request failed', { message: error?.message ?? 'unknown_error' });
  }
};

const buildSlackOpenIntakeResponse = (inboxId) => ({
  text: 'Sent to Ledger Intake',
  ...(inboxId
    ? {
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: 'Sent to Ledger Intake' },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Open in Ledger' },
              url: `ledger://inbox/${encodeURIComponent(inboxId)}`,
              action_id: 'open_ledger_intake',
            },
          },
        ],
      }
    : {}),
});

const saveSlackMessageCapture = async (payload, account = null) => {
  const teamId = payload?.team?.id ?? payload?.team?.enterprise_id ?? null;
  if (!teamId) return { ok: false, reason: 'missing_team' };

  account = account || (await findSlackIntegrationAccount(teamId));
  if (!account?.workspace_id) return { ok: false, reason: 'missing_workspace' };

  const message = payload?.message ?? {};
  const channel = payload?.channel ?? {};
  const user = payload?.user ?? {};
  const messageTs = message.ts ?? payload?.message_ts ?? null;
  const threadTs = message.thread_ts ?? payload?.thread_ts ?? null;
  const channelId = channel.id ?? payload?.channel_id ?? null;
  const authorName = message.username ?? user.username ?? user.name ?? null;
  const messageText = normalizeSlackMessageText(message.text ?? '');
  const capturedByUserId = await resolveSlackIdentityLedgerUser({
    workspaceId: account.workspace_id,
    integrationAccountId: account.id,
    teamId,
    slackUserId: user.id ?? message.user ?? null,
  });
  const sourceId = [teamId, channelId, messageTs].filter(Boolean).join(':') || null;
  const externalUrl = message.permalink ?? message.url ?? null;
  const title = buildSlackInboxTitle(messageText, authorName);

  if (!sourceId) return { ok: false, reason: 'missing_message_identity' };

  const slackContextId = await resolveSlackContextForCapture({
    account,
    teamId,
    channelId,
    channelName: channel.name,
    message,
    messageText,
    messageTs,
    threadTs,
    externalUrl,
  });

  const existingContextLink = await supabase
    .from('slack_context_links')
    .select('target_id')
    .eq('workspace_id', account.workspace_id)
    .eq('slack_context_id', slackContextId)
    .eq('target_type', 'intake_item')
    .limit(1)
    .maybeSingle();
  if (existingContextLink.error) throw existingContextLink.error;
  if (existingContextLink.data?.target_id) {
    console.info('[slack] duplicate thread capture', { sourceId, slackContextId, workspaceId: account.workspace_id });
    return { ok: true, duplicate: true, inboxId: existingContextLink.data.target_id };
  }

  const existingResult = await supabase
    .from('external_sources')
    .select('id, capture_status, intake_item_id')
    .eq('workspace_id', account.workspace_id)
    .eq('provider', 'slack')
    .eq('external_id', sourceId)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;

  const existing = existingResult.data;
  if (existing?.capture_status === 'completed' || existing?.intake_item_id) {
    console.info('[slack] duplicate capture', { sourceId, workspaceId: account.workspace_id });
    return { ok: true, duplicate: true, inboxId: existing.intake_item_id ?? null };
  }
  if (existing && existing.capture_status === 'processing') {
    console.info('[slack] duplicate capture attempt while processing', {
      sourceId,
      status: existing.capture_status,
      workspaceId: account.workspace_id,
    });
    return { ok: true, duplicate: true, pending: true, inboxId: existing.intake_item_id ?? null };
  }

  const capturePayload = {
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
    created_by: capturedByUserId,
    slack_team_id: teamId,
    slack_channel_id: channelId,
    slack_message_ts: messageTs ?? null,
    slack_user_id: user.id ?? message.user ?? null,
    capture_action_id: payload.action_ts ?? payload.trigger_id ?? payload.callback_id ?? null,
    slack_context_id: slackContextId,
    capture_status: 'received',
    failure_reason: null,
    captured_by: capturedByUserId,
  };

  let captureId = existing?.id ?? null;
  if (captureId) {
    const resetResult = await supabase
      .from('external_sources')
      .update(capturePayload)
      .eq('id', captureId);
    if (resetResult.error) throw resetResult.error;
  } else {
    const insertResult = await supabase
      .from('external_sources')
      .insert(capturePayload)
      .select('id')
      .single();
    if (insertResult.error) {
      if (insertResult.error.code === '23505') {
        const replay = await supabase
          .from('external_sources')
          .select('capture_status, intake_item_id')
          .eq('workspace_id', account.workspace_id)
          .eq('provider', 'slack')
          .eq('external_id', sourceId)
          .maybeSingle();
        if (replay.error) throw replay.error;
        console.info('[slack] duplicate capture race', { sourceId, workspaceId: account.workspace_id });
        return {
          ok: true,
          duplicate: true,
          pending: replay.data?.capture_status !== 'completed',
          inboxId: replay.data?.intake_item_id ?? null,
        };
      }
      throw insertResult.error;
    }
    captureId = insertResult.data.id;
  }

  const processingResult = await supabase
    .from('external_sources')
    .update({ capture_status: 'processing', failure_reason: null })
    .eq('id', captureId);
  if (processingResult.error) throw processingResult.error;

  try {
    const inboxResult = await supabase
      .from('inbox_items')
      .upsert(
        {
          workspace_id: account.workspace_id,
          user_id: capturedByUserId ?? account?.installed_by ?? null,
          updated_by: capturedByUserId ?? account?.installed_by ?? null,
          source: 'slack',
          source_provider: 'slack',
          source_id: sourceId,
          source_url: externalUrl,
          title,
          body: messageText || null,
          raw_payload: payload,
          suggested_type: 'unknown',
          status: 'unprocessed',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,source,source_id' }
      )
      .select('id')
      .single();
    if (inboxResult.error) throw inboxResult.error;

    await linkSlackContextToTarget({
      workspaceId: account.workspace_id,
      slackContextId,
      targetType: 'intake_item',
      targetId: inboxResult.data.id,
      userId: account.installed_by,
      relationshipType: 'source',
    });

    const completedResult = await supabase
      .from('external_sources')
      .update({ capture_status: 'completed', intake_item_id: inboxResult.data.id, failure_reason: null })
      .eq('id', captureId);
    if (completedResult.error) throw completedResult.error;

    try {
      const workspaceToken = await loadSlackWorkspaceToken(account.workspace_id, account.id);
      const context = await loadSlackContextForWorkspace(account.workspace_id, slackContextId);
      if (context && workspaceToken?.access_token) await syncSlackContextReplies({ workspaceId: account.workspace_id, context, token: workspaceToken.access_token });
    } catch (syncError) {
      console.warn('[slack] initial thread sync delayed', { workspaceId: account.workspace_id, contextId: slackContextId, code: syncError?.slackError ?? syncError?.code ?? 'sync_failed' });
      await supabase.from('slack_contexts').update({ sync_status: 'sync_error', updated_at: new Date().toISOString() }).eq('id', slackContextId).eq('workspace_id', account.workspace_id);
    }

    return { ok: true, inboxId: inboxResult.data.id, workspaceId: account.workspace_id };
  } catch (error) {
    const failureReason = clampText(error?.message ?? 'capture_failed', 500);
    await supabase
      .from('external_sources')
      .update({ capture_status: 'failed', failure_reason: failureReason })
      .eq('id', captureId);
    console.error('[slack] capture failed', {
      captureId,
      sourceId,
      workspaceId: account.workspace_id,
      failureReason,
    });
    throw error;
  }
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
    source_label: row.source ? titleCaseLabel(row.source) : 'Intake',
  };
};

const loadInboxItemForWorkspace = async (workspaceId, id) => {
  const result = await supabase
    .from('inbox_items')
    .select(inboxItemSelectColumns)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const resumeDueInboxItemsForWorkspace = async (workspaceId) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('inbox_items')
    .update({
      status: 'unprocessed',
      snoozed_until: null,
      updated_at: now,
    })
    .eq('workspace_id', workspaceId)
    .eq('status', 'snoozed')
    .not('snoozed_until', 'is', null)
    .lte('snoozed_until', now);

  if (error) throw error;
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

const getPersonalCalendar = async (workspaceId, userId) => {
  const existingPersonal = await supabase
    .from('calendars')
    .select('id, color')
    .eq('workspace_id', workspaceId)
    .eq('is_personal', true)
    .maybeSingle();

  if (existingPersonal.data?.id) {
    return existingPersonal.data;
  }

  const existingNamedPersonal = await supabase
    .from('calendars')
    .select('id, color')
    .eq('workspace_id', workspaceId)
    .eq('name', 'Personal')
    .maybeSingle();

  if (existingNamedPersonal.data?.id) {
    return existingNamedPersonal.data;
  }

  const created = await supabase
    .from('calendars')
    .insert({
      workspace_id: workspaceId,
      owner_id: userId,
      created_by: userId,
      name: 'Personal',
      color: '#3B82F6',
      is_personal: true,
      is_default: true,
      is_visible: true,
    })
    .select('id')
    .single();

  if (!created.error && created.data?.id) {
    return {
      id: created.data.id,
      color: '#3B82F6',
    };
  }

  if (created.error?.code === '23505') {
    const conflicted = await supabase
      .from('calendars')
      .select('id, color')
      .eq('workspace_id', workspaceId)
      .eq('name', 'Personal')
      .maybeSingle();

    if (conflicted.data?.id) {
      return conflicted.data;
    }
  }

  throw created.error ?? new Error('Unable to resolve personal calendar');
};

const getCalendarId = async (workspaceId, userId) => {
  const calendar = await getPersonalCalendar(workspaceId, userId);
  return calendar?.id ?? null;
};

const normalizeEventEndAt = (startAt, endAt) => {
  const startDate = startAt ? new Date(startAt) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return endAt;
  }

  const requestedEnd = endAt ? new Date(endAt) : null;
  if (!requestedEnd || Number.isNaN(requestedEnd.getTime())) {
    return new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  }

  if (requestedEnd.getTime() <= startDate.getTime()) {
    return new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  }

  return requestedEnd.toISOString();
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

const ensureWorkspaceTeam = async (teamId, workspaceId) => {
  const result = await supabase
    .from('workspace_teams')
    .select('id')
    .eq('id', teamId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return Boolean(result.data?.id);
};

const ensureWorkspaceMemberTarget = async (workspaceId, userId) => {
  const workspaceResult = await supabase
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspaceResult.error) throw workspaceResult.error;
  if (workspaceResult.data?.owner_id === userId) return true;

  const memberResult = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (memberResult.error) throw memberResult.error;
  return Boolean(memberResult.data?.user_id);
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
    assigned_to_user_id: row.assigned_to_user_id ?? null,
    assigned_to_team_id: row.assigned_to_team_id ?? null,
    assigned_by_user_id: row.assigned_by_user_id ?? null,
    assigned_at: row.assigned_at ?? null,
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

const normalizeSessionPlatform = (value) => {
  const platform = String(value ?? '').trim().toLowerCase();
  if (platform === 'desktop' || platform === 'ios' || platform === 'android' || platform === 'web' || platform === 'extension') {
    return platform;
  }
  return 'desktop';
};

const normalizeSessionText = (value, fallback = null) => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const readSessionMetadataFromRequest = (req) => {
  const deviceId = normalizeSessionText(req.headers['x-ledger-device-id']);
  if (!deviceId) return null;

  return {
    device_id: deviceId,
    device_name: normalizeSessionText(req.headers['x-ledger-device-name']),
    platform: normalizeSessionPlatform(req.headers['x-ledger-platform']),
    app_name: normalizeSessionText(req.headers['x-ledger-app-name']),
    app_version: normalizeSessionText(req.headers['x-ledger-app-version']),
    user_agent: normalizeSessionText(req.headers['user-agent']),
  };
};

const upsertAccountSessionForUser = async (userId, metadata) => {
  if (!metadata?.device_id) return null;

  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    device_id: metadata.device_id,
    device_name: metadata.device_name,
    platform: metadata.platform,
    app_name: metadata.app_name,
    app_version: metadata.app_version,
    user_agent: metadata.user_agent,
    last_seen_at: now,
    revoked_at: null,
    updated_at: now,
  };

  const result = await supabase
    .from('app_sessions')
    .upsert(payload, { onConflict: 'user_id,device_id' })
    .select('id, device_id, device_name, platform, app_name, app_version, last_seen_at, created_at, revoked_at')
    .single();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const loadAccountSessionsForUser = async (userId) => {
  const result = await supabase
    .from('app_sessions')
    .select('id, device_id, device_name, platform, app_name, app_version, last_seen_at, created_at, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (result.error) throw result.error;
  return result.data ?? [];
};

const mapAccountSession = (row, currentDeviceId = null) => ({
  id: row?.id ?? null,
  device_id: row?.device_id ?? null,
  device_name: row?.device_name ?? null,
  platform: row?.platform ?? 'desktop',
  app_name: row?.app_name ?? null,
  app_version: row?.app_version ?? null,
  last_seen_at: row?.last_seen_at ?? null,
  created_at: row?.created_at ?? null,
  revoked_at: row?.revoked_at ?? null,
  is_current: Boolean(currentDeviceId && row?.device_id && row.device_id === currentDeviceId),
});

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

app.get('/api/account/sessions', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const metadata = readSessionMetadataFromRequest(req);
    if (metadata) {
      try {
        await upsertAccountSessionForUser(req.authUser.id, metadata);
      } catch (error) {
        if (!isMissingRelationError(error, 'app_sessions')) throw error;
      }
    }

    let sessions = [];
    try {
      sessions = await loadAccountSessionsForUser(req.authUser.id);
    } catch (error) {
      if (!isMissingRelationError(error, 'app_sessions')) throw error;
    }
    res.json({
      currentSessionId: metadata?.device_id ?? null,
      sessions: sessions.map((row) => mapAccountSession(row, metadata?.device_id ?? null)),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/account/sessions/heartbeat', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const metadata = readSessionMetadataFromRequest(req);
    if (!metadata) {
      return res.status(400).json({ error: 'Session metadata is required' });
    }

    let session = null;
    try {
      session = await upsertAccountSessionForUser(req.authUser.id, metadata);
    } catch (error) {
      if (!isMissingRelationError(error, 'app_sessions')) throw error;
    }
    res.json({
      currentSessionId: metadata.device_id,
      session: mapAccountSession(session, metadata.device_id),
    });
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

    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
    if (sourceUrl && !normalizedSourceUrl) {
      return res.status(400).json({ error: 'source_url must be an http or https URL' });
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
      updated_by: req.authUser.id,
      source: 'browser',
      source_provider: 'browser',
      source_id: null,
      source_url: normalizedSourceUrl,
      title: title || fallbackTitle,
      body,
      raw_payload: rawPayload ?? {},
      suggested_type: 'unknown',
      status: 'unprocessed',
      converted_type: null,
      converted_id: null,
      converted_at: null,
      converted_by: null,
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('inbox_items')
      .insert(insertPayload)
      .select(inboxItemSelectColumns)
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

app.post('/api/intake', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const resolvedWorkspaceId = await resolveWorkspaceIdForRequest(req);
    const requestedWorkspaceId = normalizeNullableText(req.body?.workspace_id);
    if (requestedWorkspaceId && requestedWorkspaceId !== resolvedWorkspaceId) {
      return res.status(400).json({ error: 'workspace_id must match the active workspace' });
    }

    const workspaceId = requestedWorkspaceId || resolvedWorkspaceId;
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

    const source = normalizeIntakeSource(req.body?.source);
    const sourceProvider = normalizeNullableText(req.body?.source_provider);
    const suggestedType = normalizeIntakeSuggestedType(req.body?.suggested_type);
    const title = clampText(req.body?.title, 300);
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const body = clampMultilineText(req.body?.body ?? req.body?.raw_content, 20_000);
    const rawContent = clampMultilineText(req.body?.raw_content, 20_000);
    const reason = clampText(req.body?.reason, 500);
    const sourceObjectType = normalizeNullableText(req.body?.source_object_type);
    const sourceObjectId = normalizeNullableText(req.body?.source_object_id);
    const suggestedProjectId = normalizeNullableText(req.body?.suggested_project_id);
    const suggestedTeamId = normalizeNullableText(req.body?.suggested_team_id);
    const suggestedAssigneeId = normalizeNullableText(req.body?.suggested_assignee_id);
    const suggestedDueDate = normalizeNullableText(req.body?.suggested_due_date);
    const suggestedStartAt = normalizeNullableText(req.body?.suggested_start_at);
    const suggestedEndAt = normalizeNullableText(req.body?.suggested_end_at);

    if (suggestedProjectId) {
      const allowed = await ensureWorkspaceResource('projects', suggestedProjectId, workspaceId);
      if (!allowed) {
        return res.status(404).json({ error: 'Project not found' });
      }
    }
    if (suggestedTeamId) {
      const allowed = await ensureWorkspaceTeam(suggestedTeamId, workspaceId);
      if (!allowed) {
        return res.status(404).json({ error: 'Team not found' });
      }
    }
    if (suggestedAssigneeId) {
      const allowed = await ensureWorkspaceMemberTarget(workspaceId, suggestedAssigneeId);
      if (!allowed) {
        return res.status(404).json({ error: 'Assigned user not found' });
      }
    }
    if (suggestedStartAt && Number.isNaN(new Date(suggestedStartAt).getTime())) {
      return res.status(400).json({ error: 'Invalid suggested_start_at' });
    }
    if (suggestedEndAt && Number.isNaN(new Date(suggestedEndAt).getTime())) {
      return res.status(400).json({ error: 'Invalid suggested_end_at' });
    }

    const rawPayload = {
      reason: reason || null,
      raw_content: rawContent || null,
      suggested_project_id: suggestedProjectId || null,
      suggested_team_id: suggestedTeamId || null,
      suggested_assignee_id: suggestedAssigneeId || null,
      suggested_due_date: suggestedDueDate || null,
      suggested_start_at: suggestedStartAt || null,
      suggested_end_at: suggestedEndAt || null,
      source_object_type: sourceObjectType || null,
      source_object_id: sourceObjectId || null,
      source_platform: 'sidebar',
    };

    const insertPayload = {
      workspace_id: workspaceId,
      user_id: req.authUser.id,
      updated_by: req.authUser.id,
      source,
      source_provider: sourceProvider || null,
      source_id: sourceObjectId || null,
      source_url: null,
      title,
      body: body || null,
      raw_payload: rawPayload,
      suggested_type: suggestedType,
      status: 'unprocessed',
      converted_type: null,
      converted_id: null,
      converted_at: null,
      converted_by: null,
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('inbox_items')
      .insert(insertPayload)
      .select(inboxItemSelectColumns)
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

const resolveSlackWorkspaceForRequest = async (req) => {
  const requestedWorkspaceId = String(
    req.query?.workspaceId ?? req.query?.workspace_id ?? req.headers['x-workspace-id'] ?? ''
  ).trim();
  if (requestedWorkspaceId) {
    await requireWorkspaceAccess(req.authUser.id, requestedWorkspaceId, 'member');
    return requestedWorkspaceId;
  }
  return resolveWorkspaceIdForRequest(req);
};

app.get('/api/integrations/slack/status', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    const result = await supabase
      .from('integration_accounts')
      .select('id, provider_team_id, provider_team_name, provider_team_icon, bot_user_id, scopes, installed_by, created_at, updated_at')
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

    let connectedBy = null;
    if (result.data.installed_by) {
      const userResult = await supabase
        .from('users')
        .select('id, full_name, email, avatar_url')
        .eq('id', result.data.installed_by)
        .maybeSingle();
      if (userResult.error) throw userResult.error;
      connectedBy = userResult.data
        ? {
            id: userResult.data.id,
            name: userResult.data.full_name || userResult.data.email || 'Ledger member',
            avatar_url: userResult.data.avatar_url ?? null,
          }
        : null;
    }

    res.json({
      connected: true,
      team_id: result.data.provider_team_id ?? null,
      team_name: result.data.provider_team_name ?? null,
      team_icon: result.data.provider_team_icon ?? null,
      bot_user_id: result.data.bot_user_id ?? null,
      connected_by: connectedBy,
      scopes: result.data.scopes ?? [],
      missing_activity_scopes: SLACK_ACTIVITY_BOT_SCOPES.filter((scope) => !(result.data.scopes ?? []).includes(scope)),
      needs_reauthorization: SLACK_ACTIVITY_BOT_SCOPES.some((scope) => !(result.data.scopes ?? []).includes(scope)),
      created_at: result.data.created_at ?? null,
      updated_at: result.data.updated_at ?? null,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/slack/captures', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    const search = String(req.query?.search ?? '').trim().slice(0, 120);
    const limit = Math.min(Math.max(Number(req.query?.limit ?? 50) || 50, 1), 100);
    let capturesQuery = supabase
      .from('external_sources')
      .select(
        'id, external_url, channel_name, author_name, captured_text, captured_at, created_at, capture_status, failure_reason, intake_item_id, slack_team_id, slack_channel_id, slack_message_ts, slack_user_id'
      )
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      const safeSearch = search.replace(/[%,]/g, '');
      capturesQuery = capturesQuery.or(
        `captured_text.ilike.%${safeSearch}%,author_name.ilike.%${safeSearch}%,channel_name.ilike.%${safeSearch}%`
      );
    }

    const result = await capturesQuery;

    if (result.error) {
      if (isMissingRelationError(result.error, 'external_sources')) {
        return res.json([]);
      }
      throw result.error;
    }

    const rows = result.data ?? [];
    const intakeIds = rows.map((row) => row.intake_item_id).filter(Boolean);
    const intakeResult = intakeIds.length
      ? await supabase
          .from('inbox_items')
          .select('id, status, title, converted_type, converted_id, converted_at')
          .eq('workspace_id', workspaceId)
          .in('id', intakeIds)
      : { data: [], error: null };
    if (intakeResult.error) throw intakeResult.error;
    const intakeById = new Map((intakeResult.data ?? []).map((item) => [item.id, item]));

    const targets = new Map();
    for (const type of ['task', 'note', 'event', 'project']) {
      const ids = (intakeResult.data ?? [])
        .filter((item) => item.converted_type === type && item.converted_id)
        .map((item) => item.converted_id);
      if (!ids.length) continue;
      const table = type === 'project' ? 'projects' : `${type}s`;
      const columns = type === 'project' ? 'id, name' : 'id, title';
      const targetResult = await supabase.from(table).select(columns).eq('workspace_id', workspaceId).in('id', ids);
      if (targetResult.error) throw targetResult.error;
      for (const target of targetResult.data ?? []) {
        targets.set(`${type}:${target.id}`, {
          id: target.id,
          type,
          title: target.title ?? target.name ?? 'Ledger item',
        });
      }
    }

    res.json(
      rows
        .map((row) => {
          const intake = row.intake_item_id ? intakeById.get(row.intake_item_id) ?? null : null;
          const target = intake?.converted_type && intake.converted_id
            ? targets.get(`${intake.converted_type}:${intake.converted_id}`) ?? null
            : null;
          return {
            ...row,
            intake_item: intake,
            converted_item: target,
          };
        })
        .filter((row) => {
          const status = String(req.query?.status ?? 'all').trim();
          if (status === 'failed') return row.capture_status === 'failed';
          if (status === 'in_intake') return row.intake_item?.status === 'unprocessed' || row.intake_item?.status === 'snoozed';
          if (status === 'converted') return row.intake_item?.status === 'converted';
          return true;
        })
    );
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/slack/captures/:captureId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    const captureId = String(req.params.captureId ?? '').trim();
    if (!captureId) return res.status(400).json({ error: 'Capture id is required.' });

    const existing = await supabase
      .from('external_sources')
      .select('id, intake_item_id')
      .eq('id', captureId)
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack')
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return res.status(404).json({ error: 'Slack capture not found.' });
    if (existing.data.intake_item_id) {
      return res.status(409).json({ error: 'Captures already sent to Intake cannot be removed here.' });
    }

    const removed = await supabase
      .from('external_sources')
      .delete()
      .eq('id', captureId)
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack');
    if (removed.error) throw removed.error;
    return res.json({ removed: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

const resolveSlackContextFromActivity = async (workspaceId, activity) => {
  const rootMessageTs = activity.slack_root_thread_ts || activity.slack_message_ts;
  const existing = await supabase.from('slack_contexts').select('id').eq('workspace_id', workspaceId).eq('slack_team_id', activity.slack_team_id).eq('slack_channel_id', activity.slack_conversation_id).eq('root_message_ts', rootMessageTs).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;
  const created = await supabase.from('slack_contexts').upsert({ workspace_id: workspaceId, integration_account_id: activity.integration_account_id, slack_team_id: activity.slack_team_id, slack_channel_id: activity.slack_conversation_id, root_message_ts: rootMessageTs, captured_message_ts: activity.slack_message_ts, message_text: activity.message_text, message_author_slack_id: activity.author_slack_user_id, permalink: activity.permalink, message_created_at: activity.source_created_at, captured_at: new Date().toISOString(), sync_status: 'static', updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,slack_team_id,slack_channel_id,root_message_ts' }).select('id').single();
  if (created.error) throw created.error;
  return created.data.id;
};

const promoteSlackActivityToIntake = async ({ workspaceId, userId, activity }) => {
  const contextId = await resolveSlackContextFromActivity(workspaceId, activity);
  const existingLink = await supabase.from('slack_context_links').select('target_id').eq('workspace_id', workspaceId).eq('slack_context_id', contextId).eq('target_type', 'intake_item').limit(1).maybeSingle();
  if (existingLink.error) throw existingLink.error;
  if (existingLink.data?.target_id) return { inboxId: existingLink.data.target_id, contextId, duplicate: true };
  const sourceId = [activity.slack_team_id, activity.slack_conversation_id, activity.slack_message_ts].join(':');
  const source = await supabase.from('external_sources').select('id, intake_item_id').eq('workspace_id', workspaceId).eq('provider', 'slack').eq('external_id', sourceId).maybeSingle();
  if (source.error) throw source.error;
  if (source.data?.intake_item_id) {
    await linkSlackContextToTarget({ workspaceId, slackContextId: contextId, targetType: 'intake_item', targetId: source.data.intake_item_id, userId, relationshipType: 'source' });
    return { inboxId: source.data.intake_item_id, contextId, duplicate: true };
  }
  const inbox = await supabase.from('inbox_items').upsert({ workspace_id: workspaceId, user_id: userId, updated_by: userId, source: 'slack', source_provider: 'slack', source_id: sourceId, source_url: activity.permalink, title: buildSlackInboxTitle(activity.message_text, activity.author_slack_user_id), body: activity.message_text, raw_payload: { source: 'slack_activity', activity_id: activity.id }, suggested_type: 'unknown', status: 'unprocessed', updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,source,source_id' }).select('id').single();
  if (inbox.error) throw inbox.error;
  const external = await supabase.from('external_sources').upsert({ workspace_id: workspaceId, provider: 'slack', integration_account_id: activity.integration_account_id, external_id: sourceId, external_url: activity.permalink, source_type: 'activity', channel_id: activity.slack_conversation_id, captured_text: activity.message_text, captured_at: activity.source_created_at, raw_payload: { source: 'slack_activity', activity_id: activity.id }, created_by: userId, slack_team_id: activity.slack_team_id, slack_channel_id: activity.slack_conversation_id, slack_message_ts: activity.slack_message_ts, slack_context_id: contextId, capture_status: 'completed', intake_item_id: inbox.data.id, captured_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,provider,external_id' });
  if (external.error && external.error.code !== '23505') throw external.error;
  await linkSlackContextToTarget({ workspaceId, slackContextId: contextId, targetType: 'intake_item', targetId: inbox.data.id, userId, relationshipType: 'source' });
  await upsertSlackActivityMatch({ workspaceId, activityId: activity.id, contextId, ledgerUserId: userId, matchType: 'captured_context' });
  try {
    const workspaceToken = await loadSlackWorkspaceToken(workspaceId, activity.integration_account_id);
    const context = await loadSlackContextForWorkspace(workspaceId, contextId);
    if (context && workspaceToken?.access_token) await syncSlackContextReplies({ workspaceId, context, token: workspaceToken.access_token });
  } catch (syncError) {
    console.warn('[slack] activity thread sync delayed', { workspaceId, contextId, code: syncError?.slackError ?? syncError?.code ?? 'sync_failed' });
    await supabase.from('slack_contexts').update({ sync_status: 'sync_error', updated_at: new Date().toISOString() }).eq('id', contextId).eq('workspace_id', workspaceId);
  }
  return { inboxId: inbox.data.id, contextId, duplicate: false };
};

app.get('/api/integrations/slack/activity', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, date: String(req.query?.date ?? '').trim(), filter: String(req.query?.filter ?? 'all'), search: String(req.query?.search ?? ''), watchId: String(req.query?.watch_id ?? ''), unreadOnly: String(req.query?.unread ?? '') === 'true', limit: req.query?.limit });
    res.json(result);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/slack/activity/recap', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const date = String(req.query?.date ?? new Date().toISOString().slice(0, 10)).trim();
    const result = await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, date, limit: 100 });
    const rows = result.rows;
    const mentionCount = rows.filter((row) => row.activity_type === 'mention' || row.matches.some((match) => match.match_type === 'mention')).length;
    const replyCount = rows.filter((row) => ['reply', 'thread_reply'].includes(row.activity_type) || row.matches.some((match) => match.match_type === 'reply')).length;
    const threadRows = rows.filter((row) => row.slack_root_thread_ts && row.slack_root_thread_ts !== row.slack_message_ts);
    const conversations = new Map();
    for (const row of rows) conversations.set(row.slack_conversation_id, (conversations.get(row.slack_conversation_id) ?? 0) + 1);
    res.json({ date, metrics: { new_messages: rows.filter((row) => ['message', 'message_edited'].includes(row.activity_type)).length, mentions: mentionCount, replies: replyCount, active_threads: new Set(threadRows.map((row) => `${row.slack_conversation_id}:${row.slack_root_thread_ts}`)).size, sent_to_intake: rows.filter((row) => row.intake_item).length, linked_contexts: rows.filter((row) => row.context_id).length }, most_active_conversations: [...conversations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([conversationId, count]) => ({ conversation_id: conversationId, count })) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/activity/:id/read', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const activity = (await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, limit: 100 })).rows.find((row) => row.id === req.params.id);
    if (!activity) return res.status(404).json({ error: 'Slack activity not found.' });
    const now = new Date().toISOString();
    const result = await supabase.from('slack_activity_read_states').upsert({ workspace_id: workspaceId, slack_activity_id: activity.id, ledger_user_id: req.authUser.id, read_at: req.body?.read === false ? null : now, updated_at: now }, { onConflict: 'slack_activity_id,ledger_user_id' }).select('slack_activity_id, read_at, dismissed_at').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/activity/:id/dismiss', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const activity = (await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, limit: 100 })).rows.find((row) => row.id === req.params.id);
    if (!activity) return res.status(404).json({ error: 'Slack activity not found.' });
    const now = new Date().toISOString();
    const result = await supabase.from('slack_activity_read_states').upsert({ workspace_id: workspaceId, slack_activity_id: activity.id, ledger_user_id: req.authUser.id, dismissed_at: now, updated_at: now }, { onConflict: 'slack_activity_id,ledger_user_id' }).select('slack_activity_id, read_at, dismissed_at').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/activity/:id/intake', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const activity = (await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, limit: 100 })).rows.find((row) => row.id === req.params.id);
    if (!activity) return res.status(404).json({ error: 'Slack activity not found.' });
    const result = await promoteSlackActivityToIntake({ workspaceId, userId: req.authUser.id, activity });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/activity/read-all', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const rows = (await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, date: String(req.body?.date ?? ''), filter: String(req.body?.filter ?? 'all'), unreadOnly: true, limit: 100 })).rows;
    const now = new Date().toISOString();
    for (const activity of rows) await supabase.from('slack_activity_read_states').upsert({ workspace_id: workspaceId, slack_activity_id: activity.id, ledger_user_id: req.authUser.id, read_at: now, updated_at: now }, { onConflict: 'slack_activity_id,ledger_user_id' });
    res.json({ count: rows.length, read_at: now });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/watches/:id/read', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const watch = await loadSlackWatchForWorkspace(workspaceId, req.params.id);
    if (!watch || (watch.watch_type === 'personal' && watch.owner_user_id !== req.authUser.id)) return res.status(404).json({ error: 'Slack watch not found.' });
    const now = new Date().toISOString();
    const result = await supabase.from('slack_watch_read_states').upsert({ workspace_id: workspaceId, slack_watch_id: watch.id, ledger_user_id: req.authUser.id, last_viewed_message_ts: req.body?.last_viewed_message_ts ?? null, last_viewed_at: now, updated_at: now }, { onConflict: 'slack_watch_id,ledger_user_id' }).select('slack_watch_id, last_viewed_message_ts, last_viewed_at').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/activity/:id/context-link', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const activity = (await loadVisibleSlackActivities({ workspaceId, userId: req.authUser.id, limit: 100 })).rows.find((row) => row.id === req.params.id);
    if (!activity) return res.status(404).json({ error: 'Slack activity not found.' });
    const contextId = await resolveSlackContextFromActivity(workspaceId, activity);
    const link = await linkSlackContextToTarget({ workspaceId, slackContextId: contextId, targetType: req.body?.target_type, targetId: req.body?.target_id, userId: req.authUser.id, relationshipType: 'activity' });
    const context = await loadSlackContextForWorkspace(workspaceId, contextId);
    void refreshSlackContextBestEffort(workspaceId, context);
    res.status(201).json({ context_id: contextId, link });
  } catch (error) { return respondWithError(res, error); }
});

const slackContextSelect = 'id, workspace_id, integration_account_id, slack_team_id, slack_channel_id, slack_channel_name, root_message_ts, captured_message_ts, message_text, message_author_slack_id, message_author_name, message_author_avatar_url, permalink, message_created_at, captured_at, sync_status, last_synced_at, reply_count, latest_reply_at, created_at, updated_at';
const slackIdentitySelect = 'id, workspace_id, ledger_user_id, integration_account_id, slack_team_id, slack_user_id, slack_display_name, slack_real_name, slack_email, slack_avatar_url, status, linked_at, last_verified_at, disconnected_at, error_code, created_at, updated_at';

app.get('/api/integrations/slack/identity', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase
      .from('slack_identities')
      .select(slackIdentitySelect)
      .eq('workspace_id', workspaceId)
      .eq('ledger_user_id', req.authUser.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      if (isMissingRelationError(result.error, 'slack_identities')) return res.json({ identity: null, status: 'disconnected' });
      throw result.error;
    }
    res.json({ identity: result.data ?? null, status: result.data?.status ?? 'disconnected' });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/slack/identity/connect-url', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const connection = await supabase
      .from('integration_accounts')
      .select('provider_team_id')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'slack')
      .not('provider_team_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data?.provider_team_id) {
      return res.status(409).json({ error: 'Connect the Slack workspace before linking your Slack identity.' });
    }
    res.json({ url: buildSlackIdentityAuthorizeUrl({ workspaceId, userId: req.authUser.id, teamId: connection.data.provider_team_id }) });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/slack/identity', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase
      .from('slack_identities')
      .update({
        status: 'disconnected',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('ledger_user_id', req.authUser.id);
    if (result.error) throw result.error;
    const watches = await supabase.from('slack_watches').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('owner_user_id', req.authUser.id).eq('watch_type', 'personal').in('status', ['active', 'access_lost']);
    if (watches.error && !isMissingRelationError(watches.error, 'slack_watches')) throw watches.error;
    res.json({ success: true, status: 'disconnected' });
  } catch (error) {
    return respondWithError(res, error);
  }
});

const slackWatchSelect = 'id, workspace_id, integration_account_id, slack_team_id, slack_conversation_id, created_by_user_id, owner_user_id, watch_type, conversation_type, conversation_name, status, watch_started_at, activation_latest_message_ts, last_activity_at, created_at, updated_at';

const loadSlackWatchForWorkspace = async (workspaceId, watchId) => {
  const result = await supabase
    .from('slack_watches')
    .select(slackWatchSelect)
    .eq('workspace_id', workspaceId)
    .eq('id', watchId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
};

const loadSlackWatchPreferences = async ({ workspaceId, watchIds, userId }) => {
  if (!watchIds.length) return new Map();
  const result = await supabase
    .from('slack_watch_preferences')
    .select('id, slack_watch_id, user_id, include_in_daily_recap, show_mentions, show_replies, show_active_threads, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .in('slack_watch_id', watchIds);
  if (result.error) throw result.error;
  return new Map((result.data ?? []).map((row) => [row.slack_watch_id, row]));
};

const serializeSlackWatch = (watch, preferences = null) => ({
  ...watch,
  preferences: preferences ?? {
    include_in_daily_recap: true,
    show_mentions: true,
    show_replies: true,
    show_active_threads: true,
  },
  permalink: watch.integration_account_id && watch.slack_conversation_id
    ? `https://app.slack.com/client/${encodeURIComponent(watch.slack_team_id || '')}/${encodeURIComponent(watch.slack_conversation_id)}`
    : null,
});

app.get('/api/integrations/slack/conversations', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const identity = await loadConnectedSlackIdentity({ workspaceId, userId: req.authUser.id });
    if (!identity) return res.status(409).json({ error: 'Connect your Slack identity to choose conversations to watch.' });

    const search = String(req.query?.search ?? '').trim().slice(0, 120).toLowerCase();
    const watchResult = await supabase
      .from('slack_watches')
      .select(slackWatchSelect)
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'paused', 'access_lost', 'disconnected']);
    if (watchResult.error) throw watchResult.error;
    const watches = (watchResult.data ?? []).filter((watch) => watch.watch_type === 'shared' || watch.owner_user_id === req.authUser.id);
    const watchMap = new Map();
    for (const watch of watches) {
      const current = watchMap.get(watch.slack_conversation_id) ?? {};
      current[watch.watch_type] = watch;
      watchMap.set(watch.slack_conversation_id, current);
    }

    const conversations = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const payload = await slackApiRequest('users.conversations', identity.access_token_encrypted, {
        types: 'public_channel,private_channel,mpim',
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      conversations.push(...(payload.channels ?? []));
      cursor = payload.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    const mapped = conversations
      .filter((conversation) => !search || String(conversation.name ?? '').toLowerCase().includes(search))
      .map((conversation) => mapSlackConversation(conversation, identity.slack_team_id, watchMap.get(conversation.id) ?? {}));
    const accessibleConversationIds = new Set(conversations.map((conversation) => conversation.id));
    const inaccessibleWatchIds = watches
      .filter((watch) => watch.watch_type === 'personal' && watch.status === 'active' && !accessibleConversationIds.has(watch.slack_conversation_id))
      .map((watch) => watch.id);
    if (inaccessibleWatchIds.length) {
      await supabase.from('slack_watches').update({ status: 'access_lost', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).in('id', inaccessibleWatchIds);
    }
    res.json(mapped);
  } catch (error) {
    if (['token_revoked', 'token_expired', 'invalid_auth', 'missing_scope', 'not_allowed_token_type'].includes(error?.slackError)) {
      return res.status(409).json({ error: 'Reconnect your Slack identity to choose conversations to watch.', code: 'reauthorization_required' });
    }
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/slack/watches', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase.from('slack_watches').select(slackWatchSelect).eq('workspace_id', workspaceId).in('status', ['active', 'paused', 'access_lost', 'disconnected']).order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    const watches = (result.data ?? []).filter((watch) => watch.watch_type === 'shared' || watch.owner_user_id === req.authUser.id);
    const preferences = await loadSlackWatchPreferences({ workspaceId, watchIds: watches.map((watch) => watch.id), userId: req.authUser.id });
    res.json(watches.map((watch) => serializeSlackWatch(watch, preferences.get(watch.id) ?? null)));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/integrations/slack/watches', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const identity = await loadConnectedSlackIdentity({ workspaceId, userId: req.authUser.id });
    if (!identity) return res.status(409).json({ error: 'Connect your Slack identity to choose conversations to watch.' });
    const watchType = String(req.body?.watch_type ?? 'personal').trim();
    const conversationId = String(req.body?.slack_conversation_id ?? '').trim();
    if (!['personal', 'shared'].includes(watchType) || !conversationId) return res.status(400).json({ error: 'Choose a valid Slack conversation.' });

    const workspace = await supabase.from('workspaces').select('id, is_personal, owner_id').eq('id', workspaceId).maybeSingle();
    if (workspace.error) throw workspace.error;
    if (watchType === 'shared') {
      if (workspace.data?.is_personal) return res.status(403).json({ error: 'Shared Slack watches are only available in team workspaces.' });
      await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    }

    const conversationPayload = await slackApiRequest('conversations.info', identity.access_token_encrypted, { channel: conversationId, include_num_members: true });
    const conversation = conversationPayload.channel ?? {};
    if (!conversation.id || conversation.id !== conversationId) return res.status(404).json({ error: 'Slack conversation not found.' });
    const conversationType = mapSlackConversation(conversation, identity.slack_team_id).conversation_type;
    if (conversationType === 'direct_message') return res.status(403).json({ error: 'Direct messages cannot be watched yet.' });
    if (watchType === 'shared' && conversationType !== 'public_channel') return res.status(403).json({ error: 'Only public Slack channels can be watched for the workspace.' });

    let existingQuery = supabase.from('slack_watches').select(slackWatchSelect).eq('workspace_id', workspaceId).eq('integration_account_id', identity.integration_account_id).eq('slack_conversation_id', conversationId).eq('watch_type', watchType).neq('status', 'removed');
    existingQuery = watchType === 'personal' ? existingQuery.eq('owner_user_id', req.authUser.id) : existingQuery.is('owner_user_id', null);
    const existing = await existingQuery.maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.status !== 'active') {
        const reactivated = await supabase.from('slack_watches').update({ status: 'active', conversation_name: conversation.name || existing.data.conversation_name, watch_started_at: new Date().toISOString(), activation_latest_message_ts: conversation.latest?.ts ?? null, updated_at: new Date().toISOString() }).eq('id', existing.data.id).eq('workspace_id', workspaceId).select(slackWatchSelect).single();
        if (reactivated.error) throw reactivated.error;
        existing.data = reactivated.data;
      }
      const preferences = await loadSlackWatchPreferences({ workspaceId, watchIds: [existing.data.id], userId: req.authUser.id });
      return res.json(serializeSlackWatch(existing.data, preferences.get(existing.data.id) ?? null));
    }

    const now = new Date().toISOString();
    const inserted = await supabase.from('slack_watches').insert({
      workspace_id: workspaceId,
      integration_account_id: identity.integration_account_id,
      slack_team_id: identity.slack_team_id,
      slack_conversation_id: conversationId,
      created_by_user_id: req.authUser.id,
      owner_user_id: watchType === 'personal' ? req.authUser.id : null,
      watch_type: watchType,
      conversation_type: conversationType,
      conversation_name: conversation.name || 'Slack conversation',
      status: 'active',
      watch_started_at: now,
      activation_latest_message_ts: conversation.latest?.ts ?? null,
      updated_at: now,
    }).select(slackWatchSelect).single();
    if (inserted.error) throw inserted.error;
    const preference = await supabase.from('slack_watch_preferences').upsert({ workspace_id: workspaceId, slack_watch_id: inserted.data.id, user_id: req.authUser.id, updated_at: now }, { onConflict: 'slack_watch_id,user_id' }).select('id, slack_watch_id, user_id, include_in_daily_recap, show_mentions, show_replies, show_active_threads, created_at, updated_at').single();
    if (preference.error) throw preference.error;
    res.status(201).json(serializeSlackWatch(inserted.data, preference.data));
  } catch (error) {
    if (error?.slackError === 'channel_not_found' || error?.slackError === 'not_in_channel') return res.status(404).json({ error: 'You no longer have access to this Slack conversation.' });
    if (['token_revoked', 'token_expired', 'invalid_auth', 'missing_scope', 'not_allowed_token_type'].includes(error?.slackError)) return res.status(409).json({ error: 'Reconnect your Slack identity to choose conversations to watch.', code: 'reauthorization_required' });
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/slack/watches/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const watch = await loadSlackWatchForWorkspace(workspaceId, req.params.id);
    if (!watch) return res.status(404).json({ error: 'Slack watch not found.' });
    if (watch.watch_type === 'personal') {
      if (watch.owner_user_id !== req.authUser.id) return res.status(403).json({ error: 'You do not have access to this Slack watch.' });
    } else {
      await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    }
    const result = await supabase.from('slack_watches').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', watch.id).eq('workspace_id', workspaceId);
    if (result.error) throw result.error;
    res.json({ success: true, status: 'removed' });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/integrations/slack/watches/:id/preferences', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const watch = await loadSlackWatchForWorkspace(workspaceId, req.params.id);
    if (!watch || (watch.watch_type === 'personal' && watch.owner_user_id !== req.authUser.id)) return res.status(404).json({ error: 'Slack watch not found.' });
    const payload = {};
    for (const field of ['include_in_daily_recap', 'show_mentions', 'show_replies', 'show_active_threads']) {
      if (typeof req.body?.[field] === 'boolean') payload[field] = req.body[field];
    }
    const result = await supabase.from('slack_watch_preferences').upsert({ workspace_id: workspaceId, slack_watch_id: watch.id, user_id: req.authUser.id, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'slack_watch_id,user_id' }).select('id, slack_watch_id, user_id, include_in_daily_recap, show_mentions, show_replies, show_active_threads, created_at, updated_at').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) {
    return respondWithError(res, error);
  }
});

const loadSlackContextForWorkspace = async (workspaceId, contextId) => {
  const result = await supabase
    .from('slack_contexts')
    .select(slackContextSelect)
    .eq('workspace_id', workspaceId)
    .eq('id', contextId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
};

const loadSlackThreadForUser = async (workspaceId, contextId, userId) => {
  const context = await loadSlackContextForWorkspace(workspaceId, contextId);
  if (!context) return null;
  const replies = await supabase.from('slack_thread_replies').select('id, slack_context_id, slack_message_ts, slack_user_id, author_name, author_avatar_url, message_text, permalink, source_created_at, edited_at, deleted_at, is_edited, is_deleted').eq('workspace_id', workspaceId).eq('slack_context_id', context.id).order('source_created_at', { ascending: true });
  if (replies.error) throw replies.error;
  const read = await supabase.from('slack_context_read_states').select('last_viewed_reply_ts, last_viewed_at, unread_reply_count').eq('workspace_id', workspaceId).eq('slack_context_id', context.id).eq('ledger_user_id', userId).maybeSingle();
  if (read.error) throw read.error;
  const follow = await supabase.from('slack_context_follows').select('id').eq('workspace_id', workspaceId).eq('slack_context_id', context.id).eq('ledger_user_id', userId).maybeSingle();
  if (follow.error) throw follow.error;
  const lastViewed = read.data?.last_viewed_reply_ts;
  const unreadReplyCount = lastViewed ? (replies.data ?? []).filter((reply) => String(reply.slack_message_ts) > String(lastViewed) && !reply.is_deleted).length : (replies.data ?? []).filter((reply) => !reply.is_deleted).length;
  return { context, replies: replies.data ?? [], is_following: Boolean(follow.data?.id), unread_reply_count: unreadReplyCount, read_state: read.data ?? null };
};

app.get('/api/integrations/slack/contexts/:id/thread', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const thread = await loadSlackThreadForUser(workspaceId, req.params.id, req.authUser.id);
    if (!thread) return res.status(404).json({ error: 'Slack thread not found.' });
    res.json(thread);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/contexts/:id/refresh', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const context = await loadSlackContextForWorkspace(workspaceId, req.params.id);
    if (!context) return res.status(404).json({ error: 'Slack thread not found.' });
    const workspaceToken = await loadSlackWorkspaceToken(workspaceId, context.integration_account_id);
    if (!workspaceToken?.access_token) return res.status(409).json({ error: 'Reconnect Slack to continue syncing this thread.' });
    try {
      const result = await syncSlackContextReplies({ workspaceId, context, token: workspaceToken.access_token });
      res.json({ ...result, ...(await loadSlackThreadForUser(workspaceId, context.id, req.authUser.id)) });
    } catch (error) {
      await supabase.from('slack_contexts').update({ sync_status: error?.slackError === 'channel_not_found' ? 'access_lost' : 'sync_error', updated_at: new Date().toISOString() }).eq('id', context.id).eq('workspace_id', workspaceId);
      throw error;
    }
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/contexts/:id/follow', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const context = await loadSlackContextForWorkspace(workspaceId, req.params.id);
    if (!context) return res.status(404).json({ error: 'Slack thread not found.' });
    const following = req.body?.following !== false;
    if (following) {
      const result = await supabase.from('slack_context_follows').upsert({ workspace_id: workspaceId, slack_context_id: context.id, ledger_user_id: req.authUser.id }, { onConflict: 'slack_context_id,ledger_user_id' }).select('id').single();
      if (result.error) throw result.error;
    } else {
      const result = await supabase.from('slack_context_follows').delete().eq('workspace_id', workspaceId).eq('slack_context_id', context.id).eq('ledger_user_id', req.authUser.id);
      if (result.error) throw result.error;
    }
    if (following) void refreshSlackContextBestEffort(workspaceId, context);
    res.json({ following });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/slack/contexts/:id/read', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const context = await loadSlackContextForWorkspace(workspaceId, req.params.id);
    if (!context) return res.status(404).json({ error: 'Slack thread not found.' });
    const lastReply = String(req.body?.last_viewed_reply_ts ?? context.latest_reply_at ?? context.root_message_ts);
    const result = await supabase.from('slack_context_read_states').upsert({ workspace_id: workspaceId, slack_context_id: context.id, ledger_user_id: req.authUser.id, last_viewed_reply_ts: lastReply, last_viewed_at: new Date().toISOString(), unread_reply_count: 0, updated_at: new Date().toISOString() }, { onConflict: 'slack_context_id,ledger_user_id' }).select('last_viewed_reply_ts, last_viewed_at, unread_reply_count').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/slack/contexts', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    const targetType = normalizeSlackContextTargetType(req.query?.target_type);
    const targetId = String(req.query?.target_id ?? '').trim();
    const search = String(req.query?.search ?? '').trim().slice(0, 120);
    const limit = Math.min(Math.max(Number(req.query?.limit ?? 30) || 30, 1), 100);

    if (targetType || targetId) {
      const table = slackContextTargetTables[targetType];
      if (!table || !targetId || !(await ensureWorkspaceResource(table, targetId, workspaceId))) {
        return res.status(404).json({ error: 'Linked Ledger object not found.' });
      }
      const links = await supabase
        .from('slack_context_links')
        .select('slack_context_id, target_type, target_id, relationship_type, created_at')
        .eq('workspace_id', workspaceId)
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .order('created_at', { ascending: false });
      if (links.error) throw links.error;
      const ids = (links.data ?? []).map((link) => link.slack_context_id).filter(Boolean);
      if (!ids.length) return res.json([]);
      const contexts = await supabase.from('slack_contexts').select(slackContextSelect).eq('workspace_id', workspaceId).in('id', ids).order('captured_at', { ascending: false });
      if (contexts.error) throw contexts.error;
      return res.json(contexts.data ?? []);
    }

    let query = supabase.from('slack_contexts').select(slackContextSelect).eq('workspace_id', workspaceId).order('captured_at', { ascending: false }).limit(limit);
    if (search) {
      const safeSearch = search.replace(/[%,]/g, '');
      query = query.or(`message_text.ilike.%${safeSearch}%,message_author_name.ilike.%${safeSearch}%,slack_channel_name.ilike.%${safeSearch}%`);
    }
    const result = await query;
    if (result.error) throw result.error;
    res.json(result.data ?? []);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/slack/contexts/:id', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    const context = await loadSlackContextForWorkspace(workspaceId, req.params.id);
    if (!context) return res.status(404).json({ error: 'Slack context not found.' });
    const links = await supabase.from('slack_context_links').select('id, target_type, target_id, relationship_type, created_at').eq('workspace_id', workspaceId).eq('slack_context_id', context.id).order('created_at', { ascending: false });
    if (links.error) throw links.error;
    res.json({ ...context, links: links.data ?? [] });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/integrations/slack/contexts/:id/links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const context = await loadSlackContextForWorkspace(workspaceId, req.params.id);
    if (!context) return res.status(404).json({ error: 'Slack context not found.' });
    const link = await linkSlackContextToTarget({
      workspaceId,
      slackContextId: context.id,
      targetType: req.body?.target_type,
      targetId: req.body?.target_id,
      userId: req.authUser.id,
      relationshipType: req.body?.relationship_type || 'context',
    });
    void refreshSlackContextBestEffort(workspaceId, context);
    res.status(201).json({ context, link });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/slack/context-links/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase.from('slack_context_links').delete().eq('workspace_id', workspaceId).eq('id', req.params.id);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/slack/disconnect', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');

    const now = new Date().toISOString();
    const identities = await supabase.from('slack_identities').update({ status: 'disconnected', access_token_encrypted: null, refresh_token_encrypted: null, disconnected_at: now, updated_at: now }).eq('workspace_id', workspaceId).neq('status', 'disconnected');
    if (identities.error && !isMissingRelationError(identities.error, 'slack_identities')) throw identities.error;
    const watches = await supabase.from('slack_watches').update({ status: 'paused', updated_at: now }).eq('workspace_id', workspaceId).in('status', ['active', 'access_lost']);
    if (watches.error && !isMissingRelationError(watches.error, 'slack_watches')) throw watches.error;

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
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
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
    const workspaceId = await resolveSlackWorkspaceForRequest(req);
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

    const oauthUserId = statePayload.flow === 'personal_identity'
      ? statePayload.user_id
      : statePayload.installed_by;
    await requireWorkspaceAccess(
      oauthUserId,
      statePayload.workspace_id,
      statePayload.flow === 'personal_identity' ? 'member' : 'admin'
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

    if (statePayload.flow === 'personal_identity') {
      const sharedConnection = await supabase
        .from('integration_accounts')
        .select('id, provider_team_id, provider_team_name')
        .eq('workspace_id', statePayload.workspace_id)
        .eq('provider', 'slack')
        .eq('provider_team_id', teamId)
        .maybeSingle();
      if (sharedConnection.error) throw sharedConnection.error;
      if (!sharedConnection.data?.id) {
        return res.status(409).type('html').send(buildSlackIdentityCompleteHtml({
          success: false,
          message: 'This Slack account does not belong to the Slack workspace connected to Ledger.',
        }));
      }

      const slackUserId = tokenPayload.authed_user?.id ?? null;
      const userAccessToken = tokenPayload.authed_user?.access_token ?? null;
      if (!slackUserId || !userAccessToken) {
        return res.status(400).type('html').send(buildSlackIdentityCompleteHtml({
          success: false,
          message: 'Slack did not return a personal identity for this account.',
        }));
      }

      const identityPayload = await slackApiRequest('users.info', userAccessToken, { user: slackUserId });
      if (!identityPayload?.ok || identityPayload.user?.id !== slackUserId) {
        console.error('Slack personal identity verification failed', identityPayload?.error ?? 'identity_lookup_failed');
        return res.status(400).type('html').send(buildSlackIdentityCompleteHtml({
          success: false,
          message: 'Ledger could not verify this Slack identity.',
        }));
      }

      const conflictingIdentity = await supabase
        .from('slack_identities')
        .select('id, ledger_user_id')
        .eq('workspace_id', statePayload.workspace_id)
        .eq('integration_account_id', sharedConnection.data.id)
        .eq('slack_user_id', slackUserId)
        .neq('status', 'disconnected')
        .neq('ledger_user_id', oauthUserId)
        .maybeSingle();
      if (conflictingIdentity.error) throw conflictingIdentity.error;
      if (conflictingIdentity.data?.id) {
        return res.status(409).type('html').send(buildSlackIdentityCompleteHtml({
          success: false,
          message: 'This Slack identity is already linked to another Ledger user.',
        }));
      }

      const slackUser = identityPayload.user ?? {};
      const profile = slackUser.profile ?? {};
      const now = new Date().toISOString();
      const identityResult = await supabase
        .from('slack_identities')
        .upsert({
          workspace_id: statePayload.workspace_id,
          ledger_user_id: oauthUserId,
          integration_account_id: sharedConnection.data.id,
          slack_team_id: teamId,
          slack_user_id: slackUserId,
          slack_display_name: profile.display_name || slackUser.name || null,
          slack_real_name: profile.real_name || slackUser.real_name || null,
          slack_email: profile.email || slackUser.email || null,
          slack_avatar_url: profile.image_72 || profile.image_192 || slackUser.image_72 || null,
          access_token_encrypted: protectIntegrationTokenForStorage(userAccessToken),
          refresh_token_encrypted: protectIntegrationTokenForStorage(tokenPayload.authed_user?.refresh_token),
          scopes: String(tokenPayload.authed_user?.scope ?? '')
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean),
          status: 'connected',
          linked_at: now,
          last_verified_at: now,
          disconnected_at: null,
          error_code: null,
          updated_at: now,
        }, { onConflict: 'workspace_id,ledger_user_id,integration_account_id' });
      if (identityResult.error) throw identityResult.error;
      return res.status(200).type('html').send(buildSlackIdentityCompleteHtml({
        success: true,
        message: `Connected ${profile.display_name || slackUser.name || 'your Slack identity'}.`,
      }));
    }

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
      provider_team_icon: tokenPayload.team?.icon ?? null,
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

const buildFigmaOAuthCompleteHtml = (success, message = '') => {
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Figma connection</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffbf7;color:#111827;font:14px system-ui,-apple-system,sans-serif}.content{width:min(320px,calc(100vw - 40px));text-align:center}h1{margin:0 0 8px;font-size:22px;letter-spacing:-.02em}p{margin:0;color:#6b7280;line-height:1.5}.button{display:inline-flex;margin-top:18px;padding:9px 15px;border-radius:999px;background:#ff5f40;color:white;text-decoration:none;font-weight:600}.button:hover{background:#f45135}</style></head><body><main class="content"><h1>${success ? 'Figma connected' : 'Figma wasn’t connected'}</h1><p>${safeMessage || (success ? 'Return to Ledger to manage the connection.' : 'Authorization was cancelled or denied.')}</p><a class="button" href="ledger://settings/integrations">Open Ledger</a></main>${success ? '<script>setTimeout(()=>{try{window.location.href="ledger://settings/integrations"}catch{}} ,120)</script>' : ''}</body></html>`;
};

app.post('/api/figma-plugin/auth/sessions', rateLimit('auth'), async (req, res) => {
  try {
    const clientId = String(req.body?.client_id ?? '').trim();
    const pluginSession = String(req.body?.plugin_session ?? '').trim();
    if (clientId !== FIGMA_PLUGIN_CLIENT_ID || pluginSession.length < 16 || pluginSession.length > 200) return res.status(400).json({ error: 'Invalid plugin client.' });
    const requestedScopes = Array.isArray(req.body?.scopes) && req.body.scopes.length
      ? [...new Set(req.body.scopes.map((scope) => String(scope).trim()))]
      : FIGMA_PLUGIN_SCOPES;
    if (requestedScopes.some((scope) => !FIGMA_PLUGIN_CLIENT_SCOPES.has(scope))) return res.status(400).json({ error: 'Invalid plugin permission request.' });
    const sessionId = crypto.randomUUID();
    const code = `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const pollSecret = crypto.randomBytes(24).toString('base64url');
    const result = await supabase.from('figma_plugin_authorization_sessions').insert({ id: sessionId, client_id: clientId, plugin_session_hash: hashPluginValue(pluginSession), poll_secret_hash: hashPluginValue(pollSecret), verification_code_hash: hashPluginValue(code), scopes: requestedScopes, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id, expires_at').single();
    if (result.error) throw result.error;
    res.json({ session_id: result.data.id, verification_code: code, poll_secret: pollSecret, expires_at: result.data.expires_at, authorization_url: getPluginAuthorizeUrl(result.data.id, code) });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/figma-plugin/auth/authorize', async (req, res) => {
  const sessionId = String(req.query?.session_id ?? '').trim();
  const code = String(req.query?.code ?? '').trim().toUpperCase();
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Ledger to Figma</title><style>body{font:15px system-ui;max-width:420px;margin:48px auto;padding:0 20px;color:#111827}button{background:#ff5f40;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:600}p{color:#4b5563;line-height:1.5}</style><h1>Connect Ledger to Figma</h1><p>Return to Ledger to approve this plugin connection. Verification code: <strong>${code.replace(/[^A-Z0-9-]/g, '')}</strong></p><p>Open Ledger in your browser if it is not already open, then approve the request there.</p><a href="${getPluginAuthorizeUrl(sessionId, code)}"><button>Open Ledger</button></a>`);
});

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ resource: MCP_OAUTH_RESOURCE, authorization_servers: [MCP_OAUTH_ISSUER], scopes_supported: MCP_SCOPES });
});

// OpenAI verifies ownership of the MCP hostname by reading the token generated
// in the app-publishing form. Keep this server-side and return the token as
// plain text only; it must never be exposed through the website bundle.
app.get(OPENAI_APPS_CHALLENGE_PATH, (_req, res) => {
  const token = getOpenAiAppsChallengeToken();
  if (!token) return res.status(404).type('text/plain').send('Not found');
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(token);
});

app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ resource: MCP_OAUTH_RESOURCE, authorization_servers: [MCP_OAUTH_ISSUER], scopes_supported: MCP_SCOPES });
});

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ issuer: MCP_OAUTH_ISSUER, authorization_endpoint: `${MCP_OAUTH_ISSUER}/oauth/authorize`, token_endpoint: `${MCP_OAUTH_ISSUER}/oauth/token`, registration_endpoint: `${MCP_OAUTH_ISSUER}/oauth/register`, revocation_endpoint: `${MCP_OAUTH_ISSUER}/oauth/revoke`, scopes_supported: MCP_SCOPES, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'] });
});

app.post('/oauth/register', rateLimit('mcp_auth'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const redirectUris = validateMcpRedirectUris(body.redirect_uris);
    const grantTypes = Array.isArray(body.grant_types) && body.grant_types.length ? body.grant_types.map(String) : ['authorization_code', 'refresh_token'];
    const responseTypes = Array.isArray(body.response_types) && body.response_types.length ? body.response_types.map(String) : ['code'];
    if (grantTypes.some((grant) => !['authorization_code', 'refresh_token'].includes(grant)) || responseTypes.some((type) => type !== 'code')) return mcpOAuthJson(res, 400, { error: 'invalid_client_metadata' });
    const authMethod = String(body.token_endpoint_auth_method || 'none');
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) return mcpOAuthJson(res, 400, { error: 'invalid_client_metadata' });
    const clientId = `ledger_mcp_client_${crypto.randomBytes(18).toString('base64url')}`;
    const clientSecret = authMethod === 'none' ? null : createMcpOAuthSecret('ledger_mcp_secret');
    const inserted = await supabase.from('mcp_oauth_clients').insert({ client_id: clientId, client_secret_hash: clientSecret ? hashMcpOAuthSecret(clientSecret) : null, client_name: clampText(body.client_name || body.client_name, 120) || 'MCP client', redirect_uris: redirectUris, grant_types: grantTypes, response_types: responseTypes, token_endpoint_auth_method: authMethod, metadata: { logo_uri: clampText(body.logo_uri, 500) || null } }).select('client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method').single();
    if (inserted.error) throw inserted.error;
    const registration = { ...inserted.data, client_id_issued_at: Math.floor(Date.now() / 1000) };
    if (clientSecret) registration.client_secret = clientSecret;
    return res.status(201).json(registration);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/oauth/authorize', rateLimit('mcp_auth'), async (req, res) => {
  try {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    const client = await loadMcpOAuthClient(clientId);
    if (!client || !client.response_types?.includes('code') || !client.redirect_uris?.includes(redirectUri)) return mcpOAuthJson(res, 400, { error: 'invalid_request', error_description: 'The OAuth client or redirect URI is invalid.' });
    if (String(req.query.response_type ?? '') !== 'code') return mcpOAuthJson(res, 400, { error: 'unsupported_response_type' });
    const scopes = oauthScopes(req.query.scope);
    if (!scopes.length || scopes.some((scope) => !MCP_OAUTH_SCOPES.has(scope))) return mcpOAuthJson(res, 400, { error: 'invalid_scope' });
    if (String(req.query.code_challenge_method ?? '') !== 'S256' || !/^[A-Za-z0-9._~-]{43,128}$/.test(String(req.query.code_challenge ?? ''))) return mcpOAuthJson(res, 400, { error: 'invalid_request', error_description: 'S256 PKCE is required.' });
    if (String(req.query.resource ?? MCP_OAUTH_RESOURCE) !== MCP_OAUTH_RESOURCE) return mcpOAuthJson(res, 400, { error: 'invalid_target' });
    const request = await supabase.from('mcp_oauth_authorization_requests').insert({ client_id: client.id, redirect_uri: redirectUri, response_type: 'code', requested_scopes: scopes, state: String(req.query.state ?? '').slice(0, 2048) || null, code_challenge: String(req.query.code_challenge), code_challenge_method: 'S256', resource: MCP_OAUTH_RESOURCE, expires_at: new Date(Date.now() + MCP_OAUTH_AUTH_TTL_SECONDS * 1000).toISOString() }).select('id').single();
    if (request.error) throw request.error;
    const consentUrl = `${MCP_OAUTH_FRONTEND}/integrations/mcp/authorize?request_id=${encodeURIComponent(request.data.id)}`;
    return res.redirect(302, consentUrl);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/oauth/authorize/requests/:id', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const request = await supabase.from('mcp_oauth_authorization_requests').select('id, client_id, requested_scopes, resource, expires_at, status').eq('id', req.params.id).maybeSingle();
    if (request.error || !request.data || request.data.status !== 'pending' || new Date(request.data.expires_at).getTime() <= Date.now()) return res.status(404).json({ error: 'This authorization request is invalid or expired.' });
    const [client, workspaces] = await Promise.all([
      supabase.from('mcp_oauth_clients').select('client_name').eq('id', request.data.client_id).maybeSingle(),
      getAccessibleWorkspaces(req.authUser.id),
    ]);
    if (client.error || !client.data) return res.status(404).json({ error: 'This authorization request is invalid or expired.' });
    res.json({ id: request.data.id, client_name: client.data.client_name, resource: request.data.resource, requested_scopes: request.data.requested_scopes, expires_at: request.data.expires_at, workspaces: workspaces.map(({ id, name, is_personal }) => ({ id, name, type: is_personal ? 'personal' : 'team' })) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/oauth/authorize/requests/:id/approve', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const request = await supabase.from('mcp_oauth_authorization_requests').select('id, client_id, redirect_uri, requested_scopes, state, code_challenge, code_challenge_method, resource, status, expires_at').eq('id', req.params.id).maybeSingle();
    if (request.error || !request.data || request.data.status !== 'pending' || new Date(request.data.expires_at).getTime() <= Date.now()) return res.status(400).json({ error: 'This authorization request is invalid or expired.' });
    const workspaceId = String(req.body?.workspace_id ?? '');
    const access = await getWorkspaceAccess(req.authUser.id, workspaceId);
    if (!access) return res.status(403).json({ error: 'Workspace access is no longer available.' });
    if (request.data.requested_scopes.some((scope) => MCP_OAUTH_WRITE_SCOPES.has(scope))) await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const rawCode = createMcpOAuthSecret('ledger_mcp_code');
    const code = await supabase.from('mcp_oauth_authorization_codes').insert({ client_id: request.data.client_id, request_id: request.data.id, code_hash: hashMcpOAuthSecret(rawCode), redirect_uri: request.data.redirect_uri, user_id: req.authUser.id, workspace_id: workspaceId, scopes: request.data.requested_scopes, resource: request.data.resource, code_challenge: request.data.code_challenge, code_challenge_method: request.data.code_challenge_method, expires_at: new Date(Date.now() + 60 * 1000).toISOString() }).select('id').single();
    if (code.error) throw code.error;
    const updated = await supabase.from('mcp_oauth_authorization_requests').update({ user_id: req.authUser.id, workspace_id: workspaceId, status: 'approved', approved_at: new Date().toISOString() }).eq('id', request.data.id).eq('status', 'pending').select('id').maybeSingle();
    if (updated.error || !updated.data) return res.status(409).json({ error: 'This authorization request was already completed.' });
    await writeMcpAuditLog({ userId: req.authUser.id, workspaceId, action: 'oauth.authorization.approved', metadata: { client_id: request.data.client_id, scopes: request.data.requested_scopes } });
    return res.json({ redirect_uri: mcpOAuthRedirect(request.data.redirect_uri, { code: rawCode, state: request.data.state }) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/oauth/authorize/requests/:id/deny', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const request = await supabase.from('mcp_oauth_authorization_requests').select('id, redirect_uri, state, status, expires_at').eq('id', req.params.id).maybeSingle();
    if (request.error || !request.data || request.data.status !== 'pending' || new Date(request.data.expires_at).getTime() <= Date.now()) return res.status(400).json({ error: 'This authorization request is invalid or expired.' });
    const updated = await supabase.from('mcp_oauth_authorization_requests').update({ status: 'denied' }).eq('id', request.data.id).eq('status', 'pending').select('id').maybeSingle();
    if (updated.error || !updated.data) return res.status(409).json({ error: 'This authorization request was already completed.' });
    return res.json({ redirect_uri: mcpOAuthRedirect(request.data.redirect_uri, { error: 'access_denied', error_description: 'The Ledger connection was cancelled.', state: request.data.state }) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/oauth/token', rateLimit('mcp_auth'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = oauthClientAuthentication(req, body);
    const client = await loadMcpOAuthClient(auth.clientId);
    if (!client || (client.token_endpoint_auth_method === 'none' && auth.clientSecret) || (client.token_endpoint_auth_method !== 'none' && !mcpValueMatches(auth.clientSecret, client.client_secret_hash))) return mcpOAuthJson(res, 401, { error: 'invalid_client' });
    if (body.grant_type === 'authorization_code') {
      if (!client.grant_types?.includes('authorization_code')) return mcpOAuthJson(res, 400, { error: 'unauthorized_client' });
      const rawCode = String(body.code ?? '');
      const row = await supabase.from('mcp_oauth_authorization_codes').select('id, client_id, redirect_uri, user_id, workspace_id, scopes, resource, code_challenge, code_challenge_method, expires_at, consumed_at').eq('code_hash', hashMcpOAuthSecret(rawCode)).maybeSingle();
      if (row.error || !row.data || row.data.client_id !== client.id || row.data.consumed_at || new Date(row.data.expires_at).getTime() <= Date.now() || row.data.redirect_uri !== String(body.redirect_uri ?? '') || row.data.resource !== String(body.resource ?? MCP_OAUTH_RESOURCE)) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      const verifier = String(body.code_verifier ?? '');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (!verifier || challenge !== row.data.code_challenge) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      const consumed = await supabase.from('mcp_oauth_authorization_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.data.id).is('consumed_at', null).select('id').maybeSingle();
      if (consumed.error || !consumed.data) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      const connectionSecret = createMcpCredential();
      const connection = await supabase.from('mcp_connections').insert({ user_id: row.data.user_id, client_name: client.client_name, credential_hash: hashMcpValue(connectionSecret), oauth_client_id: client.id, expires_at: new Date(Date.now() + MCP_OAUTH_REFRESH_TTL_SECONDS * 1000).toISOString() }).select('id').single();
      if (connection.error) throw connection.error;
      const [scopeInsert, workspaceInsert] = await Promise.all([
        supabase.from('mcp_connection_scopes').insert(row.data.scopes.map((scope) => ({ connection_id: connection.data.id, scope }))),
        supabase.from('mcp_connection_workspaces').insert({ connection_id: connection.data.id, workspace_id: row.data.workspace_id }),
      ]);
      if (scopeInsert.error || workspaceInsert.error) throw scopeInsert.error || workspaceInsert.error;
      const accessToken = createMcpOAuthSecret('ledger_mcp_access');
      const refreshToken = createMcpOAuthSecret('ledger_mcp_refresh');
      const access = await supabase.from('mcp_oauth_access_tokens').insert({ token_hash: hashMcpOAuthSecret(accessToken), connection_id: connection.data.id, client_id: client.id, user_id: row.data.user_id, workspace_id: row.data.workspace_id, scopes: row.data.scopes, resource: MCP_OAUTH_RESOURCE, expires_at: new Date(Date.now() + MCP_OAUTH_ACCESS_TTL_SECONDS * 1000).toISOString() });
      const refresh = await supabase.from('mcp_oauth_refresh_tokens').insert({ token_hash: hashMcpOAuthSecret(refreshToken), family_id: crypto.randomUUID(), connection_id: connection.data.id, client_id: client.id, user_id: row.data.user_id, workspace_id: row.data.workspace_id, scopes: row.data.scopes, resource: MCP_OAUTH_RESOURCE, expires_at: new Date(Date.now() + MCP_OAUTH_REFRESH_TTL_SECONDS * 1000).toISOString() });
      if (access.error || refresh.error) throw access.error || refresh.error;
      await writeMcpAuditLog({ connectionId: connection.data.id, userId: row.data.user_id, workspaceId: row.data.workspace_id, action: 'oauth.credential.issued', metadata: { client_id: client.id, scopes: row.data.scopes } });
      return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: MCP_OAUTH_ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope: oauthScopeString(row.data.scopes), resource: MCP_OAUTH_RESOURCE });
    }
    if (body.grant_type === 'refresh_token') {
      const old = await supabase.from('mcp_oauth_refresh_tokens').select('id, family_id, connection_id, client_id, user_id, workspace_id, scopes, resource, expires_at, used_at, revoked_at').eq('token_hash', hashMcpOAuthSecret(String(body.refresh_token ?? ''))).maybeSingle();
      if (old.error || !old.data || old.data.client_id !== client.id || old.data.resource !== String(body.resource ?? MCP_OAUTH_RESOURCE) || new Date(old.data.expires_at).getTime() <= Date.now() || old.data.revoked_at) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      const [connection, membership] = await Promise.all([
        supabase.from('mcp_connections').select('status, revoked_at, expires_at').eq('id', old.data.connection_id).maybeSingle(),
        getWorkspaceAccess(old.data.user_id, old.data.workspace_id),
      ]);
      if (connection.error || !connection.data || connection.data.status !== 'active' || connection.data.revoked_at || new Date(connection.data.expires_at).getTime() <= Date.now() || !membership) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      if (old.data.used_at) { await supabase.from('mcp_oauth_refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', old.data.family_id); await supabase.from('mcp_oauth_access_tokens').update({ revoked_at: new Date().toISOString() }).eq('connection_id', old.data.connection_id); return mcpOAuthJson(res, 400, { error: 'invalid_grant' }); }
      const marked = await supabase.from('mcp_oauth_refresh_tokens').update({ used_at: new Date().toISOString() }).eq('id', old.data.id).is('used_at', null).select('id').maybeSingle();
      if (marked.error || !marked.data) return mcpOAuthJson(res, 400, { error: 'invalid_grant' });
      const currentScopes = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', old.data.connection_id);
      if (currentScopes.error) throw currentScopes.error;
      const effectiveScopes = (old.data.scopes ?? []).filter((scope) => (currentScopes.data ?? []).some((current) => current.scope === scope));
      const accessToken = createMcpOAuthSecret('ledger_mcp_access');
      const refreshToken = createMcpOAuthSecret('ledger_mcp_refresh');
      const access = await supabase.from('mcp_oauth_access_tokens').insert({ token_hash: hashMcpOAuthSecret(accessToken), connection_id: old.data.connection_id, client_id: client.id, user_id: old.data.user_id, workspace_id: old.data.workspace_id, scopes: effectiveScopes, resource: MCP_OAUTH_RESOURCE, expires_at: new Date(Date.now() + MCP_OAUTH_ACCESS_TTL_SECONDS * 1000).toISOString() });
      const refresh = await supabase.from('mcp_oauth_refresh_tokens').insert({ token_hash: hashMcpOAuthSecret(refreshToken), family_id: old.data.family_id, connection_id: old.data.connection_id, client_id: client.id, user_id: old.data.user_id, workspace_id: old.data.workspace_id, scopes: effectiveScopes, resource: MCP_OAUTH_RESOURCE, expires_at: new Date(Date.now() + MCP_OAUTH_REFRESH_TTL_SECONDS * 1000).toISOString() });
      if (access.error || refresh.error) throw access.error || refresh.error;
      return res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: MCP_OAUTH_ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope: oauthScopeString(effectiveScopes), resource: MCP_OAUTH_RESOURCE });
    }
    return mcpOAuthJson(res, 400, { error: 'unsupported_grant_type' });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/oauth/revoke', rateLimit('mcp_auth'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = oauthClientAuthentication(req, body);
    const client = await loadMcpOAuthClient(auth.clientId);
    if (!client || (client.token_endpoint_auth_method !== 'none' && !mcpValueMatches(auth.clientSecret, client.client_secret_hash))) return mcpOAuthJson(res, 401, { error: 'invalid_client' });
    const hash = hashMcpOAuthSecret(String(body.token ?? ''));
    await Promise.all([
      supabase.from('mcp_oauth_access_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash).eq('client_id', client.id),
      supabase.from('mcp_oauth_refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash).eq('client_id', client.id),
    ]);
    res.status(200).json({});
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/mcp/workspace-switches/:id', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const session = await supabase.from('mcp_workspace_switch_sessions').select('id, connection_id, user_id, current_workspace_id, requested_workspace_id, status, expires_at').eq('id', req.params.id).maybeSingle();
    if (session.error || !session.data || session.data.user_id !== req.authUser.id || session.data.status !== 'pending' || new Date(session.data.expires_at).getTime() <= Date.now()) return res.status(404).json({ error: 'This workspace switch request is invalid or expired.' });
    const [connection, current, workspaces] = await Promise.all([
      supabase.from('mcp_connections').select('client_name, status, expires_at').eq('id', session.data.connection_id).maybeSingle(),
      getWorkspaceSummary(session.data.current_workspace_id),
      getAccessibleWorkspaces(req.authUser.id),
    ]);
    if (connection.error || !connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) return res.status(401).json({ error: 'Connection expired or revoked.' });
    res.json({ id: session.data.id, client_name: connection.data.client_name, current_workspace: current ? { id: current.id, name: current.name, type: current.is_personal ? 'personal' : 'team' } : null, requested_workspace_id: session.data.requested_workspace_id, expires_at: session.data.expires_at, workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, type: workspace.is_personal ? 'personal' : 'team' })) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/workspace-switches/:id/approve', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const session = await supabase.from('mcp_workspace_switch_sessions').select('id, connection_id, user_id, current_workspace_id, requested_workspace_id, user_code_hash, status, expires_at').eq('id', req.params.id).maybeSingle();
    const code = String(req.body?.verification_code ?? '').trim().toUpperCase();
    if (session.error || !session.data || session.data.user_id !== req.authUser.id || session.data.status !== 'pending' || new Date(session.data.expires_at).getTime() <= Date.now() || !mcpValueMatches(code, session.data.user_code_hash)) return res.status(400).json({ error: 'This workspace switch request is invalid or expired.' });
    const targetWorkspaceId = String(req.body?.workspace_id ?? '').trim();
    const access = await getWorkspaceAccess(req.authUser.id, targetWorkspaceId);
    if (!access) return res.status(403).json({ error: 'Workspace access is no longer available.' });
    const scopes = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', session.data.connection_id);
    if (scopes.error) throw scopes.error;
    if ((scopes.data ?? []).some((row) => MCP_WRITE_SCOPES.includes(row.scope))) await requireWorkspaceAccess(req.authUser.id, targetWorkspaceId, 'member');
    const connection = await supabase.from('mcp_connections').select('id, status, expires_at').eq('id', session.data.connection_id).eq('user_id', req.authUser.id).maybeSingle();
    if (connection.error || !connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) return res.status(401).json({ error: 'Connection expired or revoked.' });
    const binding = await supabase.from('mcp_connection_workspaces').update({ workspace_id: targetWorkspaceId }).eq('connection_id', session.data.connection_id).eq('workspace_id', session.data.current_workspace_id).select('connection_id').maybeSingle();
    if (binding.error || !binding.data) return res.status(409).json({ error: 'The workspace binding could not be changed.' });
    await Promise.all([
      supabase.from('mcp_oauth_access_tokens').update({ workspace_id: targetWorkspaceId }).eq('connection_id', session.data.connection_id).is('revoked_at', null),
      supabase.from('mcp_oauth_refresh_tokens').update({ workspace_id: targetWorkspaceId }).eq('connection_id', session.data.connection_id).is('revoked_at', null),
    ]);
    const updated = await supabase.from('mcp_workspace_switch_sessions').update({ status: 'approved', approved_workspace_id: targetWorkspaceId, approved_at: new Date().toISOString() }).eq('id', session.data.id).eq('status', 'pending').select('id').maybeSingle();
    if (updated.error || !updated.data) return res.status(409).json({ error: 'This workspace switch request was already completed.' });
    await writeMcpAuditLog({ connectionId: session.data.connection_id, userId: req.authUser.id, workspaceId: targetWorkspaceId, action: 'workspace_switch.approved', metadata: { previous_workspace_id: session.data.current_workspace_id, workspace_id: targetWorkspaceId } });
    res.json({ approved: true, workspace_id: targetWorkspaceId });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/workspace-switches/poll', rateLimit('mcp_poll'), async (req, res) => {
  try {
    const session = await supabase.from('mcp_workspace_switch_sessions').select('id, connection_id, poll_secret_hash, status, approved_workspace_id, expires_at, consumed_at').eq('id', String(req.body?.session_id ?? '')).maybeSingle();
    const pollSecret = String(req.body?.poll_secret ?? '').trim();
    if (session.error || !session.data || !mcpValueMatches(pollSecret, session.data.poll_secret_hash) || new Date(session.data.expires_at).getTime() <= Date.now()) return res.json({ status: 'expired' });
    if (session.data.status === 'pending') return res.json({ status: 'pending' });
    if (session.data.status !== 'approved' || session.data.consumed_at) return res.json({ status: 'cancelled' });
    const consumed = await supabase.from('mcp_workspace_switch_sessions').update({ consumed_at: new Date().toISOString() }).eq('id', session.data.id).eq('status', 'approved').is('consumed_at', null).select('id').maybeSingle();
    if (consumed.error || !consumed.data) return res.json({ status: 'cancelled' });
    res.json({ status: 'approved', workspace_id: session.data.approved_workspace_id });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/workspace-switches/:id/cancel', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  const session = await supabase.from('mcp_workspace_switch_sessions').select('connection_id, user_id, current_workspace_id').eq('id', req.params.id).eq('user_id', req.authUser.id).eq('status', 'pending').maybeSingle();
  await supabase.from('mcp_workspace_switch_sessions').update({ status: 'cancelled' }).eq('id', req.params.id).eq('status', 'pending');
  if (session.data) await writeMcpAuditLog({ connectionId: session.data.connection_id, userId: req.authUser.id, workspaceId: session.data.current_workspace_id, action: 'workspace_switch.denied', metadata: { reason: 'cancelled' } });
  res.json({ cancelled: true });
});

app.post('/api/mcp/authorization/sessions', rateLimit('mcp_auth'), async (req, res) => {
  try {
    const clientName = clampText(req.body?.client_name, 120);
    const requestedScopes = Array.isArray(req.body?.scopes) && req.body.scopes.length
      ? [...new Set(req.body.scopes.map((scope) => String(scope).trim()))]
      : MCP_READ_SCOPES;
    const requestedWorkspaceId = normalizeNullableText(req.body?.workspace_id);
    if (!clientName || clientName.length < 2) return res.status(400).json({ error: 'Client name is required.' });
    if (requestedScopes.some((scope) => !MCP_SCOPES.includes(scope))) return res.status(400).json({ error: 'Invalid MCP permission request.' });
    if (requestedWorkspaceId && !isUuidLike(requestedWorkspaceId)) return res.status(400).json({ error: 'Invalid workspace.' });
    const code = createMcpCode();
    const pollSecret = crypto.randomBytes(24).toString('base64url');
    const session = await supabase.from('mcp_authorization_sessions').insert({
      user_code_hash: hashMcpValue(code),
      poll_secret_hash: hashMcpValue(pollSecret),
      client_name: clientName,
      requested_scopes: requestedScopes,
      requested_workspace_id: requestedWorkspaceId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select('id, client_name, requested_scopes, requested_workspace_id, expires_at').single();
    if (session.error) throw session.error;
    await writeMcpAuditLog({ action: 'authorization.initiated', metadata: { client_name: clientName, requested_scopes: requestedScopes } });
    res.json({ session_id: session.data.id, verification_code: code, poll_secret: pollSecret, ...session.data, authorization_url: getMcpAuthorizeUrl(session.data.id, code) });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/mcp/authorization/sessions/:id', rateLimit('mcp_poll'), async (req, res) => {
  const session = await supabase.from('mcp_authorization_sessions').select('id, client_name, requested_scopes, requested_workspace_id, status, expires_at').eq('id', req.params.id).maybeSingle();
  if (session.error || !session.data) return res.status(404).json({ error: 'Authorization request not found.' });
  if (new Date(session.data.expires_at).getTime() <= Date.now() && session.data.status === 'pending') return res.json({ ...session.data, status: 'expired' });
  res.json(session.data);
});

app.get('/api/mcp/authorization/authorize', async (req, res) => {
  const sessionId = String(req.query?.session_id ?? '').trim();
  const code = String(req.query?.code ?? '').trim().toUpperCase();
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Ledger to an AI client</title><style>body{font:15px system-ui;max-width:420px;margin:48px auto;padding:0 20px;color:#111827}button{background:#ff5f40;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:600}p{color:#4b5563;line-height:1.5}</style><h1>Connect Ledger to an AI client</h1><p>Return to Ledger to review this read-only connection. Verification code: <strong>${code.replace(/[^A-Z0-9-]/g, '')}</strong></p><a href="${getMcpAuthorizeUrl(sessionId, code)}"><button>Open Ledger</button></a>`);
});

app.post('/api/mcp/authorization/approve', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const code = String(req.body?.verification_code ?? '').trim().toUpperCase();
    const workspaceId = normalizeNullableText(req.body?.workspace_id);
    if (!isUuidLike(sessionId) || !isUuidLike(workspaceId)) return res.status(400).json({ error: 'Choose a workspace to continue.' });
    const session = await supabase.from('mcp_authorization_sessions').select('id, client_name, user_code_hash, requested_scopes, requested_workspace_id, status, expires_at').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || session.data.status !== 'pending' || new Date(session.data.expires_at).getTime() <= Date.now() || !mcpValueMatches(code, session.data.user_code_hash)) return res.status(400).json({ error: 'This authorization request is invalid or expired.' });
    if (session.data.requested_workspace_id && session.data.requested_workspace_id !== workspaceId) return res.status(403).json({ error: 'The requested workspace does not match.' });
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const credential = createMcpCredential();
    const connection = await supabase.from('mcp_connections').insert({ user_id: req.authUser.id, client_name: session.data.client_name, credential_hash: hashMcpValue(credential), expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() }).select('id, expires_at').single();
    if (connection.error) throw connection.error;
    const scopes = [...new Set(session.data.requested_scopes ?? MCP_SCOPES)];
    const [scopeResult, workspaceResult, updateResult] = await Promise.all([
      supabase.from('mcp_connection_scopes').insert(scopes.map((scope) => ({ connection_id: connection.data.id, scope }))),
      supabase.from('mcp_connection_workspaces').insert({ connection_id: connection.data.id, workspace_id: workspaceId }),
      supabase.from('mcp_authorization_sessions').update({ status: 'approved', approved_by: req.authUser.id, approved_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'pending').select('id').maybeSingle(),
    ]);
    if (scopeResult.error || workspaceResult.error || updateResult.error || !updateResult.data) {
      await supabase.from('mcp_connections').delete().eq('id', connection.data.id);
      return res.status(409).json({ error: 'This authorization request was already completed.' });
    }
    mcpEphemeralCredentials.set(sessionId, { credential, connectionId: connection.data.id, expiresAt: Date.now() + 10 * 60 * 1000 });
    await writeMcpAuditLog({ connectionId: connection.data.id, userId: req.authUser.id, workspaceId, action: 'connection.approved', metadata: { scopes } });
    res.json({ approved: true });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/authorization/poll', rateLimit('mcp_poll'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const pollSecret = String(req.body?.poll_secret ?? '').trim();
    const session = await supabase.from('mcp_authorization_sessions').select('id, poll_secret_hash, status, expires_at, consumed_at').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || !mcpValueMatches(pollSecret, session.data.poll_secret_hash) || new Date(session.data.expires_at).getTime() <= Date.now()) return res.json({ status: 'expired' });
    if (session.data.status === 'pending') return res.json({ status: 'pending' });
    const pendingCredential = mcpEphemeralCredentials.get(sessionId);
    if (session.data.status !== 'approved' || session.data.consumed_at || !pendingCredential || pendingCredential.expiresAt <= Date.now()) return res.json({ status: 'cancelled' });
    const consumed = await supabase.from('mcp_authorization_sessions').update({ consumed_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'approved').is('consumed_at', null).select('id').maybeSingle();
    if (consumed.error || !consumed.data) return res.json({ status: 'cancelled' });
    mcpEphemeralCredentials.delete(sessionId);
    const scopes = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', pendingCredential.connectionId);
    res.json({ status: 'approved', credential: pendingCredential.credential, scopes: (scopes.data ?? []).map((row) => row.scope) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/authorization/cancel', rateLimit('mcp_auth'), async (req, res) => {
  await supabase.from('mcp_authorization_sessions').update({ status: 'cancelled' }).eq('id', String(req.body?.session_id ?? '')).eq('status', 'pending');
  res.json({ cancelled: true });
});

app.post('/api/mcp/connections/:id/scope-upgrades', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const connectionId = String(req.params.id ?? '').trim();
    const requestedScopes = Array.isArray(req.body?.scopes) ? [...new Set(req.body.scopes.map((scope) => String(scope).trim()))] : [];
    if (!requestedScopes.length || requestedScopes.some((scope) => !MCP_WRITE_SCOPES.includes(scope))) return res.status(400).json({ error: 'Only supported write permissions can be requested.' });
    const connection = await supabase.from('mcp_connections').select('id, user_id, client_name, status, expires_at').eq('id', connectionId).eq('user_id', req.authUser.id).maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) return res.status(404).json({ error: 'Connection not found.' });
    const [scopes, bindings] = await Promise.all([
      supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', connectionId),
      supabase.from('mcp_connection_workspaces').select('workspace_id').eq('connection_id', connectionId),
    ]);
    if (scopes.error || bindings.error) throw scopes.error || bindings.error;
    const currentScopes = (scopes.data ?? []).map((row) => row.scope);
    const newScopes = requestedScopes.filter((scope) => !currentScopes.includes(scope));
    if (!newScopes.length || (bindings.data ?? []).length !== 1) return res.status(409).json({ error: 'No additional permissions are available.' });
    const workspaceId = bindings.data[0].workspace_id;
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const code = createMcpCode();
    const pollSecret = crypto.randomBytes(24).toString('base64url');
    const session = await supabase.from('mcp_scope_upgrade_sessions').insert({ connection_id: connectionId, user_id: req.authUser.id, workspace_id: workspaceId, user_code_hash: hashMcpValue(code), poll_secret_hash: hashMcpValue(pollSecret), requested_scopes: newScopes, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id, expires_at').single();
    if (session.error) throw session.error;
    await writeMcpAuditLog({ connectionId, userId: req.authUser.id, workspaceId, action: 'scope_upgrade.initiated', metadata: { requested_scopes: newScopes } });
    res.json({ session_id: session.data.id, verification_code: code, poll_secret: pollSecret, client_name: connection.data.client_name, current_scopes: currentScopes, requested_scopes: newScopes, authorization_url: getMcpScopeUpgradeAuthorizeUrl(session.data.id, code), expires_at: session.data.expires_at });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/mcp/scope-upgrades/:id', rateLimit('mcp_poll'), async (req, res) => {
  const session = await supabase.from('mcp_scope_upgrade_sessions').select('id, connection_id, requested_scopes, status, expires_at').eq('id', req.params.id).maybeSingle();
  if (session.error || !session.data) return res.status(404).json({ error: 'Permission request not found.' });
  if (new Date(session.data.expires_at).getTime() <= Date.now() && session.data.status === 'pending') return res.json({ ...session.data, status: 'expired' });
  const connection = await supabase.from('mcp_connections').select('client_name').eq('id', session.data.connection_id).maybeSingle();
  if (connection.error) return res.status(404).json({ error: 'Permission request not found.' });
  const scopes = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', session.data.connection_id);
  if (scopes.error) return res.status(404).json({ error: 'Permission request not found.' });
  res.json({ ...session.data, client_name: connection.data?.client_name ?? 'MCP connection', current_scopes: (scopes.data ?? []).map((row) => row.scope) });
});

app.post('/api/mcp/scope-upgrades/approve', authMiddleware, rateLimit('mcp_auth'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const code = String(req.body?.verification_code ?? '').trim().toUpperCase();
    const session = await supabase.from('mcp_scope_upgrade_sessions').select('id, connection_id, user_id, workspace_id, user_code_hash, requested_scopes, status, expires_at').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || session.data.user_id !== req.authUser.id || session.data.status !== 'pending' || new Date(session.data.expires_at).getTime() <= Date.now() || !mcpValueMatches(code, session.data.user_code_hash)) return res.status(400).json({ error: 'This permission request is invalid or expired.' });
    const connection = await supabase.from('mcp_connections').select('id, status, expires_at').eq('id', session.data.connection_id).eq('user_id', req.authUser.id).maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data || connection.data.status !== 'active' || new Date(connection.data.expires_at).getTime() <= Date.now()) return res.status(401).json({ error: 'Connection expired or revoked.' });
    await requireWorkspaceAccess(req.authUser.id, session.data.workspace_id, 'member');
    const existing = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', session.data.connection_id);
    if (existing.error) throw existing.error;
    const newScopes = (session.data.requested_scopes ?? []).filter((scope) => !(existing.data ?? []).some((row) => row.scope === scope));
    const added = newScopes.length ? await supabase.from('mcp_connection_scopes').insert(newScopes.map((scope) => ({ connection_id: session.data.connection_id, scope }))) : { error: null };
    if (added.error) throw added.error;
    const updated = await supabase.from('mcp_scope_upgrade_sessions').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'pending').select('id').maybeSingle();
    if (updated.error || !updated.data) return res.status(409).json({ error: 'This permission request was already completed.' });
    await writeMcpAuditLog({ connectionId: session.data.connection_id, userId: req.authUser.id, workspaceId: session.data.workspace_id, action: 'scope_upgrade.approved', metadata: { added_scopes: newScopes } });
    res.json({ approved: true, scopes: [...(existing.data ?? []).map((row) => row.scope), ...newScopes] });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/scope-upgrades/poll', rateLimit('mcp_poll'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const pollSecret = String(req.body?.poll_secret ?? '').trim();
    const session = await supabase.from('mcp_scope_upgrade_sessions').select('id, connection_id, poll_secret_hash, status, requested_scopes, expires_at, consumed_at').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || !mcpValueMatches(pollSecret, session.data.poll_secret_hash) || new Date(session.data.expires_at).getTime() <= Date.now()) return res.json({ status: 'expired' });
    if (session.data.status === 'pending') return res.json({ status: 'pending' });
    if (session.data.status !== 'approved' || session.data.consumed_at) return res.json({ status: 'cancelled' });
    const consumed = await supabase.from('mcp_scope_upgrade_sessions').update({ consumed_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'approved').is('consumed_at', null).select('id').maybeSingle();
    if (consumed.error || !consumed.data) return res.json({ status: 'cancelled' });
    const scopes = await supabase.from('mcp_connection_scopes').select('scope').eq('connection_id', session.data.connection_id);
    res.json({ status: 'approved', scopes: (scopes.data ?? []).map((row) => row.scope) });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/mcp/scope-upgrades/cancel', rateLimit('mcp_auth'), async (req, res) => {
  const sessionId = String(req.body?.session_id ?? '');
  const session = await supabase.from('mcp_scope_upgrade_sessions').select('connection_id, user_id, workspace_id').eq('id', sessionId).eq('status', 'pending').maybeSingle();
  await supabase.from('mcp_scope_upgrade_sessions').update({ status: 'cancelled' }).eq('id', sessionId).eq('status', 'pending');
  if (session.data) await writeMcpAuditLog({ connectionId: session.data.connection_id, userId: session.data.user_id, workspaceId: session.data.workspace_id, action: 'scope_upgrade.denied', metadata: { reason: 'cancelled' } });
  res.json({ cancelled: true });
});

app.delete('/api/mcp/connections/:id/scopes/:scope', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const scope = String(req.params.scope ?? '').trim();
    if (!MCP_WRITE_SCOPES.includes(scope)) return res.status(400).json({ error: 'Only optional write permissions can be removed.' });
    const connection = await supabase.from('mcp_connections').select('id').eq('id', req.params.id).eq('user_id', req.authUser.id).maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data) return res.status(404).json({ error: 'Connection not found.' });
    const removed = await supabase.from('mcp_connection_scopes').delete().eq('connection_id', connection.data.id).eq('scope', scope).select('scope').maybeSingle();
    if (removed.error) throw removed.error;
    await writeMcpAuditLog({ connectionId: connection.data.id, userId: req.authUser.id, action: 'scope.removed', metadata: { scope } });
    res.json({ removed: Boolean(removed.data), scope });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/mcp', mcpAuthMiddleware, rateLimit('mcp_request'), async (req, res) => {
  const context = req.mcpContext;
  req.authUser = { id: context.userId };
  try {
    const server = createMcpServer({ context, supabase, requireWorkspaceAccess, requestScopeUpgrade: createMcpScopeUpgradeSession, requestWorkspaceSwitch: createMcpWorkspaceSwitchSession, audit: (action, metadata) => writeMcpAuditLog({ connectionId: context.connection.id, userId: context.userId, workspaceId: context.workspaceId, action, toolName: metadata?.toolName ?? null, metadata }) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => { void transport.close(); void server.close(); });
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/mcp', mcpAuthMiddleware, rateLimit('mcp_request'), (_req, res) => res.status(405).json({ error: 'Method not allowed.' }));
app.delete('/mcp', mcpAuthMiddleware, rateLimit('mcp_request'), (_req, res) => res.status(405).json({ error: 'Method not allowed.' }));

app.get('/api/mcp/connections', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const connections = await supabase.from('mcp_connections').select('id, client_name, status, expires_at, last_used_at, revoked_at, created_at, updated_at').eq('user_id', req.authUser.id).order('created_at', { ascending: false });
    if (connections.error) throw connections.error;
    const ids = (connections.data ?? []).map((row) => row.id);
    const [scopes, workspaces] = await Promise.all([
      ids.length ? supabase.from('mcp_connection_scopes').select('connection_id, scope').in('connection_id', ids) : { data: [], error: null },
      ids.length ? supabase.from('mcp_connection_workspaces').select('connection_id, workspace_id').in('connection_id', ids) : { data: [], error: null },
    ]);
    if (scopes.error || workspaces.error) throw scopes.error || workspaces.error;
    const workspaceIds = [...new Set((workspaces.data ?? []).map((row) => row.workspace_id))];
    const workspaceRows = workspaceIds.length ? await supabase.from('workspaces').select('id, name').in('id', workspaceIds) : { data: [], error: null };
    if (workspaceRows.error) throw workspaceRows.error;
    const workspaceById = new Map((workspaceRows.data ?? []).map((row) => [row.id, row]));
    res.json((connections.data ?? []).map((connection) => ({ ...connection, scopes: (scopes.data ?? []).filter((row) => row.connection_id === connection.id).map((row) => row.scope), workspaces: (workspaces.data ?? []).filter((row) => row.connection_id === connection.id).map((row) => workspaceById.get(row.workspace_id)).filter(Boolean) })));
  } catch (error) { return respondWithError(res, error); }
});

app.patch('/api/mcp/connections/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  const name = clampText(req.body?.client_name, 120);
  if (!name) return res.status(400).json({ error: 'Client name is required.' });
  const result = await supabase.from('mcp_connections').update({ client_name: name, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.authUser.id).select('id, client_name').maybeSingle();
  if (result.error) return respondWithError(res, result.error);
  if (!result.data) return res.status(404).json({ error: 'Connection not found.' });
  res.json(result.data);
});

app.post('/api/mcp/connections/:id/revoke', authMiddleware, rateLimit('write'), async (req, res) => {
  const result = await supabase.from('mcp_connections').update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.authUser.id).is('revoked_at', null).select('id').maybeSingle();
  if (result.error) return respondWithError(res, result.error);
  if (!result.data) return res.status(404).json({ error: 'Connection not found.' });
  await writeMcpAuditLog({ connectionId: result.data.id, userId: req.authUser.id, action: 'credential.revoked' });
  res.json({ revoked: true });
});

app.post('/api/figma-plugin/auth/approve', authMiddleware, rateLimit('auth'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const code = String(req.body?.verification_code ?? '').trim().toUpperCase();
    const session = await supabase.from('figma_plugin_authorization_sessions').select('id, client_id, verification_code_hash, status, expires_at, scopes').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || session.data.client_id !== FIGMA_PLUGIN_CLIENT_ID || session.data.status !== 'pending' || new Date(session.data.expires_at).getTime() <= Date.now() || !pluginValueMatches(code, session.data.verification_code_hash)) return res.status(400).json({ error: 'This authorization request is invalid or expired.' });
    const credential = `ledger_figma_plugin_${crypto.randomBytes(32).toString('base64url')}`;
    const credentialRow = await supabase.from('figma_plugin_credentials').insert({ token_hash: hashPluginValue(credential), user_id: req.authUser.id, client_id: FIGMA_PLUGIN_CLIENT_ID, scopes: session.data.scopes?.length ? session.data.scopes : FIGMA_PLUGIN_SCOPES, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }).select('id').single();
    if (credentialRow.error) throw credentialRow.error;
    const updated = await supabase.from('figma_plugin_authorization_sessions').update({ status: 'approved', user_id: req.authUser.id, credential_encrypted: protectIntegrationTokenForStorage(credential), approved_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'pending').select('id').maybeSingle();
    if (updated.error || !updated.data) { await supabase.from('figma_plugin_credentials').delete().eq('id', credentialRow.data.id); return res.status(409).json({ error: 'This authorization request was already completed.' }); }
    res.json({ approved: true });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/figma-plugin/auth/poll', rateLimit('auth'), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? '').trim();
    const pollSecret = String(req.body?.poll_secret ?? '').trim();
    const session = await supabase.from('figma_plugin_authorization_sessions').select('id, poll_secret_hash, status, expires_at, credential_encrypted, credential_returned_at, scopes').eq('id', sessionId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data || !pluginValueMatches(pollSecret, session.data.poll_secret_hash) || new Date(session.data.expires_at).getTime() <= Date.now()) return res.status(400).json({ status: 'expired' });
    if (session.data.status === 'pending') return res.json({ status: 'pending' });
    if (session.data.status !== 'approved' || session.data.credential_returned_at) return res.json({ status: 'cancelled' });
    const token = readIntegrationToken(session.data.credential_encrypted);
    if (!token) return res.status(500).json({ error: 'Could not complete Ledger authorization.' });
    const updated = await supabase.from('figma_plugin_authorization_sessions').update({ credential_returned_at: new Date().toISOString() }).eq('id', sessionId).is('credential_returned_at', null).select('id').maybeSingle();
    if (updated.error || !updated.data) return res.json({ status: 'cancelled' });
    res.json({ status: 'approved', credential: token, scopes: session.data.scopes });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/figma-plugin/auth/cancel', rateLimit('auth'), async (req, res) => {
  const sessionId = String(req.body?.session_id ?? '').trim();
  await supabase.from('figma_plugin_authorization_sessions').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', sessionId).eq('status', 'pending');
  res.json({ cancelled: true });
});

app.get('/api/figma-plugin/session', pluginAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    requirePluginScope(req, 'workspace:read');
    const user = await supabase.from('users').select('id, email, full_name, avatar_url').eq('id', req.pluginCredential.user_id).maybeSingle();
    if (user.error) throw user.error;
    res.json({ user: user.data, scopes: req.pluginCredential.scopes, expires_at: req.pluginCredential.expires_at });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/figma-plugin/workspaces', pluginAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    requirePluginScope(req, 'workspace:read');
    const workspaceIds = [...(await getUserWorkspaceIds(req.pluginCredential.user_id))];
    if (!workspaceIds.length) return res.json([]);
    const rows = await supabase.from('workspaces').select('id, name, description, is_personal, color, owner_id').in('id', workspaceIds);
    if (rows.error) throw rows.error;
    const members = await supabase.from('workspace_members').select('workspace_id, role').eq('user_id', req.pluginCredential.user_id).in('workspace_id', workspaceIds);
    if (members.error) throw members.error;
    const roleById = new Map((members.data ?? []).map((row) => [row.workspace_id, row.role]));
    const figma = await supabase.from('integration_accounts').select('workspace_id, connection_status').eq('provider', 'figma').in('workspace_id', workspaceIds);
    if (figma.error) throw figma.error;
    const figmaById = new Map((figma.data ?? []).map((row) => [row.workspace_id, row.connection_status]));
    res.json((rows.data ?? []).map((row) => ({ ...row, role: row.owner_id === req.pluginCredential.user_id ? 'owner' : roleById.get(row.id) ?? 'member', figma_status: figmaById.get(row.id) ?? 'disconnected' })));
  } catch (error) { return respondWithError(res, error); }
});

const pluginSupportedNodeTypes = new Set(['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'PAGE']);
const pluginTargetTypes = new Set(['task', 'project', 'note', 'meetingNote', 'intake']);
const pluginError = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; return error; };
const requirePluginWorkspace = async (req, minimumRole = 'member') => {
  const workspaceId = getRequestedWorkspaceId(req);
  if (!workspaceId) throw pluginError('Choose a Ledger workspace.', 400);
  await requireWorkspaceAccess(req.pluginCredential.user_id, workspaceId, minimumRole);
  return workspaceId;
};
const validatePluginSelection = (selection) => {
  const nodeId = String(selection?.node_id ?? '').trim();
  const nodeType = String(selection?.node_type ?? '').trim().toUpperCase();
  if (!nodeId || !/^\d+[:-]\d+$/.test(nodeId) || !pluginSupportedNodeTypes.has(nodeType)) throw pluginError('Select one supported Figma layer.');
  if (!String(selection?.page_name ?? '').trim()) throw pluginError('Figma page context is required.');
  return { nodeId: nodeId.replace('-', ':'), nodeType };
};
const resolvePluginFigmaUrl = ({ url, nodeId }) => {
  const parsed = parseExternalUrl({ provider: 'figma', url });
  if (parsed.nodeId && parsed.nodeId !== nodeId) throw pluginError('This link points to a different Figma selection.');
  if (parsed.nodeId) return parsed.normalizedUrl;
  const canonical = new URL(parsed.normalizedUrl);
  canonical.searchParams.set('node-id', nodeId);
  return canonical.toString();
};
const getPluginUrl = (targetType, targetId) => {
  const base = (process.env.PUBLIC_FRONTEND_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'https://ledgerworkspace.com').replace(/\/$/, '');
  const routes = { task: 'tasks', project: 'projects', note: 'notes', meetingNote: 'notes', intake: 'inbox' };
  return `${base}/${routes[targetType]}/${encodeURIComponent(targetId)}`;
};
const getPluginDesktopUrl = (targetType, targetId) => {
  const routes = { task: 'task', project: 'project', note: 'note', meetingNote: 'note', intake: 'inbox' };
  const route = routes[targetType];
  return route ? `ledger://${route}/${encodeURIComponent(targetId)}` : undefined;
};
const mapPluginTarget = (row) => ({ id: row.id, type: row.type, title: row.title, subtitle: row.subtitle ?? undefined, status: row.status ?? undefined, url: getPluginUrl(row.type, row.id), open_url: getPluginDesktopUrl(row.type, row.id) });
const searchPluginWorkContent = async ({ workspaceId, rawQuery = '' }) => {
  const query = String(rawQuery ?? '').trim();
  const like = `%${query}%`;
  const applySearch = (builder, columns) => query
    ? builder.or(columns.map((column) => `${column}.ilike.${like}`).join(','))
    : builder;

  const [tasksResult, projectsResult, notesResult, intakeResult] = await Promise.all([
    applySearch(
      supabase.from('tasks').select('id, title, status, due_date, updated_at, created_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(20),
      ['title']
    ),
    applySearch(
      supabase.from('projects').select('id, name, status, updated_at, created_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(20),
      ['name']
    ),
    applySearch(
      supabase.from('notes').select('id, title, mode, updated_at, created_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(20),
      ['title']
    ),
    applySearch(
      supabase.from('inbox_items').select('id, title, status, updated_at, created_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(20),
      ['title']
    ),
  ]);

  for (const result of [tasksResult, projectsResult, notesResult, intakeResult]) {
    if (result.error) throw result.error;
  }

  const rows = [
    ...(tasksResult.data ?? []).map((row) => ({
      id: row.id,
      type: 'task',
      title: row.title || 'Untitled task',
      status: row.status,
      subtitle: [titleCaseLabel(row.status || 'task'), row.due_date ? new Date(`${row.due_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null].filter(Boolean).join(' · '),
      updatedAt: row.updated_at || row.created_at,
    })),
    ...(projectsResult.data ?? []).map((row) => ({
      id: row.id,
      type: 'project',
      title: row.name || 'Untitled project',
      status: row.status,
      subtitle: `Project · ${titleCaseLabel(row.status || 'active')}`,
      updatedAt: row.updated_at || row.created_at,
    })),
    ...(notesResult.data ?? []).map((row) => ({
      id: row.id,
      type: row.mode === 'meeting_note' ? 'meetingNote' : 'note',
      title: row.title || 'Untitled note',
      subtitle: row.mode === 'meeting_note' ? 'Meeting note' : 'Note',
      updatedAt: row.updated_at || row.created_at,
    })),
    ...(intakeResult.data ?? []).map((row) => ({
      id: row.id,
      type: 'intake',
      title: row.title || 'Untitled intake item',
      status: row.status,
      subtitle: `Intake · ${titleCaseLabel(row.status || 'new')}`,
      updatedAt: row.updated_at || row.created_at,
    })),
  ];

  return rows
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    .slice(0, query ? 20 : 12)
    .map(mapPluginTarget);
};
const preparePluginReference = async ({ req, workspaceId, body }) => {
  requirePluginScope(req, 'external-reference:create');
  const selection = validatePluginSelection(body?.selection);
  const canonicalUrl = resolvePluginFigmaUrl({ url: String(body?.figma_url ?? '').trim(), nodeId: selection.nodeId });
  const created = await createOrGetExternalReference({ supabase, workspaceId, provider: 'figma', url: canonicalUrl, createdByUserId: req.pluginCredential.user_id });
  // Keep the plugin context as a display fallback until the connected Figma
  // account resolves authoritative metadata. This also keeps a valid link
  // useful when Figma metadata access is temporarily unavailable.
  const pluginMetadata = {
    ...(String(body?.selection?.node_name ?? '').trim() ? { nodeName: String(body.selection.node_name).trim().slice(0, 200) } : {}),
    ...(String(body?.selection?.node_type ?? '').trim() ? { nodeType: String(body.selection.node_type).trim().slice(0, 64) } : {}),
    ...(String(body?.selection?.page_name ?? '').trim() ? { pageName: String(body.selection.page_name).trim().slice(0, 200) } : {}),
    ...(String(body?.selection?.file_name ?? '').trim() ? { fileName: String(body.selection.file_name).trim().slice(0, 200) } : {}),
  };
  if (Object.keys(pluginMetadata).length) {
    const metadata = { ...(created.reference.metadata ?? {}), ...pluginMetadata };
    const updated = await supabase.from('external_references').update({ metadata }).eq('workspace_id', workspaceId).eq('id', created.reference.id).select('id, workspace_id, provider, external_type, external_url, normalized_url, metadata, access_status, created_at, updated_at').single();
    if (!updated.error) created.reference = updated.data;
  }
  try {
    await resolveExternalReference({ supabase, workspaceId, referenceId: created.reference.id, requestedByUserId: req.pluginCredential.user_id, getConnection: getFigmaConnectionForReference });
  } catch { /* Metadata is best effort; the canonical reference is already safe. */ }
  return { ...created, canonicalUrl, selection };
};
const finishPluginReference = async ({ req, workspaceId, referenceId, targetType, targetId }) => {
  requirePluginScope(req, 'external-reference:link');
  if (!pluginTargetTypes.has(targetType)) throw pluginError('Unsupported Ledger target.');
  await requireFigmaCapability({ userId: req.pluginCredential.user_id, workspaceId, capability: 'link_reference', targetType, targetId });
  const prior = await supabase.from('external_reference_links').select('id').eq('workspace_id', workspaceId).eq('external_reference_id', referenceId).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
  if (prior.error) throw prior.error;
  const link = await linkExternalReference({ supabase, workspaceId, referenceId, targetType, targetId, source: 'integration', createdByUserId: req.pluginCredential.user_id, ensureTarget: ensureExternalTarget });
  let preview = null;
  try {
    preview = await generateExternalReferencePreview({ supabase, workspaceId, referenceId, createdByUserId: req.pluginCredential.user_id, getConnection: getFigmaConnectionForReference });
  } catch (error) { console.error('Plugin Figma preview capture failed', { workspaceId, referenceId, error: error instanceof Error ? error.message : 'unknown_error' }); preview = { accessStatus: 'error', error: 'Ledger couldn’t load this Figma preview.' }; }
  return { link, preview, alreadyLinked: Boolean(prior.data) };
};
const pluginTargetSummary = async (workspaceId, targetType, targetId) => {
  const table = externalTargetTables[targetType];
  if (!table) return null;
  const column = table === 'projects' ? 'name' : 'title';
  const statusColumnTypes = new Set(['task', 'project', 'intake']);
  const result = await supabase.from(table).select(`id, ${column}${statusColumnTypes.has(targetType) ? ', status' : ''}`).eq('workspace_id', workspaceId).eq('id', targetId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return mapPluginTarget({ id: result.data.id, type: targetType, title: result.data[column] || 'Untitled', status: result.data.status, subtitle: targetType === 'intake' ? 'Intake item' : targetType === 'meetingNote' ? 'Meeting note' : titleCaseLabel(targetType) });
};
const pluginLinkedTypeOrder = { task: 0, project: 1, intake: 2, meetingNote: 3, note: 4 };
const getPluginLinkedTargetSummary = async (workspaceId, targetType, targetId) => {
  const table = externalTargetTables[targetType];
  if (!table) return null;
  const columns = targetType === 'task'
    ? 'id, title, status, priority, assigned_to, assigned_to_user_id, project_id, due_date, updated_at'
    : targetType === 'project'
    ? 'id, name, status, lead_id, end_date, updated_at'
    : targetType === 'intake'
    ? 'id, title, status, updated_at'
    : 'id, title, updated_at';
  const result = await supabase.from(table).select(columns).eq('workspace_id', workspaceId).eq('id', targetId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const row = result.data;
  const title = targetType === 'project' ? row.name : row.title;
  const assigneeId = row.assigned_to_user_id || row.assigned_to || row.lead_id || null;
  let assignee = null;
  if (assigneeId) {
    const member = await supabase.from('users').select('id, full_name, email, avatar_url').eq('id', assigneeId).maybeSingle();
    if (member.error) throw member.error;
    if (member.data) assignee = { id: member.data.id, name: member.data.full_name || member.data.email || 'Assigned user', ...(member.data.avatar_url ? { avatarUrl: member.data.avatar_url } : {}) };
  }
  let projectName;
  if (targetType === 'task' && row.project_id) {
    const project = await supabase.from('projects').select('id, name').eq('workspace_id', workspaceId).eq('id', row.project_id).maybeSingle();
    if (project.error) throw project.error;
    projectName = project.data?.name || undefined;
  }
  return {
    id: row.id,
    type: targetType,
    title: String(title || 'Untitled'),
    ...(row.status ? { status: String(row.status) } : {}),
    ...(assignee ? { assignee } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(projectName ? { projectName } : {}),
    ...((row.due_date || row.end_date) ? { dueDate: row.due_date || row.end_date } : {}),
    ...(row.priority ? { priority: String(row.priority) } : {}),
    ledgerUrl: getPluginUrl(targetType, row.id),
    openUrl: getPluginDesktopUrl(targetType, row.id),
    updatedAt: row.updated_at || null,
  };
};
const pluginPropertyScopes = {
  status: 'work:update:status',
  assignee: 'work:update:assignee',
  priority: 'work:update:priority',
  project: 'work:update:project',
  dueDate: 'work:update:due-date',
};
const taskStatuses = [
  { id: 'todo', name: 'Todo', category: 'open' },
  { id: 'in_progress', name: 'In progress', category: 'open' },
  { id: 'completed', name: 'Completed', category: 'closed' },
  { id: 'cancelled', name: 'Cancelled', category: 'closed' },
];
const taskPriorities = [
  { id: 'urgent', name: 'Urgent' },
  { id: 'high', name: 'High' },
  { id: 'medium', name: 'Medium' },
  { id: 'low', name: 'Low' },
];
const getPluginEditCapabilities = async ({ req, workspaceId, targetType, targetId }) => {
  if (!pluginTargetTypes.has(targetType) || !(await ensureExternalTarget({ workspaceId, targetType, targetId }))) return { canEdit: false, editableProperties: [] };
  let member = false;
  try { await requireWorkspaceAccess(req.pluginCredential.user_id, workspaceId, 'member'); member = true; } catch { return { canEdit: false, editableProperties: [] }; }
  if (!member || !['task', 'project'].includes(targetType)) return { canEdit: false, editableProperties: [] };
  const properties = targetType === 'task' ? ['status', 'assignee', 'priority', 'project', 'dueDate'] : ['status', 'assignee', 'dueDate'];
  return { canEdit: true, editableProperties: properties };
};
const getPluginEditOptions = async ({ req, workspaceId, targetType, targetId }) => {
  const capabilities = await getPluginEditCapabilities({ req, workspaceId, targetType, targetId });
  if (!capabilities.canEdit && !['task', 'project'].includes(targetType)) return { capabilities };
  const options = { capabilities, dueDateRules: { supported: capabilities.editableProperties.includes('dueDate'), allowClear: true } };
  if (targetType === 'task') {
    options.statuses = taskStatuses;
    options.priorities = taskPriorities;
  } else {
    options.statuses = Object.entries(projectStatusAliases).map(([, values]) => ({ id: values[0], name: String(values[0]).replace(/([a-z])([A-Z])/g, '$1 $2') }));
  }
  if (capabilities.editableProperties.includes('assignee')) {
    const workspace = await supabase.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
    if (workspace.error) throw workspace.error;
    const memberRows = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
    if (memberRows.error) throw memberRows.error;
    const ids = [...new Set([workspace.data?.owner_id, ...(memberRows.data ?? []).map((row) => row.user_id)].filter(Boolean))];
    const users = ids.length ? await supabase.from('users').select('id, full_name, email, avatar_url').in('id', ids).order('full_name', { ascending: true }) : { data: [], error: null };
    if (users.error) throw users.error;
    options.assignees = (users.data ?? []).map((user) => ({ id: user.id, name: user.full_name || user.email || 'Workspace member', ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}) }));
  }
  if (capabilities.editableProperties.includes('project')) {
    const projects = await supabase.from('projects').select('id, name, status').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(50);
    if (projects.error) throw projects.error;
    options.projects = (projects.data ?? []).filter((project) => !isCompletedProjectStatus(project.status)).map((project) => ({ id: project.id, name: project.name }));
  }
  return options;
};
const getPluginTaskCreateOptions = async ({ req, workspaceId }) => {
  const options = {
    assignees: [],
    projects: [],
  };
  const workspace = await supabase.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
  if (workspace.error) throw workspace.error;
  const memberRows = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  if (memberRows.error) throw memberRows.error;
  const ids = [...new Set([workspace.data?.owner_id, ...(memberRows.data ?? []).map((row) => row.user_id)].filter(Boolean))];
  const users = ids.length ? await supabase.from('users').select('id, full_name, email, avatar_url').in('id', ids).order('full_name', { ascending: true }) : { data: [], error: null };
  if (users.error) throw users.error;
  options.assignees = (users.data ?? []).map((user) => ({ id: user.id, name: user.full_name || user.email || 'Workspace member', ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}) }));
  const projects = await supabase.from('projects').select('id, name, status').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(50);
  if (projects.error) throw projects.error;
  options.projects = (projects.data ?? []).filter((project) => !isCompletedProjectStatus(project.status)).map((project) => ({ id: project.id, name: project.name }));
  return options;
};
const updatePluginWorkProperty = async ({ req, workspaceId, targetType, targetId, property, value, expectedUpdatedAt }) => {
  const scope = pluginPropertyScopes[property];
  if (!scope || !['status', 'assignee', 'priority', 'project', 'dueDate'].includes(property)) throw pluginError('Unsupported property.');
  requirePluginScope(req, scope);
  const capabilities = await getPluginEditCapabilities({ req, workspaceId, targetType, targetId });
  if (!capabilities.editableProperties.includes(property)) throw pluginError('You don’t have permission to update this property.', 403);
  const table = targetType === 'task' ? 'tasks' : targetType === 'project' ? 'projects' : null;
  if (!table) throw pluginError('This Ledger item is read-only.', 400);
  const currentColumns = table === 'tasks'
    ? 'id, status, updated_at'
    : 'id, status, updated_at';
  const current = await supabase.from(table).select(currentColumns).eq('workspace_id', workspaceId).eq('id', targetId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw pluginError('Ledger item not found.', 404);
  if (expectedUpdatedAt && String(current.data.updated_at ?? '') !== String(expectedUpdatedAt)) throw pluginError('This item changed in Ledger.', 409);
  const update = {};
  if (targetType === 'task') {
    if (property === 'status') {
      const next = String(value ?? '').trim();
      if (!taskStatuses.some((status) => status.id === next)) throw pluginError('This item can’t move to that status.');
      update.status = next;
      if (next === 'completed' && current.data.status !== 'completed') update.completed_at = new Date().toISOString();
      if (next !== 'completed' && current.data.status === 'completed') update.completed_at = null;
    } else if (property === 'priority') {
      const next = normalizeNullableText(value) || 'medium';
      if (!taskPriorities.some((priority) => priority.id === next)) throw pluginError('That priority is not available.');
      update.priority = next;
    } else if (property === 'assignee') {
      const next = normalizeNullableText(value);
      if (next && !(await ensureWorkspaceMemberTarget(workspaceId, next))) throw pluginError('That person can no longer be assigned to this item.', 404);
      Object.assign(update, buildAssignmentPersistenceFields({ assigned_to_user_id: next, assigned_to_team_id: null }, req.pluginCredential.user_id, new Date().toISOString()));
    } else if (property === 'project') {
      const next = normalizeNullableText(value);
      if (next && !(await ensureWorkspaceResource('projects', next, workspaceId))) throw pluginError('That project is no longer available.', 404);
      update.project_id = next;
    } else if (property === 'dueDate') update.due_date = normalizeNullableDate(value, 'due date');
  } else if (targetType === 'project') {
    if (property === 'status') {
      const semantic = normalizeProjectSemanticStatus(value);
      update.status = projectStatusAliases[semantic][0];
    } else if (property === 'assignee') {
      const next = normalizeNullableText(value);
      if (next && !(await ensureWorkspaceMemberTarget(workspaceId, next))) throw pluginError('That person can no longer lead this project.', 404);
      update.lead_id = next;
    } else if (property === 'dueDate') update.end_date = normalizeNullableDate(value, 'target date');
  }
  update.updated_at = new Date().toISOString();
  const updated = await supabase.from(table).update(update).eq('workspace_id', workspaceId).eq('id', targetId);
  if (updated.error) throw updated.error;
  return getPluginLinkedTargetSummary(workspaceId, targetType, targetId);
};
const resolvePluginReferenceForRequest = async ({ req, workspaceId, body }) => {
  requirePluginScope(req, 'figma-context:read');
  const selection = validatePluginSelection(body?.selection);
  const canonicalUrl = resolvePluginFigmaUrl({ url: String(body?.figma_url ?? '').trim(), nodeId: selection.nodeId });
  const parsed = parseExternalUrl({ provider: 'figma', url: canonicalUrl });
  const identity = ['figma', parsed.fileKey, parsed.nodeId || 'file', parsed.branchKey || ''].join(':');
  const result = await supabase.from('external_references').select('id, external_identity').eq('workspace_id', workspaceId).eq('provider', 'figma').eq('external_identity', identity).maybeSingle();
  if (result.error) throw result.error;
  return { canonicalUrl, reference: result.data || null };
};
const listPluginLinkedWork = async ({ req, workspaceId, body }) => {
  const resolved = await resolvePluginReferenceForRequest({ req, workspaceId, body });
  if (!resolved.reference) return { canonical_url: resolved.canonicalUrl, external_reference_id: null, linked_work: [], change_state: { change_state: 'unknown' } };
  const links = await supabase.from('external_reference_links').select('id, target_type, target_id, sources, created_at').eq('workspace_id', workspaceId).eq('external_reference_id', resolved.reference.id);
  if (links.error) throw links.error;
  const summaries = [];
  for (const link of links.data ?? []) {
    if (!pluginTargetTypes.has(link.target_type)) continue;
    try { await requireFigmaCapability({ userId: req.pluginCredential.user_id, workspaceId, capability: 'view_reference', targetType: link.target_type, targetId: link.target_id }); } catch { continue; }
    const target = await getPluginLinkedTargetSummary(workspaceId, link.target_type, link.target_id);
    if (!target) continue;
    const editCapabilities = await getPluginEditCapabilities({ req, workspaceId, targetType: link.target_type, targetId: link.target_id });
    let canUnlink = false;
    if (req.pluginCredential.scopes?.includes('external-reference:unlink')) {
      try { await requireFigmaCapability({ userId: req.pluginCredential.user_id, workspaceId, capability: 'unlink_reference', targetType: link.target_type, targetId: link.target_id }); canUnlink = true; } catch { /* visible but not editable */ }
    }
    summaries.push({ ...target, relationshipId: link.id, relationshipSources: link.sources ?? ['manual'], canUnlink, editCapabilities });
  }
  summaries.sort((left, right) => (pluginLinkedTypeOrder[left.type] ?? 99) - (pluginLinkedTypeOrder[right.type] ?? 99) || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
  const changeState = await getExternalReferenceChangeState({ supabase, workspaceId, referenceId: resolved.reference.id });
  return { canonical_url: resolved.canonicalUrl, external_reference_id: resolved.reference.id, linked_work: summaries, change_state: changeState };
};
const pluginCreateIdempotency = async ({ req, workspaceId, key, action }) => {
  const safeKey = String(key ?? '').trim();
  if (!safeKey || safeKey.length > 160) throw pluginError('A valid idempotency key is required.');
  const reservation = await supabase.from('figma_plugin_action_keys').insert({ workspace_id: workspaceId, user_id: req.pluginCredential.user_id, action, idempotency_key: safeKey, result: null }).select('id, result').maybeSingle();
  if (!reservation.error && reservation.data) return { key: safeKey, reservationId: reservation.data.id, existing: null };
  if (reservation.error?.code !== '23505') throw reservation.error;
  const existing = await supabase.from('figma_plugin_action_keys').select('id, result').eq('workspace_id', workspaceId).eq('user_id', req.pluginCredential.user_id).eq('action', action).eq('idempotency_key', safeKey).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.result) return { key: safeKey, existing: existing.data.result };
  throw pluginError('This Ledger action is already in progress.', 409);
};

app.post('/api/figma-plugin/identity', pluginAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    requirePluginScope(req, 'figma-context:read');
    await requirePluginWorkspace(req, 'viewer');
    const selection = validatePluginSelection(req.body?.selection);
    res.json({ canonical_url: resolvePluginFigmaUrl({ url: String(req.body?.figma_url ?? '').trim(), nodeId: selection.nodeId }), node_id: selection.nodeId });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/figma-plugin/search', pluginAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    requirePluginScope(req, 'work:search');
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    const query = String(req.query?.q ?? '').trim();
    res.json(await searchPluginWorkContent({ workspaceId, rawQuery: query }));
  } catch (error) { return respondWithError(res, error); }
});
app.get('/api/figma-plugin/recent-work', pluginAuthMiddleware, rateLimit('read'), async (req, res) => {
  try {
    requirePluginScope(req, 'work:search');
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    res.json(await searchPluginWorkContent({ workspaceId, rawQuery: '' }));
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/figma-plugin/linked-work', pluginAuthMiddleware, rateLimit('figma_linked'), async (req, res) => {
  try {
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    const result = await listPluginLinkedWork({ req, workspaceId, body: req.body });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: 'figma_linked_work_viewed', targetType: 'external_reference', targetId: result.external_reference_id, metadata: { source: 'figma-plugin', count: result.linked_work.length } });
    res.json(result);
  } catch (error) { return respondWithError(res, error); }
});
app.get('/api/figma-plugin/linked-work', pluginAuthMiddleware, rateLimit('figma_linked'), async (req, res) => {
  try {
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    const body = { figma_url: req.query?.figma_url, selection: { node_id: req.query?.node_id, node_type: req.query?.node_type, page_name: req.query?.page_name || 'Figma page' } };
    res.json(await listPluginLinkedWork({ req, workspaceId, body }));
  } catch (error) { return respondWithError(res, error); }
});
app.post('/api/figma-plugin/change-state', pluginAuthMiddleware, rateLimit('figma_change_check'), async (req, res) => {
  try {
    requirePluginScope(req, 'external-reference:check-version');
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    const resolved = await resolvePluginReferenceForRequest({ req, workspaceId, body: req.body });
    if (!resolved.reference) return res.json({ change_state: 'unknown', external_reference_id: null, canonical_url: resolved.canonicalUrl });
    const changeState = await checkExternalReferenceChange({ supabase, workspaceId, referenceId: resolved.reference.id, requestedByUserId: req.pluginCredential.user_id, getConnection: getFigmaConnectionForReference });
    res.json({ ...changeState, canonical_url: resolved.canonicalUrl, external_reference_id: resolved.reference.id });
  } catch (error) { return respondWithError(res, error); }
});
app.post('/api/figma-plugin/preview/refresh', pluginAuthMiddleware, rateLimit('figma_preview'), async (req, res) => {
  try {
    requirePluginScope(req, 'external-reference:refresh-preview');
    const workspaceId = await requirePluginWorkspace(req, 'member');
    const resolved = await resolvePluginReferenceForRequest({ req, workspaceId, body: req.body });
    if (!resolved.reference) throw pluginError('This design is not linked in Ledger.', 404);
    const targetType = String(req.body?.target_type ?? '').trim();
    const targetId = String(req.body?.target_id ?? '').trim();
    if (targetType && targetId) await requireFigmaCapability({ userId: req.pluginCredential.user_id, workspaceId, capability: 'refresh_preview', targetType, targetId });
    const changeState = await checkExternalReferenceChange({ supabase, workspaceId, referenceId: resolved.reference.id, requestedByUserId: req.pluginCredential.user_id, getConnection: getFigmaConnectionForReference });
    const refreshed = await generateExternalReferencePreview({ supabase, workspaceId, referenceId: resolved.reference.id, createdByUserId: req.pluginCredential.user_id, force: true, getConnection: getFigmaConnectionForReference });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: 'figma_preview_refreshed_from_plugin', targetType: 'external_reference', targetId: resolved.reference.id, metadata: { source: 'figma-plugin', change_state: changeState.change_state } });
    res.json({ ...refreshed, change_state: refreshed.error ? (changeState.change_state || 'updated') : (refreshed.changeState || 'current'), canonical_url: resolved.canonicalUrl });
  } catch (error) { return respondWithError(res, error); }
});
app.get('/api/figma-plugin/work/:type/:id/edit-options', pluginAuthMiddleware, rateLimit('figma_linked'), async (req, res) => {
  try {
    requirePluginScope(req, 'workspace:read');
    const workspaceId = await requirePluginWorkspace(req, 'viewer');
    const targetType = String(req.params.type ?? '').trim();
    const targetId = String(req.params.id ?? '').trim();
    res.json(await getPluginEditOptions({ req, workspaceId, targetType, targetId }));
  } catch (error) { return respondWithError(res, error); }
});
app.get('/api/figma-plugin/task-options', pluginAuthMiddleware, rateLimit('figma_linked'), async (req, res) => {
  try {
    requirePluginScope(req, 'workspace:read');
    const workspaceId = await requirePluginWorkspace(req, 'member');
    res.json(await getPluginTaskCreateOptions({ req, workspaceId }));
  } catch (error) { return respondWithError(res, error); }
});
app.patch('/api/figma-plugin/work/:type/:id', pluginAuthMiddleware, rateLimit('figma_update'), async (req, res) => {
  try {
    const workspaceId = await requirePluginWorkspace(req, 'member');
    const targetType = String(req.params.type ?? '').trim();
    const targetId = String(req.params.id ?? '').trim();
    const property = String(req.body?.property ?? '').trim();
    const value = req.body?.value ?? null;
    const selectionReference = await resolvePluginReferenceForRequest({ req, workspaceId, body: req.body });
    if (!selectionReference.reference) throw pluginError('This design is no longer linked to that item.', 404);
    const relationship = await supabase.from('external_reference_links').select('id').eq('workspace_id', workspaceId).eq('external_reference_id', selectionReference.reference.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    if (relationship.error) throw relationship.error;
    if (!relationship.data) throw pluginError('This design is no longer linked to that item.', 404);
    const idempotency = await pluginCreateIdempotency({ req, workspaceId, key: req.headers['idempotency-key'] || req.body?.idempotency_key, action: `property:${targetType}:${targetId}:${property}` });
    if (idempotency.existing) return res.json(idempotency.existing);
    const target = await updatePluginWorkProperty({ req, workspaceId, targetType, targetId, property, value, expectedUpdatedAt: req.body?.expected_updated_at });
    const result = { target, property, updated_at: target.updatedAt ?? null };
    const saved = await supabase.from('figma_plugin_action_keys').update({ result }).eq('id', idempotency.reservationId).eq('workspace_id', workspaceId);
    if (saved.error) throw saved.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: `figma_${property}_updated`, targetType, targetId, metadata: { source: 'figma-plugin', property } });
    res.json(result);
  } catch (error) { return respondWithError(res, error); }
});
app.post('/api/figma-plugin/unlink', pluginAuthMiddleware, rateLimit('figma_unlink'), async (req, res) => {
  try {
    requirePluginScope(req, 'external-reference:unlink');
    const workspaceId = await requirePluginWorkspace(req, 'member');
    const targetType = String(req.body?.target_type ?? '').trim();
    const targetId = String(req.body?.target_id ?? '').trim();
    if (!pluginTargetTypes.has(targetType) || !targetId) throw pluginError('Unsupported Ledger target.');
    const resolved = await resolvePluginReferenceForRequest({ req, workspaceId, body: req.body });
    if (!resolved.reference) return res.json({ removed: false, relationship_exists: false, canonical_url: resolved.canonicalUrl });
    const lookup = await supabase.from('external_reference_links').select('id, sources').eq('workspace_id', workspaceId).eq('external_reference_id', resolved.reference.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    if (lookup.error) throw lookup.error;
    if (!lookup.data) return res.json({ removed: false, relationship_exists: false, canonical_url: resolved.canonicalUrl });
    await requireFigmaCapability({ userId: req.pluginCredential.user_id, workspaceId, capability: 'unlink_reference', targetType, targetId });
    const result = await unlinkExternalReference({ supabase, workspaceId, referenceId: resolved.reference.id, linkId: lookup.data.id, source: 'integration' });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: result.removed ? 'figma_design_unlinked_through_plugin' : 'figma_plugin_integration_source_removed', targetType, targetId, metadata: { external_reference_id: resolved.reference.id, source: 'figma-plugin' } });
    res.json({ ...result, removed: Boolean(result.removed || result.sourceRemoved), relationship_exists: !result.removed, canonical_url: resolved.canonicalUrl, remaining_sources: result.removed ? [] : (lookup.data.sources ?? []).filter((source) => source !== 'integration') });
  } catch (error) { return respondWithError(res, error); }
});

const executePluginCreate = async ({ req, res, action, createTarget }) => {
  try {
    requirePluginScope(req, action === 'intake' ? 'intake:create' : 'task:create');
    requirePluginScope(req, 'external-reference:create');
    requirePluginScope(req, 'external-reference:link');
    const workspaceId = await requirePluginWorkspace(req, 'member');
    const idempotency = await pluginCreateIdempotency({ req, workspaceId, key: req.headers['idempotency-key'] || req.body?.idempotency_key, action });
    if (idempotency.existing) return res.json(idempotency.existing);
    const prepared = await preparePluginReference({ req, workspaceId, body: req.body });
    let target = await createTarget({ workspaceId, userId: req.pluginCredential.user_id, body: req.body, prepared });
    const completed = await finishPluginReference({ req, workspaceId, referenceId: prepared.reference.id, targetType: action === 'intake' ? 'intake' : 'task', targetId: target.id });
    const result = { target: mapPluginTarget({ id: target.id, type: action === 'intake' ? 'intake' : 'task', title: target.title, status: target.status, subtitle: action === 'intake' ? 'Intake item' : `${titleCaseLabel(target.status || 'todo')}` }), reference_id: prepared.reference.id, canonical_url: prepared.canonicalUrl, preview: completed.preview, partial: Boolean(completed.preview?.error || completed.preview?.consentRequired || completed.preview?.accessStatus === 'connection_required') };
    const saved = await supabase.from('figma_plugin_action_keys').update({ result }).eq('id', idempotency.reservationId).eq('workspace_id', workspaceId);
    if (saved.error) throw saved.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: action === 'intake' ? 'figma_selection_sent_to_intake' : 'figma_task_created', targetType: result.target.type, targetId: target.id, metadata: { external_reference_id: prepared.reference.id, source: 'figma-plugin', partial: result.partial } });
    return res.status(201).json(result);
  } catch (error) { return respondWithError(res, error); }
};

app.post('/api/figma-plugin/intake', pluginAuthMiddleware, rateLimit('write'), (req, res) => executePluginCreate({ req, res, action: 'intake', createTarget: async ({ workspaceId, userId, body, prepared }) => { const result = await supabase.from('inbox_items').insert({ workspace_id: workspaceId, user_id: userId, source: 'figma', source_provider: 'figma', source_id: prepared.reference.id, source_url: prepared.canonicalUrl, title: String(body?.title ?? prepared.selection.nodeId).trim() || 'Figma design', body: normalizeNullableText(body?.details), raw_payload: { source: 'figma-plugin', node_id: prepared.selection.nodeId, node_name: String(body?.selection?.node_name ?? '').slice(0, 200), page_name: String(body?.selection?.page_name ?? '').slice(0, 200), file_name: String(body?.selection?.file_name ?? '').slice(0, 200) }, suggested_type: 'unknown', status: 'unprocessed' }).select('id, title, status').single(); if (result.error) throw result.error; return result.data; } }));
app.post('/api/figma-plugin/tasks', pluginAuthMiddleware, rateLimit('write'), (req, res) => executePluginCreate({ req, res, action: 'task', createTarget: async ({ workspaceId, userId, body }) => { const projectId = body?.project_id ? String(body.project_id) : null; if (projectId && !(await ensureWorkspaceResource('projects', projectId, workspaceId))) throw pluginError('Project not found.', 404); const assignee = body?.assignee_id ? String(body.assignee_id) : null; if (assignee && !(await ensureWorkspaceMemberTarget(workspaceId, assignee))) throw pluginError('Assignee not found.', 404); const result = await supabase.from('tasks').insert({ workspace_id: workspaceId, project_id: projectId, assigned_to: assignee, title: String(body?.title ?? '').trim(), due_date: body?.due_date ? normalizeNullableDate(body.due_date, 'due date') : null, status: 'todo', priority: 'medium', tags: [], source: 'figma', source_platform: 'figma-plugin' }).select('id, title, status').single(); if (result.error) throw result.error; return result.data; } }));
app.post('/api/figma-plugin/links', pluginAuthMiddleware, rateLimit('write'), async (req, res) => { try { requirePluginScope(req, 'external-reference:link'); const workspaceId = await requirePluginWorkspace(req, 'member'); const targetType = String(req.body?.target_type ?? '').trim(); const targetId = String(req.body?.target_id ?? '').trim(); if (!pluginTargetTypes.has(targetType)) throw pluginError('Unsupported Ledger target.'); const prepared = await preparePluginReference({ req, workspaceId, body: req.body }); const completed = await finishPluginReference({ req, workspaceId, referenceId: prepared.reference.id, targetType, targetId }); const target = await pluginTargetSummary(workspaceId, targetType, targetId); if (!target) throw pluginError('Target object not found.', 404); const result = { target, reference_id: prepared.reference.id, canonical_url: prepared.canonicalUrl, preview: completed.preview, already_linked: Boolean(completed.link?.sources?.includes('integration')) }; await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.pluginCredential.user_id, action: result.already_linked ? 'figma_plugin_duplicate_link_reused' : 'figma_design_linked_through_plugin', targetType, targetId, metadata: { external_reference_id: prepared.reference.id, source: 'figma-plugin' } }); res.status(201).json(result); } catch (error) { return respondWithError(res, error); } });

app.post('/api/figma-plugin/auth/revoke', pluginAuthMiddleware, rateLimit('auth'), async (req, res) => {
  const revoked = await supabase.from('figma_plugin_credentials').update({ revoked_at: new Date().toISOString() }).eq('id', req.pluginCredential.id).is('revoked_at', null);
  if (revoked.error) return respondWithError(res, revoked.error);
  res.json({ revoked: true });
});

const githubFrontendRedirect = (result) => {
  const base = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/?settings=integrations&github=${encodeURIComponent(result)}`;
};
const githubManagementUrl = (installationId) => `https://github.com/settings/installations/${encodeURIComponent(installationId)}`;
const githubManageAccess = (role) => ['owner', 'admin'].includes(String(role ?? '').toLowerCase());
const githubStatusPayload = ({ installation, repositories, canManage }) => ({
  connected: Boolean(installation),
  account: installation ? { login: installation.github_account_login, type: installation.github_account_type } : null,
  repository_selection: installation?.repository_selection ?? null,
  installation_status: installation?.status ?? 'disconnected',
  management_url: installation?.management_url ?? null,
  last_synced_at: installation?.last_synced_at ?? null,
  health: installation ? {
    ...githubConnectionHealth({
      installationStatus: installation.status,
      repositoryCount: repositories?.length ?? 0,
      lastSyncedAt: installation.last_synced_at,
      lastWebhookProcessedAt: installation.last_webhook_processed_at,
      lastErrorAt: installation.last_sync_error_at,
    }),
    last_successful_sync_at: installation.last_synced_at ?? null,
    last_successful_webhook_at: installation.last_webhook_processed_at ?? null,
    error_code: installation.last_sync_error_code ?? null,
    error_message: installation.last_sync_error_message ?? null,
  } : { state: 'disconnected', label: 'Disconnected' },
  can_manage: canManage,
  repositories: (repositories ?? []).map((repo) => ({ id: repo.github_repository_id, owner_login: repo.owner_login, name: repo.name, full_name: repo.full_name, html_url: repo.html_url, is_private: repo.is_private, is_archived: repo.is_archived, is_disabled: repo.is_disabled, default_branch: repo.default_branch })),
});
const githubInstallationRows = async (workspaceId) => {
  const installation = await supabase.from('github_installations').select('id, workspace_id, installation_id, github_account_id, github_account_login, github_account_type, repository_selection, permissions, events, management_url, installed_by_user_id, installed_by_github_user_id, installed_by_github_login, status, last_synced_at, last_webhook_processed_at, last_sync_error_code, last_sync_error_message, last_sync_error_at, created_at, updated_at').eq('workspace_id', workspaceId).maybeSingle();
  if (installation.error) throw installation.error;
  if (!installation.data) return { installation: null, repositories: [] };
  const repos = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', workspaceId).eq('github_installation_id', installation.data.id).order('full_name');
  if (repos.error) throw repos.error;
  return { installation: installation.data, repositories: repos.data ?? [] };
};
const syncGithubRepositories = async ({ installationRow, repositories }) => {
  const values = repositories.map((repo) => ({ workspace_id: installationRow.workspace_id, ...normalizeGithubRepository(repo, installationRow.id), updated_at: new Date().toISOString() }));
  if (values.length) {
    const upserted = await supabase.from('github_repositories').upsert(values, { onConflict: 'github_installation_id,github_repository_id' });
    if (upserted.error) throw upserted.error;
  }
  const ids = values.map((repo) => repo.github_repository_id);
  let query = supabase.from('github_repositories').delete().eq('workspace_id', installationRow.workspace_id).eq('github_installation_id', installationRow.id);
  if (ids.length) query = query.not('github_repository_id', 'in', `(${ids.join(',')})`);
  const removed = await query;
  if (removed.error) throw removed.error;
  const updated = await supabase.from('github_installations').update({ last_synced_at: new Date().toISOString(), last_sync_error_code: null, last_sync_error_message: null, last_sync_error_at: null, updated_at: new Date().toISOString() }).eq('id', installationRow.id);
  if (updated.error) throw updated.error;
};

const recordGithubInstallationError = async ({ workspaceId, code, error }) => {
  if (!workspaceId) return;
  await supabase.from('github_installations').update({ last_sync_error_code: githubSafeErrorCode(error, code), last_sync_error_message: githubSafeErrorMessage({ ...error, code }), last_sync_error_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId);
};

const githubCaptureRuleSelect = 'id, workspace_id, name, event_type, enabled, repository_scope, repository_ids, label_filters, destination_type, destination_team_id, create_notification, create_intake_item, created_by_user_id, updated_by_user_id, created_at, updated_at';
const githubNotificationPreferenceDefaults = {
  repository_available: true,
  issue_events: true,
  pull_request_events: true,
  review_requests: true,
  checks_failing: true,
};

const githubRuleResponse = (row) => ({
  ...row,
  repository_ids: Array.isArray(row?.repository_ids) ? row.repository_ids : [],
  label_filters: Array.isArray(row?.label_filters) ? row.label_filters : [],
});

const getGithubNotificationPreference = async (workspaceId, userId) => {
  const result = await supabase.from('github_notification_preferences').select('repository_available, issue_events, pull_request_events, review_requests, checks_failing').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (result.error) throw result.error;
  return { ...githubNotificationPreferenceDefaults, ...(result.data ?? {}) };
};

const getGithubNotificationRecipients = async ({ workspaceId, category }) => {
  const workspace = await supabase.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle();
  const members = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId);
  if (workspace.error) throw workspace.error;
  if (members.error) throw members.error;
  const candidates = new Map();
  if (workspace.data?.owner_id) candidates.set(workspace.data.owner_id, 'owner');
  for (const member of members.data ?? []) candidates.set(member.user_id, member.role);
  const recipients = [];
  for (const [userId, role] of candidates) {
    if (category === 'repository_available' && !['owner', 'admin'].includes(String(role).toLowerCase())) continue;
    const preferences = await getGithubNotificationPreference(workspaceId, userId);
    if (preferences[category] === false) continue;
    recipients.push(userId);
  }
  return recipients;
};

const createGithubCaptureNotification = async ({ workspaceId, eventType, sourceId, title, body, githubUrl, intakeId = null, repositoryFullName = null }) => {
  const category = githubNotificationCategory(eventType);
  const recipients = await getGithubNotificationRecipients({ workspaceId, category });
  if (!recipients.length) return null;
  const existing = await supabase.from('notification_events').select('id').eq('workspace_id', workspaceId).eq('source_type', 'github_capture').eq('source_id', String(sourceId)).eq('notification_type', `github_${eventType}`).in('user_id', recipients).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;
  const scheduledFor = new Date().toISOString();
  const payload = recipients.map((userId) => ({
    user_id: userId,
    workspace_id: workspaceId,
    source_type: 'github_capture',
    source_id: String(sourceId),
    notification_type: `github_${eventType}`,
    scheduled_for: scheduledFor,
    delivered_in_app_at: scheduledFor,
    metadata: {
      title: String(title ?? '').slice(0, 240),
      body: String(body ?? '').slice(0, 500),
      context: repositoryFullName ? `GitHub · ${repositoryFullName}` : 'GitHub',
      moduleKind: intakeId ? 'inbox' : 'settings',
      focusPayload: intakeId ? { kind: 'inbox', focusInboxId: intakeId } : { kind: 'settings', settingsSection: 'integrations' },
      actions: ['open', 'dismiss'],
      githubUrl: githubUrl ?? null,
    },
  }));
  const result = await supabase.from('notification_events').upsert(payload, { onConflict: 'user_id,source_type,source_id,notification_type,scheduled_for', ignoreDuplicates: true }).select('id').limit(1);
  if (result.error) throw result.error;
  return result.data?.[0]?.id ?? null;
};

const validateGithubCaptureRule = async ({ workspaceId, input }) => {
  const rule = normalizeGithubCaptureRule(input);
  if (!GITHUB_CAPTURE_EVENT_TYPES.includes(rule.event_type)) {
    const error = new Error('Unsupported GitHub capture event.');
    error.statusCode = 400;
    throw error;
  }
  if (rule.destination_type === 'team_intake') {
    if (!rule.destination_team_id || !(await ensureWorkspaceTeam(rule.destination_team_id, workspaceId))) {
      const error = new Error('Team Intake destination not found.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    rule.destination_team_id = null;
  }
  const repositories = await supabase.from('github_repositories').select('id, github_repository_id').eq('workspace_id', workspaceId).limit(100);
  if (repositories.error) throw repositories.error;
  const approvedIds = new Set((repositories.data ?? []).flatMap((repository) => [repository.id, repository.github_repository_id]).map(String));
  if (rule.repository_scope === 'selected' && rule.repository_ids.some((id) => !approvedIds.has(String(id)))) {
    const error = new Error('One or more repositories are not approved for this workspace.');
    error.statusCode = 400;
    throw error;
  }
  return rule;
};

const createOrUpdateGithubCaptureReference = async ({ workspaceId, objectType, repository, object, userId }) => {
  if (!object || !['issue', 'pullRequest'].includes(objectType)) return null;
  const url = String(object.html_url ?? '').trim();
  if (!url) return null;
  const created = await createOrGetExternalReference({ supabase, workspaceId, provider: 'github', url, createdByUserId: userId });
  const parsedMetadata = buildGithubIntakePayload({ eventType: objectType === 'pullRequest' ? 'pull_request_opened' : 'issue_opened', repository, object }).raw_payload;
  const metadata = { ...(created.reference.metadata ?? {}), ...parsedMetadata };
  const updated = await supabase.from('external_references').update({ metadata, access_status: 'accessible', external_id: `${repository.id}:${objectType}:${object.id ?? object.number}`, external_identity: `github:${repository.id}:${objectType}:${object.id ?? object.number}`, normalized_url: url, external_url: url, last_resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', created.reference.id).select('id, workspace_id, provider, external_type, external_id, external_identity, external_url, normalized_url, metadata, access_status, last_resolved_at, created_at, updated_at').single();
  if (updated.error) throw updated.error;
  return updated.data;
};

const captureGithubWebhookEvent = async ({ workspaceId, eventType, action, repository, object, userId }) => {
  if (!eventType || !repository?.id) return { matched: 0, captured: 0 };
  const rulesResult = await supabase.from('github_capture_rules').select(githubCaptureRuleSelect).eq('workspace_id', workspaceId).eq('event_type', eventType).eq('enabled', true);
  if (rulesResult.error) throw rulesResult.error;
  const labels = object?.labels ?? [];
  const objectType = eventType.startsWith('pull_request') || ['review_requested', 'changes_requested', 'checks_failing'].includes(eventType) ? 'pull_request' : eventType.startsWith('issue_') ? 'issue' : 'repository';
  const objectId = String(object?.id ?? repository.id);
  let captured = 0;
  for (const rule of rulesResult.data ?? []) {
    if (!githubCaptureRuleMatches({ rule, eventType, repositoryId: repository.id, labels })) continue;
    const fingerprint = githubCaptureFingerprint({ ruleId: rule.id, repositoryId: repository.id, objectType, objectId, eventType });
    const logicalEventFingerprint = [repository.id, objectType, objectId, eventType].map((value) => String(value ?? '')).join(':');
    const existing = await supabase.from('github_capture_records').select('id, intake_item_id, notification_id').eq('workspace_id', workspaceId).eq('fingerprint', fingerprint).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) continue;
    const reference = await createOrUpdateGithubCaptureReference({ workspaceId, objectType, repository, object, userId });
    const intakePayload = reference && objectType !== 'repository' ? buildGithubIntakePayload({ eventType, repository, object }) : null;
    const lifecycleClosed = ['issue_closed', 'pull_request_closed_without_merge', 'pull_request_merged'].includes(eventType);
    let intakeId = null;
    if (rule.create_intake_item && intakePayload) {
      const inserted = await supabase.from('inbox_items').insert({ workspace_id: workspaceId, user_id: userId, updated_by: userId, source: 'github', source_provider: 'github', source_id: intakePayload.source_id, source_url: intakePayload.source_url, title: intakePayload.title, body: intakePayload.body, raw_payload: { ...intakePayload.raw_payload, capture_rule_id: rule.id, capture_rule_name: rule.name, suggested_team_id: rule.destination_type === 'team_intake' ? rule.destination_team_id : null }, suggested_type: intakePayload.suggested_type, status: lifecycleClosed ? 'archived' : intakePayload.status, archived_at: lifecycleClosed ? new Date().toISOString() : null, archived_by: lifecycleClosed ? userId : null }).select('id').single();
      if (inserted.error?.code === '23505') {
        const existingIntake = await supabase.from('inbox_items').select('id').eq('workspace_id', workspaceId).eq('source', 'github').eq('source_id', intakePayload.source_id).maybeSingle();
        if (existingIntake.error) throw existingIntake.error;
        intakeId = existingIntake.data?.id ?? null;
      } else if (inserted.error) throw inserted.error;
      else intakeId = inserted.data?.id ?? null;
      if (intakeId && reference) {
        const linked = await supabase.from('external_reference_links').upsert({ workspace_id: workspaceId, external_reference_id: reference.id, target_type: 'intake', target_id: intakeId, created_by_user_id: userId, sources: ['integration'], link_metadata: { capture_rule_id: rule.id } }, { onConflict: 'workspace_id,external_reference_id,target_type,target_id' }).select('id').maybeSingle();
        if (linked.error) throw linked.error;
      }
    }
    const notificationId = rule.create_notification ? await createGithubCaptureNotification({ workspaceId, eventType, sourceId: logicalEventFingerprint, title: intakePayload?.title ?? `GitHub repository available · ${repository.full_name}`, body: intakePayload?.body ?? `${repository.full_name} is now available to connect with Ledger.`, githubUrl: intakePayload?.source_url ?? repository.html_url, intakeId, repositoryFullName: repository.full_name }) : null;
    const record = await supabase.from('github_capture_records').insert({ workspace_id: workspaceId, rule_id: rule.id, github_repository_id: String(repository.id), github_object_type: objectType, github_object_id: objectId, github_event_action: action, external_reference_id: reference?.id ?? null, intake_item_id: intakeId, notification_id: notificationId, fingerprint }).select('id').maybeSingle();
    if (record.error?.code === '23505') continue;
    if (record.error) throw record.error;
    captured += 1;
  }
  return { matched: (rulesResult.data ?? []).length, captured };
};

const applyGithubLifecycleToLinkedIntake = async ({ workspaceId, reference, metadata, now, updatedBy }) => {
  const lifecycleState = String(metadata?.state ?? '').trim().toLowerCase();
  if (!['open', 'closed', 'merged', 'draft'].includes(lifecycleState)) return;

  const intakeLinks = (reference.links ?? []).filter((link) => ['intake', 'inbox'].includes(String(link.target_type ?? '').toLowerCase()) && link.target_id);
  for (const link of intakeLinks) {
    const current = await supabase.from('inbox_items').select('id, status, raw_payload').eq('workspace_id', workspaceId).eq('id', link.target_id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) continue;

    const rawPayload = current.data.raw_payload && typeof current.data.raw_payload === 'object' && !Array.isArray(current.data.raw_payload) ? current.data.raw_payload : {};
    const update = {
      raw_payload: {
        ...rawPayload,
        github_lifecycle_state: lifecycleState,
        github_lifecycle_state_reason: metadata?.stateReason ?? null,
        github_lifecycle_updated_at: metadata?.updatedAt ?? now,
        state: lifecycleState,
        stateReason: metadata?.stateReason ?? null,
      },
      updated_by: updatedBy ?? null,
      updated_at: now,
    };

    // Closed/merged external work leaves review only when it has not already
    // been accepted into a Ledger resource. Converted items retain their own
    // lifecycle and continue to surface the external state through the link.
    if (['closed', 'merged'].includes(lifecycleState) && ['unprocessed', 'snoozed'].includes(String(current.data.status ?? ''))) {
      Object.assign(update, { status: 'archived', archived_at: now, archived_by: updatedBy ?? null, snoozed_until: null });
    }

    const result = await supabase.from('inbox_items').update(update).eq('workspace_id', workspaceId).eq('id', current.data.id);
    if (result.error) throw result.error;
  }
};

const getApprovedGithubRepository = async (workspaceId, repositoryId) => {
  const value = String(repositoryId ?? '').trim();
  if (!value) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (isUuid) {
    const byInternalId = await supabase.from('github_repositories').select('id, github_repository_id, github_installation_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', workspaceId).eq('id', value).maybeSingle();
    if (byInternalId.error) throw byInternalId.error;
    if (byInternalId.data) return byInternalId.data;
  }
  const byGithubId = await supabase.from('github_repositories').select('id, github_repository_id, github_installation_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', workspaceId).eq('github_repository_id', value).maybeSingle();
  if (byGithubId.error) throw byGithubId.error;
  return byGithubId.data ?? null;
};

const assertApprovedGithubRepository = async (workspaceId, repositoryId, { allowUnavailable = false } = {}) => {
  const repository = await getApprovedGithubRepository(workspaceId, repositoryId);
  if (!repository) {
    const error = new Error('Repository is not approved for this workspace.');
    error.statusCode = 404;
    throw error;
  }
  if (!allowUnavailable && (repository.is_disabled || repository.is_archived)) {
    const error = new Error('This repository is unavailable for new links.');
    error.statusCode = 409;
    throw error;
  }
  const installation = await supabase.from('github_installations').select('id, status').eq('workspace_id', workspaceId).eq('id', repository.github_installation_id).maybeSingle();
  if (installation.error) throw installation.error;
  if (!installation.data || installation.data.status !== 'active') {
    const error = new Error('GitHub is not connected for this workspace.');
    error.statusCode = 409;
    throw error;
  }
  return repository;
};

const ensureGithubRepositoryExternalReference = async ({ workspaceId, repository, userId }) => {
  const created = await createOrGetExternalReference({ supabase, workspaceId, provider: 'github', url: repository.html_url, createdByUserId: userId });
  const metadata = {
    ...(created.reference.metadata ?? {}),
    provider: 'github',
    resourceKind: 'repository',
    githubRepositoryId: String(repository.github_repository_id),
    ownerLogin: repository.owner_login,
    repository: repository.name,
    repositoryFullName: repository.full_name,
    canonicalUrl: repository.html_url,
    isPrivate: Boolean(repository.is_private),
    isArchived: Boolean(repository.is_archived),
    isDisabled: Boolean(repository.is_disabled),
    defaultBranch: repository.default_branch ?? null,
  };
  const updated = await supabase.from('external_references').update({ metadata, access_status: repository.is_disabled ? 'inaccessible' : 'accessible', external_id: `github:${repository.github_repository_id}:repository`, external_identity: `github:${repository.github_repository_id}:repository`, external_url: repository.html_url, normalized_url: repository.html_url, last_resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', created.reference.id).select('id, workspace_id, provider, external_type, external_id, external_identity, external_url, normalized_url, metadata, access_status, last_resolved_at, created_at, updated_at').single();
  if (updated.error) throw updated.error;
  return updated.data;
};

const getProjectGithubRepositoryLinks = async (workspaceId, projectId) => {
  const links = await supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata, created_at, external_references(id, provider, external_type, metadata, external_url, normalized_url, access_status)').eq('workspace_id', workspaceId).eq('target_type', 'project').eq('target_id', projectId);
  if (links.error) throw links.error;
  return (links.data ?? []).filter((link) => link.external_references?.provider === 'github' && link.external_references?.external_type === 'repository');
};

const mapProjectGithubRepositoryLink = (link) => ({
  id: link.id,
  external_reference_id: link.external_reference_id,
  role: link.link_metadata?.role === 'primary' ? 'primary' : 'supporting',
  ...link.external_references,
});

const linkGithubRepositoryToProject = async ({ workspaceId, projectId, repositoryId, role, userId }) => {
  const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
  if (!projectAllowed) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    throw error;
  }
  const repository = await assertApprovedGithubRepository(workspaceId, repositoryId);
  const reference = await ensureGithubRepositoryExternalReference({ workspaceId, repository, userId });
  const existingLinks = await getProjectGithubRepositoryLinks(workspaceId, projectId);
  const existingLink = existingLinks.find((item) => item.external_reference_id === reference.id);
  if (existingLink) {
    if (role !== 'primary' || existingLink.role === 'primary') return mapProjectGithubRepositoryLink(existingLink);
  }
  const requestedRole = projectRepositoryRole({ existingCount: existingLinks.length, requestedRole: role });
  const link = await supabase.from('external_reference_links').upsert({ workspace_id: workspaceId, external_reference_id: reference.id, target_type: 'project', target_id: projectId, created_by_user_id: userId, sources: ['manual'], link_metadata: { role: requestedRole } }, { onConflict: 'workspace_id,external_reference_id,target_type,target_id' }).select('id, external_reference_id, target_type, target_id, link_metadata, created_at').single();
  if (link.error) throw link.error;
  if (requestedRole === 'primary') {
    const primary = await supabase.rpc('set_primary_external_reference_link', { p_workspace_id: workspaceId, p_link_id: link.data.id });
    if (primary.error) throw primary.error;
  }
  const refreshed = await getProjectGithubRepositoryLinks(workspaceId, projectId);
  return refreshed.find((item) => item.id === link.data.id) ?? refreshed.find((item) => item.external_reference_id === reference.id) ?? link.data;
};

app.get('/api/integrations/github/capture-rules', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase.from('github_capture_rules').select(githubCaptureRuleSelect).eq('workspace_id', workspaceId).order('created_at');
    if (result.error) throw result.error;
    res.json((result.data ?? []).map(githubRuleResponse));
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/github/capture-rules', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const rule = await validateGithubCaptureRule({ workspaceId, input: req.body });
    const result = await supabase.from('github_capture_rules').insert({ workspace_id: workspaceId, ...rule, created_by_user_id: req.authUser.id, updated_by_user_id: req.authUser.id }).select(githubCaptureRuleSelect).single();
    if (result.error?.code === '23505') return res.status(409).json({ error: 'A capture rule with this name already exists.' });
    if (result.error) throw result.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_capture_rule_created', targetType: 'github_capture_rule', targetId: result.data.id, metadata: { event_type: rule.event_type, enabled: rule.enabled, create_intake_item: rule.create_intake_item, create_notification: rule.create_notification } });
    res.status(201).json(githubRuleResponse(result.data));
  } catch (error) { return respondWithError(res, error); }
});

app.patch('/api/integrations/github/capture-rules/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const existing = await supabase.from('github_capture_rules').select(githubCaptureRuleSelect).eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return res.status(404).json({ error: 'GitHub capture rule not found.' });
    const rule = await validateGithubCaptureRule({ workspaceId, input: { ...existing.data, ...req.body } });
    const result = await supabase.from('github_capture_rules').update({ ...rule, updated_by_user_id: req.authUser.id, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', req.params.id).select(githubCaptureRuleSelect).single();
    if (result.error) throw result.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_capture_rule_updated', targetType: 'github_capture_rule', targetId: req.params.id, metadata: { event_type: rule.event_type, enabled: rule.enabled } });
    res.json(githubRuleResponse(result.data));
  } catch (error) { return respondWithError(res, error); }
});

app.delete('/api/integrations/github/capture-rules/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const result = await supabase.from('github_capture_rules').update({ enabled: false, updated_by_user_id: req.authUser.id, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', req.params.id).select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return res.status(404).json({ error: 'GitHub capture rule not found.' });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_capture_rule_disabled', targetType: 'github_capture_rule', targetId: req.params.id, metadata: {} });
    res.json({ disabled: true });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/capture-rules/preview', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase.from('github_repositories').select('id, github_repository_id, owner_login, name, full_name, is_private, is_archived').eq('workspace_id', workspaceId).order('full_name').limit(100);
    if (result.error) throw result.error;
    res.json((result.data ?? []).map((repository) => ({ ...repository, selected: String(req.query?.repositoryScope ?? '') !== 'selected' || (String(req.query?.repositoryIds ?? '').split(',').filter(Boolean).includes(String(repository.id))) })));
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/notification-preferences', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    res.json(await getGithubNotificationPreference(workspaceId, req.authUser.id));
  } catch (error) { return respondWithError(res, error); }
});

app.patch('/api/integrations/github/notification-preferences', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const values = Object.fromEntries(Object.keys(githubNotificationPreferenceDefaults).map((key) => [key, req.body?.[key] !== false]));
    const result = await supabase.from('github_notification_preferences').upsert({ workspace_id: workspaceId, user_id: req.authUser.id, ...values, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,user_id' }).select('repository_available, issue_events, pull_request_events, review_requests, checks_failing').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/references/:referenceId/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const reference = await supabase.from('external_references').select('id, provider, workspace_id').eq('workspace_id', workspaceId).eq('id', req.params.referenceId).maybeSingle();
    if (reference.error) throw reference.error;
    if (!reference.data || reference.data.provider !== 'github') return res.status(404).json({ error: 'GitHub reference not found' });
    const links = await supabase.from('external_reference_links').select('target_id').eq('workspace_id', workspaceId).eq('external_reference_id', req.params.referenceId).eq('target_type', 'task');
    if (links.error) throw links.error;
    const taskIds = (links.data ?? []).map((link) => link.target_id).filter(Boolean);
    if (!taskIds.length) return res.json([]);
    const tasks = await supabase.from('tasks').select('id, workspace_id, project_id, title, status, priority, created_at, updated_at').eq('workspace_id', workspaceId).in('id', taskIds).neq('status', 'completed').neq('status', 'cancelled');
    if (tasks.error) throw tasks.error;
    res.json(tasks.data ?? []);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/github/references/:referenceId/task', authMiddleware, rateLimit('write'), quotaGuard('tasks'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const reference = await supabase.from('external_references').select('id, provider, workspace_id, external_type, metadata, external_url, normalized_url').eq('workspace_id', workspaceId).eq('id', req.params.referenceId).maybeSingle();
    if (reference.error) throw reference.error;
    if (!reference.data || reference.data.provider !== 'github' || !['issue', 'pullRequest'].includes(reference.data.external_type)) return res.status(404).json({ error: 'GitHub issue or pull request reference not found' });
    const existingLinks = await supabase.from('external_reference_links').select('target_id').eq('workspace_id', workspaceId).eq('external_reference_id', reference.data.id).eq('target_type', 'task');
    if (existingLinks.error) throw existingLinks.error;
    const activeTaskIds = (existingLinks.data ?? []).map((link) => link.target_id).filter(Boolean);
    if (activeTaskIds.length) {
      const activeTasks = await supabase.from('tasks').select('id, workspace_id, project_id, title, status, priority, created_at, updated_at').eq('workspace_id', workspaceId).in('id', activeTaskIds).neq('status', 'completed').neq('status', 'cancelled');
      if (activeTasks.error) throw activeTasks.error;
      const activeGithubTasks = findActiveGithubTasks(activeTasks.data ?? []);
      if (activeGithubTasks.length && req.body?.allow_duplicate !== true) return res.status(409).json({ code: 'github_task_exists', error: 'A Ledger task already tracks this GitHub item.', tasks: activeGithubTasks });
    }
    const projectId = req.body?.project_id ? String(req.body.project_id) : null;
    if (projectId && !(await ensureWorkspaceResource('projects', projectId, workspaceId))) return res.status(404).json({ error: 'Project not found' });
    const metadata = reference.data.metadata ?? {};
    const title = String(req.body?.title ?? metadata.title ?? `GitHub ${reference.data.external_type === 'pullRequest' ? 'pull request' : 'issue'}`).trim().slice(0, 255);
    const notes = githubTaskDescription({ type: reference.data.external_type, number: metadata.number, repository: metadata.repositoryFullName, bodyPreview: metadata.bodyPreview, url: reference.data.normalized_url ?? reference.data.external_url });
    const payload = { workspace_id: workspaceId, project_id: projectId, title, description: notes, notes, due_date: null, due_time: null, status: 'todo', priority: String(req.body?.priority ?? 'medium'), assigned_to_user_id: null, assigned_to_team_id: null, assigned_team_id: null, assigned_by_user_id: null, assigned_at: null, tags: [], source: 'github', source_platform: 'github' };
    const insertAttempts = [
      { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: true },
      { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: false },
      { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: false },
    ];
    let createdTask = null;
    for (const attempt of insertAttempts) {
      const result = await supabase.from('tasks').insert({ ...payload, ...(attempt.includeTaskHorizon ? { task_horizon: 'long_term' } : {}), ...(attempt.includeShowInToday ? { show_in_today: false } : {}), ...(attempt.includeIsTodayFocus ? { is_today_focus: false } : {}) }).select(buildTaskSelectColumns(attempt)).single();
      if (!result.error) { createdTask = result.data; break; }
      if (!isMissingTaskTodayColumnError(result.error)) throw result.error;
    }
    if (!createdTask) throw new Error('Could not create task from GitHub reference');
    const linked = await supabase.from('external_reference_links').upsert({ workspace_id: workspaceId, external_reference_id: reference.data.id, target_type: 'task', target_id: createdTask.id, created_by_user_id: req.authUser.id, sources: ['integration'], link_metadata: { source: 'github' } }, { onConflict: 'workspace_id,external_reference_id,target_type,target_id' });
    if (linked.error) {
      await supabase.from('tasks').delete().eq('workspace_id', workspaceId).eq('id', createdTask.id);
      throw linked.error;
    }
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_task_created', targetType: 'task', targetId: createdTask.id, metadata: { external_reference_id: reference.data.id, project_id: projectId } });
    res.status(201).json(createdTask);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/status', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const rows = await githubInstallationRows(workspaceId);
    res.json(githubStatusPayload({ ...rows, canManage: githubManageAccess(access.role) }));
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/github/connect', authMiddleware, rateLimit('github_connect'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const config = { appId: process.env.GITHUB_APP_ID?.trim(), slug: process.env.GITHUB_APP_SLUG?.trim() };
    if (!config.appId || !config.slug || !process.env.GITHUB_APP_CLIENT_ID || !process.env.GITHUB_APP_CLIENT_SECRET || !process.env.GITHUB_APP_PRIVATE_KEY) throw Object.assign(new Error('GitHub integration is not configured.'), { statusCode: 503 });
    const state = createGithubState();
    const inserted = await supabase.from('github_installation_sessions').insert({ workspace_id: workspaceId, requested_by_user_id: req.authUser.id, state_hash: hashGithubState(state), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).select('id').single();
    if (inserted.error) throw inserted.error;
    res.json({ url: `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}` });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/callback', rateLimit('github_callback'), async (req, res) => {
  let userToken = null;
  try {
    const state = String(req.query?.state ?? '').trim();
    const code = String(req.query?.code ?? '').trim();
    const installationId = String(req.query?.installation_id ?? '').trim();
    if (!state || !code || !/^\d+$/.test(installationId)) return res.redirect(githubFrontendRedirect('error'));
    const now = new Date().toISOString();
    const session = await supabase.from('github_installation_sessions').select('id, workspace_id, requested_by_user_id, expires_at, consumed_at').eq('state_hash', hashGithubState(state)).is('consumed_at', null).gt('expires_at', now).maybeSingle();
    if (session.error || !session.data) return res.redirect(githubFrontendRedirect('expired'));
    const consumed = await supabase.from('github_installation_sessions').update({ consumed_at: now }).eq('id', session.data.id).is('consumed_at', null).select('id').maybeSingle();
    if (consumed.error || !consumed.data) return res.redirect(githubFrontendRedirect('expired'));
    await requireWorkspaceAccess(session.data.requested_by_user_id, session.data.workspace_id, 'admin');
    const exchanged = await exchangeGithubCode({ code });
    userToken = exchanged.access_token;
    const [githubUser, accessible] = await Promise.all([getGithubUser({ token: userToken }), getAccessibleInstallations({ token: userToken })]);
    const accessibleInstallation = (accessible.installations ?? []).find((item) => String(item.id) === installationId);
    if (!accessibleInstallation) return res.redirect(githubFrontendRedirect('error'));
    const canonical = await getCanonicalInstallation({ installationId });
    const configuredAppId = String(process.env.GITHUB_APP_ID ?? '').trim();
    if (String(canonical.app_id ?? configuredAppId) !== configuredAppId) return res.redirect(githubFrontendRedirect('error'));
    const existing = await supabase.from('github_installations').select('id, workspace_id').eq('installation_id', Number(installationId)).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.workspace_id !== session.data.workspace_id) return res.redirect(githubFrontendRedirect('already_connected'));
    const saved = await supabase.from('github_installations').upsert({ workspace_id: session.data.workspace_id, installation_id: Number(installationId), github_account_id: Number(canonical.account?.id ?? accessibleInstallation.account?.id), github_account_login: String(canonical.account?.login ?? accessibleInstallation.account?.login ?? ''), github_account_type: canonical.account?.type === 'Organization' ? 'Organization' : 'User', repository_selection: canonical.repository_selection === 'all' ? 'all' : 'selected', permissions: canonical.permissions ?? {}, events: canonical.events ?? [], management_url: canonical.html_url ?? githubManagementUrl(installationId), installed_by_user_id: session.data.requested_by_user_id, installed_by_github_user_id: Number(githubUser.id), installed_by_github_login: String(githubUser.login ?? ''), status: 'active', updated_at: now }, { onConflict: 'workspace_id' }).select('id, workspace_id, installation_id').single();
    if (saved.error) throw saved.error;
    const token = await createInstallationToken({ installationId });
    const repositories = await listInstallationRepositories({ token: token.token });
    await syncGithubRepositories({ installationRow: saved.data, repositories: repositories.repositories ?? [] });
    return res.redirect(githubFrontendRedirect('success'));
  } catch (error) {
    console.warn('GitHub callback failed', { code: githubSafeErrorCode(error) });
    return res.redirect(githubFrontendRedirect('error'));
  } finally { if (userToken) await revokeGithubUserToken({ token: userToken }); }
});

app.post('/api/integrations/github/refresh', authMiddleware, rateLimit('github_refresh'), async (req, res) => {
  let workspaceId = null;
  try {
    workspaceId = await resolveWorkspaceIdForRequest(req);
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const rows = await githubInstallationRows(workspaceId);
    if (!rows.installation) return res.status(404).json({ error: 'GitHub is not connected.' });
    const token = await createInstallationToken({ installationId: rows.installation.installation_id });
    const repositories = await listInstallationRepositories({ token: token.token });
    await syncGithubRepositories({ installationRow: rows.installation, repositories: repositories.repositories ?? [] });
    const latest = await githubInstallationRows(workspaceId);
    res.json(githubStatusPayload({ ...latest, canManage: githubManageAccess(access.role) }));
  } catch (error) {
    if (![401, 403].includes(Number(error?.statusCode))) await recordGithubInstallationError({ workspaceId, code: 'repository_sync_failed', error }).catch(() => {});
    return respondWithError(res, error);
  }
});

app.delete('/api/integrations/github', authMiddleware, rateLimit('github_disconnect'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirm disconnecting GitHub from Ledger.' });
    const deleted = await supabase.from('github_installations').delete().eq('workspace_id', workspaceId);
    if (deleted.error) throw deleted.error;
    res.json({ disconnected: true });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/github/webhook', rateLimit('github_webhook'), async (req, res) => {
  const deliveryId = String(req.headers['x-github-delivery'] ?? '').trim().slice(0, 180);
  const event = String(req.headers['x-github-event'] ?? '').trim().slice(0, 80);
  const action = String(req.body?.action ?? '').trim().slice(0, 80);
  let eventRecordId = null;
  let installationWorkspaceId = null;
  try {
    if (Buffer.byteLength(String(req.rawBody ?? ''), 'utf8') > 512 * 1024) return res.status(413).json({ error: 'Webhook payload is too large.' });
    if (!verifyGithubWebhookSignature({ rawBody: req.rawBody, signature: String(req.headers['x-hub-signature-256'] ?? ''), secret: process.env.GITHUB_APP_WEBHOOK_SECRET })) return res.status(401).json({ error: 'Invalid webhook signature.' });
    if (!deliveryId) return res.status(400).json({ error: 'Missing webhook delivery.' });
    const installationId = Number(req.body?.installation?.id ?? req.body?.installation_id);
    const repositoryId = String(req.body?.repository?.id ?? '').trim();
    const eventRecord = await supabase.from('integration_webhook_events').insert({ provider: 'github', provider_event_id: deliveryId, event_type: action ? `${event}:${action}` : event, external_resource_id: repositoryId || null, status: 'pending' }).select('id').maybeSingle();
    if (eventRecord.error?.code === '23505') return res.status(202).json({ accepted: true, duplicate: true });
    if (eventRecord.error) throw eventRecord.error;
    eventRecordId = eventRecord.data?.id ?? null;
    if (!Number.isSafeInteger(installationId)) {
      if (eventRecord.data?.id) await supabase.from('integration_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('id', eventRecord.data.id);
      return res.status(202).json({ accepted: true, ignored: true });
    }
    const row = await supabase.from('github_installations').select('id, workspace_id, installation_id, installed_by_user_id, status, repository_selection, last_synced_at, last_webhook_processed_at, last_sync_error_code, last_sync_error_message, last_sync_error_at').eq('installation_id', installationId).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) {
      if (eventRecord.data?.id) await supabase.from('integration_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString(), error_code: 'installation_not_connected' }).eq('id', eventRecord.data.id);
      return res.status(202).json({ accepted: true, ignored: true });
    }
    installationWorkspaceId = row.data.workspace_id;
    const now = new Date().toISOString();
    if (event === 'installation') {
      const status = action === 'suspend' ? 'suspended' : action === 'unsuspend' ? 'active' : action === 'deleted' ? 'deleted' : row.data.status;
      await supabase.from('github_installations').update({ status, updated_at: now }).eq('id', row.data.id);
      if (['suspend', 'deleted'].includes(action)) {
        const refs = await supabase.from('external_references').select('id, metadata, access_status, external_type').eq('workspace_id', row.data.workspace_id).eq('provider', 'github').limit(500);
        for (const reference of refs.data ?? []) {
          const updated = { ...reference.metadata, unavailableReason: action === 'suspend' ? 'installation_suspended' : 'installation_deleted' };
          await supabase.from('external_references').update({ metadata: updated, access_status: 'inaccessible', updated_at: now }).eq('id', reference.id).eq('workspace_id', row.data.workspace_id);
        }
      }
    } else if (event === 'installation_repositories' && ['added', 'removed'].includes(action)) {
      const removed = (req.body?.repositories_removed ?? []).map((repo) => String(repo?.id ?? '')).filter(Boolean);
      if (removed.length) {
        const refs = await supabase.from('external_references').select('id, metadata').eq('workspace_id', row.data.workspace_id).eq('provider', 'github').limit(500);
        for (const reference of refs.data ?? []) if (removed.includes(String(reference.metadata?.githubRepositoryId ?? ''))) {
          const metadata = { ...reference.metadata, unavailableReason: 'repository_access_removed' };
          await supabase.from('external_references').update({ access_status: 'inaccessible', metadata, updated_at: now }).eq('id', reference.id);
          const linked = await supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata').eq('workspace_id', row.data.workspace_id).eq('external_reference_id', reference.id);
          if (linked.data?.length) await reconcileGithubAttention({ supabase, workspaceId: row.data.workspace_id, reference: { ...reference, metadata, access_status: 'inaccessible', links: linked.data }, eventTime: now });
        }
      }
      const token = await createInstallationToken({ installationId });
      const repositories = await listInstallationRepositories({ token: token.token });
      await syncGithubRepositories({ installationRow: row.data, repositories: repositories.repositories ?? [] });
    } else if (event === 'repository') {
      const repo = req.body?.repository;
      const repoId = String(repo?.id ?? repositoryId);
      const lifecycleUpdate = { owner_login: String(repo?.owner?.login ?? '').slice(0, 100), name: String(repo?.name ?? '').slice(0, 100), full_name: String(repo?.full_name ?? '').slice(0, 220), html_url: String(repo?.html_url ?? '').slice(0, 500), is_private: Boolean(repo?.private), is_archived: Boolean(repo?.archived), is_disabled: Boolean(repo?.disabled) || action === 'deleted', default_branch: String(repo?.default_branch ?? '').slice(0, 120), updated_at: now };
      await supabase.from('github_repositories').update(lifecycleUpdate).eq('workspace_id', row.data.workspace_id).eq('github_installation_id', row.data.id).eq('github_repository_id', repoId);
      const refs = await supabase.from('external_references').select('id, metadata').eq('workspace_id', row.data.workspace_id).eq('provider', 'github').limit(500);
      for (const reference of refs.data ?? []) if (String(reference.metadata?.githubRepositoryId ?? '') === repoId) {
        if (isStaleGithubEvent({ eventUpdatedAt: repo?.updated_at ?? req.body?.repository?.updated_at, storedUpdatedAt: reference.metadata?.lastGithubUpdatedAt ?? reference.metadata?.updatedAt })) continue;
        const metadata = { ...reference.metadata, repositoryFullName: lifecycleUpdate.full_name, canonicalUrl: lifecycleUpdate.html_url, ownerLogin: lifecycleUpdate.owner_login, name: lifecycleUpdate.name, isPrivate: lifecycleUpdate.is_private, isArchived: lifecycleUpdate.is_archived, isDisabled: lifecycleUpdate.is_disabled, unavailableReason: action === 'deleted' ? 'repository_deleted' : null };
        await supabase.from('external_references').update({ metadata, access_status: action === 'deleted' ? 'inaccessible' : 'accessible', updated_at: now }).eq('id', reference.id);
        const linked = await supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata').eq('workspace_id', row.data.workspace_id).eq('external_reference_id', reference.id);
        if (linked.data?.length) await reconcileGithubAttention({ supabase, workspaceId: row.data.workspace_id, reference: { ...reference, metadata, access_status: action === 'deleted' ? 'inaccessible' : 'accessible', links: linked.data }, eventTime: now });
      }
    } else if (row.data.status === 'active' && ['issues', 'pull_request', 'pull_request_review', 'check_run', 'check_suite', 'status'].includes(event)) {
      const repo = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', row.data.workspace_id).eq('github_repository_id', repositoryId).maybeSingle();
      if (repo.data) {
        const issue = req.body?.issue;
        const pull = req.body?.pull_request ?? issue?.pull_request;
        const check = req.body?.check_run;
        let candidates = pull ?? issue ?? check?.pull_requests?.[0] ?? null;
        if (!candidates && ['check_run', 'check_suite', 'status'].includes(event)) {
          const sha = String(check?.head_sha ?? req.body?.sha ?? '').trim();
          if (sha) candidates = await findGithubPullRequestsForCommit({ repository: repo.data, sha, installationId }).catch(() => []);
        }
        const candidateRows = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
        const kind = pull || check?.pull_requests?.length || ['check_run', 'check_suite', 'status'].includes(event) ? 'pullRequest' : 'issue';
        const refs = (await Promise.all(candidateRows.map((candidate) => findLinkedGithubReferences({ supabase, workspaceId: row.data.workspace_id, repositoryId, githubId: candidate.id, nodeId: candidate.node_id, number: candidate.number, resourceKind: kind })))).flat().filter((reference, index, array) => array.findIndex((item) => item.id === reference.id) === index);
        for (const reference of refs) {
          try {
            const eventUpdatedAt = candidates?.updated_at ?? candidateRows.find((candidate) => candidate.id === reference.metadata?.githubId)?.updated_at ?? null;
            if (isStaleGithubEvent({ eventUpdatedAt, storedUpdatedAt: reference.metadata?.updatedAt })) continue;
            const parsed = parseGithubUrl(reference.external_url);
            const token = await createInstallationToken({ installationId });
            const resolved = await resolveGithubMetadata(parsed, { accessToken: token.token, approvedRepository: repo.data });
            const webhookState = pull?.merged ? 'merged' : String((pull ?? issue)?.state ?? '').trim().toLowerCase();
            const webhookLifecycle = ['open', 'closed', 'merged', 'draft'].includes(webhookState)
              ? { state: webhookState, stateReason: (pull ?? issue)?.state_reason ?? null }
              : {};
            const metadata = { ...reference.metadata, ...resolved.metadata, ...webhookLifecycle };
            const updated = await supabase.from('external_references').update({ metadata, access_status: resolved.accessStatus, external_id: `${metadata.githubRepositoryId}:${reference.external_type}:${metadata.githubId ?? metadata.number}`, external_identity: `github:${metadata.githubRepositoryId}:${reference.external_type}:${metadata.githubId ?? metadata.number}`, last_resolved_at: now, updated_at: now }).eq('id', reference.id).eq('workspace_id', row.data.workspace_id).select('id, workspace_id, provider, external_type, metadata, access_status').single();
            if (!updated.error) {
              const updatedReference = { ...reference, ...updated.data, metadata, access_status: resolved.accessStatus };
              await applyGithubLifecycleToLinkedIntake({ workspaceId: row.data.workspace_id, reference: updatedReference, metadata, now, updatedBy: row.data.installed_by_user_id });
              await reconcileGithubAttention({ supabase, workspaceId: row.data.workspace_id, reference: updatedReference, eventTime: now });
            }
          } catch (error) {
            const accessStatus = error instanceof GithubProviderError && ['not_found', 'inaccessible', 'revoked'].includes(error.accessStatus) ? 'inaccessible' : 'error';
            await supabase.from('external_references').update({ access_status: accessStatus, updated_at: now }).eq('id', reference.id).eq('workspace_id', row.data.workspace_id);
          }
        }
      }
    }
    if (row.data.status === 'active') {
      const captureEvent = githubCaptureEventType({ event, action, payload: req.body });
      if (captureEvent) {
        const captureObjects = [];
        if (event === 'installation_repositories' && action === 'added') {
          for (const added of req.body?.repositories_added ?? []) {
            const approved = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', row.data.workspace_id).eq('github_repository_id', String(added?.id ?? '')).maybeSingle();
            if (!approved.error && approved.data) captureObjects.push({ repository: { ...approved.data, id: approved.data.github_repository_id }, object: null });
          }
        } else if (event === 'installation_repositories' && action === 'removed') {
          for (const removed of req.body?.repositories_removed ?? []) {
            if (!removed?.id) continue;
            captureObjects.push({ repository: { ...removed, id: String(removed.id), full_name: removed.full_name, html_url: removed.html_url }, object: null });
          }
        } else if (repositoryId) {
          if (event === 'repository' && action === 'created') {
            try {
              const token = await createInstallationToken({ installationId });
              const repositories = await listInstallationRepositories({ token: token.token });
              await syncGithubRepositories({ installationRow: row.data, repositories: repositories.repositories ?? [] });
            } catch {
              // The lifecycle event is still acknowledged; a later refresh can recover access.
            }
          }
          const approved = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', row.data.workspace_id).eq('github_repository_id', repositoryId).maybeSingle();
          if (!approved.error && approved.data) {
            const object = req.body?.issue ?? req.body?.pull_request ?? req.body?.check_run?.pull_requests?.[0] ?? null;
            if (object || captureEvent.startsWith('repository_')) captureObjects.push({ repository: { ...approved.data, id: approved.data.github_repository_id }, object });
          }
        }
        for (const capture of captureObjects) {
          const captured = await captureGithubWebhookEvent({ workspaceId: row.data.workspace_id, eventType: captureEvent, action, repository: capture.repository, object: capture.object, userId: row.data.installed_by_user_id });
          if (captured.captured) await writeWorkspaceAuditLog({ workspaceId: row.data.workspace_id, actorUserId: row.data.installed_by_user_id, action: 'github_capture_created', targetType: 'github_capture_rule', targetId: captureEvent, metadata: { event_type: captureEvent, captured: captured.captured } });
        }
      }
    }
    const processedAt = new Date().toISOString();
    await supabase.from('github_installations').update({ last_webhook_processed_at: processedAt, last_sync_error_code: null, last_sync_error_message: null, last_sync_error_at: null, updated_at: processedAt }).eq('id', row.data.id).eq('workspace_id', row.data.workspace_id);
    if (eventRecord.data?.id) await supabase.from('integration_webhook_events').update({ status: 'processed', processed_at: processedAt }).eq('id', eventRecord.data.id);
    await writeWorkspaceAuditLog({ workspaceId: row.data.workspace_id, actorUserId: row.data.installed_by_user_id, action: 'github_webhook_delivery_processed', targetType: 'github_webhook', targetId: deliveryId, metadata: { event, action, repository_id: repositoryId || null } });
    res.status(202).json({ accepted: true });
  } catch (error) {
    if (eventRecordId) await supabase.from('integration_webhook_events').update({ status: 'failed', processed_at: new Date().toISOString(), error_code: 'safe_processing_failure' }).eq('id', eventRecordId);
    await recordGithubInstallationError({ workspaceId: installationWorkspaceId, code: 'webhook_processing_failed', error }).catch(() => {});
    return res.status(202).json({ accepted: true });
  }
});

app.get('/api/integrations/figma/status', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const result = await supabase
      .from('integration_accounts')
      .select('id, provider_user_id, provider_team_name, access_token_encrypted, scopes, installed_by, created_at, updated_at, connection_status, last_checked_at, connection_error')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'figma')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      if (isMissingRelationError(result.error, 'integration_accounts')) return res.json({ status: 'disconnected' });
      throw result.error;
    }
    const account = result.data;
    if (!account?.id) return res.json({ status: 'disconnected' });
    let connectionStatus = account.connection_status || 'connected';
    let lastCheckedAt = new Date().toISOString();
    const accessToken = readIntegrationToken(account.access_token_encrypted);
    if (accessToken && connectionStatus === 'connected') {
      try {
        const healthResponse = await fetch('https://api.figma.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (healthResponse.status === 401 || healthResponse.status === 403) connectionStatus = 'revoked';
        else if (!healthResponse.ok) connectionStatus = 'error';
      } catch {
        connectionStatus = 'error';
      }
      await supabase.from('integration_accounts').update({ connection_status: connectionStatus, last_checked_at: lastCheckedAt, connection_error: connectionStatus === 'error' ? 'health_check_failed' : null }).eq('id', account.id);
    }
    let connectedBy = null;
    if (account.installed_by) {
      const userResult = await supabase.from('users').select('id, full_name, email').eq('id', account.installed_by).maybeSingle();
      connectedBy = userResult.data ? { name: userResult.data.full_name || userResult.data.email || 'Ledger member', email: userResult.data.email || null } : null;
    }
    const automation = await getFigmaAutomationSettings({ supabase, workspaceId });
    res.json({
      status: connectionStatus,
      connected_account: { name: account.provider_team_name || null, id: account.provider_user_id || null },
      scopes: account.scopes || [],
      connected_by: connectedBy,
      connected_on: account.created_at || null,
      updated_at: account.updated_at || null,
      last_checked_at: lastCheckedAt || account.last_checked_at || null,
      error: connectionStatus === 'error' ? 'We couldn’t check Figma right now. Try again in a moment.' : null,
      change_detection: { enabled: automation.change_detection_enabled, health: automation.webhook_health, last_checked_at: lastCheckedAt || account.last_checked_at || null },
      automation: { notify_linked_work: automation.notify_linked_work, automatically_refresh_previews: automation.automatically_refresh_previews, create_intake_on_change: automation.create_intake_on_change },
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/figma/install-url', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'manage_connection' });
    const state = createFigmaOAuthState({ workspaceId, userId: req.authUser.id });
    const attempt = await supabase.from('integration_oauth_attempts').insert({
      provider: 'figma', workspace_id: workspaceId, user_id: req.authUser.id,
      state_hash: crypto.createHash('sha256').update(state).digest('hex'),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (attempt.error && !isMissingRelationError(attempt.error, 'integration_oauth_attempts')) throw attempt.error;
    res.json({ url: buildFigmaAuthorizeUrl({ workspaceId, userId: req.authUser.id, state }) });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/integrations/figma/automation', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    res.json(await getFigmaAutomationSettings({ supabase, workspaceId }));
  } catch (error) { return respondWithError(res, error); }
});

app.patch('/api/integrations/figma/automation', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const values = req.body ?? {};
    if (values.automatically_refresh_previews === true && values.confirm_automatic_refresh !== true) return res.status(400).json({ error: 'Confirm automatic preview refresh before enabling it.' });
    const settings = await updateFigmaAutomationSettings({ supabase, workspaceId, values });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_automation_settings_updated', targetType: 'workspace', targetId: workspaceId, metadata: { change_detection_enabled: settings.change_detection_enabled, notify_linked_work: settings.notify_linked_work, automatically_refresh_previews: settings.automatically_refresh_previews, create_intake_on_change: settings.create_intake_on_change } });
    res.json(settings);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/figma/webhooks/register', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin');
    const webhookId = String(req.body?.webhook_id ?? '').trim().slice(0, 160);
    const eventType = String(req.body?.event_type ?? 'FILE_VERSION_UPDATE').trim().slice(0, 120);
    const passcode = String(req.body?.passcode ?? '').trim();
    if (!webhookId || passcode.length < 12) return res.status(400).json({ error: 'A valid Figma webhook registration is required.' });
    const result = await supabase.from('figma_workspace_automation_settings').upsert({ workspace_id: workspaceId, webhook_id: webhookId, webhook_event_type: eventType, webhook_passcode_hash: crypto.createHash('sha256').update(passcode).digest('hex'), webhook_health: 'active', updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' }).select('workspace_id, webhook_health, webhook_event_type, updated_at').single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/figma/webhook', rateLimit('figma_webhook'), async (req, res) => {
  try {
    if (Buffer.byteLength(String(req.rawBody ?? ''), 'utf8') > 256 * 1024) return res.status(413).json({ error: 'Webhook payload is too large.' });
    const webhookId = String(req.query?.webhook_id ?? req.headers['x-figma-webhook-id'] ?? '').trim();
    const passcode = String(req.headers['x-figma-webhook-passcode'] ?? req.body?.passcode ?? '').trim();
    if (!webhookId || !passcode || passcode.length > 512) return res.status(401).json({ error: 'Invalid webhook authorization.' });
    const settings = await supabase.from('figma_workspace_automation_settings').select('workspace_id, webhook_id, webhook_event_type, webhook_passcode_hash').eq('webhook_id', webhookId).maybeSingle();
    if (settings.error) throw settings.error;
    const stored = Buffer.from(String(settings.data?.webhook_passcode_hash ?? ''));
    const supplied = Buffer.from(crypto.createHash('sha256').update(passcode).digest('hex'));
    if (!settings.data || stored.length !== supplied.length || !crypto.timingSafeEqual(stored, supplied)) return res.status(401).json({ error: 'Invalid webhook authorization.' });
    const eventType = String(req.body?.event_type ?? req.body?.eventType ?? '').trim();
    if (!eventType || (settings.data.webhook_event_type && eventType !== settings.data.webhook_event_type)) return res.status(200).json({ accepted: true, ignored: true });
    const providerEventId = String(req.body?.event_id ?? req.body?.id ?? '').trim().slice(0, 200) || null;
    const resourceId = String(req.body?.file_key ?? req.body?.fileKey ?? req.body?.resource_id ?? '').trim().slice(0, 200) || null;
    const inserted = await supabase.from('integration_webhook_events').insert({ workspace_id: settings.data.workspace_id, provider: 'figma', provider_event_id: providerEventId, event_type: eventType, external_resource_id: resourceId, status: 'pending' }).select('id').maybeSingle();
    if (inserted.error?.code === '23505') return res.status(200).json({ accepted: true, duplicate: true });
    if (inserted.error) throw inserted.error;
    if (resourceId) await markFigmaReferencesForCheck({ supabase, workspaceId: settings.data.workspace_id, fileKey: resourceId });
    await supabase.from('figma_workspace_automation_settings').update({ webhook_health: 'active', last_webhook_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('workspace_id', settings.data.workspace_id);
    if (inserted.data?.id) await supabase.from('integration_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', inserted.data.id);
    res.status(202).json({ accepted: true });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/figma/oauth/callback', rateLimit('auth'), async (req, res) => {
  try {
    const code = String(req.query?.code ?? '').trim();
    const state = String(req.query?.state ?? '').trim();
    const errorCode = String(req.query?.error ?? '').trim();
    if (errorCode || !code) return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false));
    const statePayload = verifyFigmaOAuthState(state);
    if (!statePayload) return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'This authorization attempt expired. Start again in Ledger.'));
    const attempt = await supabase.from('integration_oauth_attempts').select('id, user_id, workspace_id, consumed_at, expires_at').eq('state_hash', statePayload.state_hash).eq('provider', 'figma').maybeSingle();
    if (attempt.error && !isMissingRelationError(attempt.error, 'integration_oauth_attempts')) throw attempt.error;
    if (!attempt.data || attempt.data.user_id !== statePayload.user_id || attempt.data.workspace_id !== statePayload.workspace_id || attempt.data.consumed_at || new Date(attempt.data.expires_at).getTime() < Date.now()) {
      return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'This authorization attempt is no longer valid. Start again in Ledger.'));
    }
    const consumed = await supabase.from('integration_oauth_attempts').update({ consumed_at: new Date().toISOString() }).eq('id', attempt.data.id).is('consumed_at', null).select('id').maybeSingle();
    if (consumed.error || !consumed.data) return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'This authorization attempt is no longer valid. Start again in Ledger.'));
    await requireWorkspaceAccess(statePayload.user_id, statePayload.workspace_id, 'admin');
    const clientId = process.env.FIGMA_CLIENT_ID?.trim();
    const clientSecret = process.env.FIGMA_CLIENT_SECRET?.trim();
    const redirectUri = getFigmaRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) throw new Error('Figma OAuth is not configured');
    const tokenResponse = await fetch('https://api.figma.com/v1/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: 'authorization_code' }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload?.access_token) return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'We couldn’t finish connecting Figma. Try again in a moment.'));
    const profileResponse = await fetch('https://api.figma.com/v1/me', { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile?.id) return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'We couldn’t load your Figma account. Try again in a moment.'));
    const accountPayload = {
      workspace_id: statePayload.workspace_id, provider: 'figma', provider_user_id: profile.id,
      provider_team_id: profile.id, provider_team_name: profile.handle || null,
      access_token_encrypted: protectIntegrationTokenForStorage(tokenPayload.access_token),
      refresh_token_encrypted: protectIntegrationTokenForStorage(tokenPayload.refresh_token),
      scopes: ['current_user:read', 'file_content:read'], installed_by: statePayload.user_id,
      connection_status: 'connected', connection_error: null, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const existing = await supabase.from('integration_accounts').select('id').eq('workspace_id', statePayload.workspace_id).eq('provider', 'figma').maybeSingle();
    if (existing.error) throw existing.error;
    const accountResult = existing.data?.id
      ? await supabase.from('integration_accounts').update(accountPayload).eq('id', existing.data.id)
      : await supabase.from('integration_accounts').insert(accountPayload);
    if (accountResult.error) throw accountResult.error;
    res.status(200).type('html').send(buildFigmaOAuthCompleteHtml(true, `Connected as ${profile.handle || profile.email || 'your Figma account'}.`));
  } catch (error) {
    console.error('Figma OAuth callback failed', { message: error instanceof Error ? error.message : 'unknown_error' });
    return res.status(400).type('html').send(buildFigmaOAuthCompleteHtml(false, 'We couldn’t finish connecting Figma. Try again in a moment.'));
  }
});

app.delete('/api/integrations/figma/disconnect', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'manage_connection' });
    const result = await supabase.from('integration_accounts').select('id, access_token_encrypted').eq('workspace_id', workspaceId).eq('provider', 'figma').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data?.id) return res.json({ status: 'disconnected' });
    // Figma revocation is best-effort; Ledger still invalidates its credential immediately.
    const accessToken = readIntegrationToken(result.data.access_token_encrypted);
    if (accessToken && process.env.FIGMA_CLIENT_ID && process.env.FIGMA_CLIENT_SECRET) {
      await fetch('https://api.figma.com/v1/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.FIGMA_CLIENT_ID, client_secret: process.env.FIGMA_CLIENT_SECRET, token: accessToken }) }).catch(() => null);
    }
    const deleted = await supabase.from('integration_accounts').delete().eq('id', result.data.id);
    if (deleted.error) throw deleted.error;
    await supabase.from('figma_workspace_automation_settings').update({ webhook_health: 'not_configured', webhook_id: null, webhook_event_type: null, webhook_passcode_hash: null, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId);
    res.json({ status: 'disconnected' });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/integrations/figma/data/remove', authMiddleware, rateLimit('figma_cleanup'), async (req, res) => {
  const workspaceId = await resolveWorkspaceIdForRequest(req);
  try {
    const access = await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'delete_workspace_figma_data' });
    const workspaceName = String(access.workspace?.name ?? '').trim();
    if (!workspaceName || String(req.body?.workspace_name ?? '').trim() !== workspaceName) return res.status(400).json({ error: 'Type the workspace name exactly to remove stored Figma data.' });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_data_removal_started', targetType: 'workspace', targetId: workspaceId, metadata: { scope: 'figma' } });
    const refsResult = await supabase.from('external_references').select('id, external_url, normalized_url').eq('workspace_id', workspaceId).eq('provider', 'figma').is('deleted_at', null);
    if (refsResult.error) throw refsResult.error;
    const refs = refsResult.data ?? [];
    const refIds = refs.map((ref) => ref.id);
    if (refIds.length) {
      const notesResult = await supabase.from('notes').select('id, content_html').eq('workspace_id', workspaceId);
      if (notesResult.error) throw notesResult.error;
      for (const note of notesResult.data ?? []) {
        let html = String(note.content_html ?? '');
        for (const ref of refs) {
          const escaped = String(ref.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const url = String(ref.normalized_url ?? ref.external_url ?? '');
          html = html.replace(new RegExp(`<div[^>]*data-external-reference-id=["']${escaped}["'][^>]*>\\s*</div>`, 'gi'), `<p><a href="${url}">${url}</a></p>`);
        }
        if (html !== String(note.content_html ?? '')) {
          const updated = await supabase.from('notes').update({ content_html: html }).eq('id', note.id).eq('workspace_id', workspaceId);
          if (updated.error) throw updated.error;
        }
      }
      const previews = await supabase.from('external_reference_previews').select('storage_key').eq('workspace_id', workspaceId).in('external_reference_id', refIds);
      if (previews.error) throw previews.error;
      const keys = (previews.data ?? []).map((row) => row.storage_key).filter(Boolean);
      if (keys.length) await supabase.storage.from('note-images').remove(keys);
      const linksDeleted = await supabase.from('external_reference_links').delete().eq('workspace_id', workspaceId).in('external_reference_id', refIds);
      if (linksDeleted.error) throw linksDeleted.error;
      const previewsDeleted = await supabase.from('external_reference_previews').delete().eq('workspace_id', workspaceId).in('external_reference_id', refIds);
      if (previewsDeleted.error) throw previewsDeleted.error;
      const statesDeleted = await supabase.from('external_reference_change_states').delete().eq('workspace_id', workspaceId).in('external_reference_id', refIds);
      if (statesDeleted.error) throw statesDeleted.error;
      const refsDeleted = await supabase.from('external_references').delete().eq('workspace_id', workspaceId).in('id', refIds);
      if (refsDeleted.error) throw refsDeleted.error;
    }
    await supabase.from('figma_workspace_automation_settings').delete().eq('workspace_id', workspaceId);
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_data_removal_completed', targetType: 'workspace', targetId: workspaceId, metadata: { references: refs.length } });
    res.json({ removed: true, references: refs.length });
  } catch (error) {
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_data_removal_failed', targetType: 'workspace', targetId: workspaceId, metadata: { reason: 'safe_failure' } }).catch(() => null);
    return respondWithError(res, error);
  }
});

const externalTargetTables = {
  task: 'tasks',
  project: 'projects',
  note: 'notes',
  meetingNote: 'notes',
  meetingNote: 'notes',
  intake: 'inbox_items',
  event: 'events',
  reminder: 'reminders',
};

const transferInboxExternalReferences = async ({ workspaceId, inboxId, targetType, targetId, userId }) => {
  const sourceLinks = await supabase.from('external_reference_links').select('external_reference_id, sources, link_metadata').eq('workspace_id', workspaceId).eq('target_type', 'intake').eq('target_id', inboxId);
  if (sourceLinks.error) throw sourceLinks.error;
  for (const source of sourceLinks.data ?? []) {
    const existing = await supabase.from('external_reference_links').select('id, sources').eq('workspace_id', workspaceId).eq('external_reference_id', source.external_reference_id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    if (existing.error) throw existing.error;
    const sources = Array.from(new Set([...(existing.data?.sources ?? []), ...(source.sources ?? []), 'conversion']));
    if (existing.data) {
      const updated = await supabase.from('external_reference_links').update({ sources }).eq('id', existing.data.id).eq('workspace_id', workspaceId);
      if (updated.error) throw updated.error;
    } else {
      const inserted = await supabase.from('external_reference_links').insert({ workspace_id: workspaceId, external_reference_id: source.external_reference_id, target_type: targetType, target_id: targetId, created_by_user_id: userId, sources, link_metadata: source.link_metadata ?? {} });
      if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
    }
  }
};

const transferInboxSlackContexts = async ({ workspaceId, inboxId, targetType, targetId, userId }) => {
  const sourceLinks = await supabase
    .from('slack_context_links')
    .select('slack_context_id, relationship_type')
    .eq('workspace_id', workspaceId)
    .eq('target_type', 'intake_item')
    .eq('target_id', inboxId);
  if (sourceLinks.error) throw sourceLinks.error;
  for (const source of sourceLinks.data ?? []) {
    await linkSlackContextToTarget({
      workspaceId,
      slackContextId: source.slack_context_id,
      targetType,
      targetId,
      userId,
      relationshipType: 'conversion',
    });
  }
};

const ensureExternalTarget = async ({ workspaceId, targetType, targetId }) => {
  const table = externalTargetTables[targetType];
  if (!table || !targetId) return false;
  return ensureWorkspaceResource(table, targetId, workspaceId);
};

const getFigmaConnectionForReference = async ({ workspaceId }) => {
  const result = await supabase
    .from('integration_accounts')
    .select('id, access_token_encrypted, connection_status')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'figma')
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.connection_status !== 'connected') return null;
  const accessToken = readIntegrationToken(result.data.access_token_encrypted);
  if (!accessToken) return null;
  return { ...result.data, access_token_encrypted: accessToken };
};

const getGithubConnectionForReference = async ({ workspaceId, reference, parsed }) => {
  const installationResult = await supabase.from('github_installations').select('id, installation_id, status').eq('workspace_id', workspaceId).maybeSingle();
  if (installationResult.error) throw installationResult.error;
  if (!installationResult.data || installationResult.data.status !== 'active') return null;
  const target = parsed ?? parseGithubUrl(reference?.external_url);
  const repositoryResult = await supabase.from('github_repositories').select('id, github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', workspaceId).ilike('owner_login', target.owner).ilike('name', target.repository).maybeSingle();
  if (repositoryResult.error) throw repositoryResult.error;
  if (!repositoryResult.data) {
    const error = new GithubProviderError('repository_not_approved');
    throw error;
  }
  const token = await createInstallationToken({ installationId: installationResult.data.installation_id });
  return { id: installationResult.data.id, access_token_encrypted: token.token, approvedRepository: repositoryResult.data };
};

const getConnectionForExternalReference = async (args) => args.provider === 'github' ? getGithubConnectionForReference(args) : getFigmaConnectionForReference(args);
const requireExternalReferenceEdit = async ({ userId, workspaceId, targetType, targetId }) => {
  const access = await requireWorkspaceAccess(userId, workspaceId, 'member');
  if (!await ensureExternalTarget({ workspaceId, targetType, targetId })) {
    const error = new Error('Target object not found'); error.statusCode = 404; throw error;
  }
  return access;
};
const assertGithubReferenceApproved = async ({ workspaceId, referenceId }) => {
  const reference = await supabase.from('external_references').select('id, provider, external_type, metadata, normalized_url, external_url, access_status').eq('workspace_id', workspaceId).eq('id', referenceId).maybeSingle();
  if (reference.error) throw reference.error;
  if (!reference.data) { const error = new Error('External reference not found'); error.statusCode = 404; throw error; }
  if (reference.data.provider !== 'github') return reference.data;
  const repoId = reference.data.metadata?.githubRepositoryId;
  const parsed = parseGithubUrl(reference.data.external_url);
  const repo = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name').eq('workspace_id', workspaceId).eq('github_repository_id', String(repoId ?? '')).maybeSingle();
  if (repo.error) throw repo.error;
  if (!repo.data || repo.data.owner_login.toLowerCase() !== parsed.owner.toLowerCase() || repo.data.name.toLowerCase() !== parsed.repository.toLowerCase()) { const error = new GithubProviderError('repository_not_approved'); throw error; }
  return reference.data;
};

app.get('/api/integrations/github/repositories', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const installation = await supabase.from('github_installations').select('status').eq('workspace_id', workspaceId).maybeSingle();
    if (installation.error) throw installation.error;
    if (!installation.data || installation.data.status !== 'active') return res.json([]);
    const result = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch, last_synced_at').eq('workspace_id', workspaceId).order('full_name').limit(100);
    if (result.error) throw result.error;
    res.json(result.data ?? []);
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/integrations/github/resources', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const query = String(req.query?.query ?? '').trim().slice(0, 120);
    const type = String(req.query?.type ?? 'all').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 50);
    if (!['all', 'repository', 'issue', 'pull_request'].includes(type)) return res.status(400).json({ error: 'Unsupported GitHub resource type.' });
    const installation = await supabase.from('github_installations').select('installation_id, status').eq('workspace_id', workspaceId).maybeSingle();
    if (installation.error) throw installation.error;
    if (!installation.data || installation.data.status !== 'active') return res.json([]);

    const repositories = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name, html_url, is_private, is_archived, is_disabled, default_branch').eq('workspace_id', workspaceId).eq('is_disabled', false).order('full_name').limit(100);
    if (repositories.error) throw repositories.error;
    const repoRows = repositories.data ?? [];
    const normalizedQuery = query.toLowerCase();
    let parsedGithubUrl = null;
    if (/^https:\/\/(?:www\.)?github\.com\//i.test(query)) {
      try { parsedGithubUrl = parseGithubUrl(query); } catch { parsedGithubUrl = null; }
    }
    const parsedRepository = parsedGithubUrl ? repoRows.find((repo) => repo.owner_login.toLowerCase() === parsedGithubUrl.owner.toLowerCase() && repo.name.toLowerCase() === parsedGithubUrl.repository.toLowerCase()) : null;
    const matchesRepo = (repo) => !normalizedQuery || [repo.owner_login, repo.name, repo.full_name].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    const results = [];
    if (parsedGithubUrl && parsedRepository && (type === 'all' || (type === 'pull_request' && parsedGithubUrl.resourceKind === 'pullRequest') || (type === parsedGithubUrl.resourceKind))) {
      results.push({
        resourceType: parsedGithubUrl.resourceKind === 'pullRequest' ? 'pull_request' : parsedGithubUrl.resourceKind,
        githubRepositoryId: parsedRepository.github_repository_id,
        number: parsedGithubUrl.number ?? null,
        title: parsedGithubUrl.resourceKind === 'repository' ? parsedRepository.full_name : `${parsedGithubUrl.resourceKind === 'pullRequest' ? 'PR' : 'Issue'} #${parsedGithubUrl.number ?? ''}`,
        repositoryFullName: parsedRepository.full_name,
        canonicalUrl: parsedGithubUrl.normalizedUrl,
        state: 'available',
        isPrivate: Boolean(parsedRepository.is_private),
        isArchived: Boolean(parsedRepository.is_archived),
        defaultBranch: parsedRepository.default_branch ?? null,
      });
    }
    if (type === 'all' || type === 'repository') {
      results.push(...repoRows.filter(matchesRepo).slice(0, limit).map((repo) => ({
        resourceType: 'repository',
        id: `github-repository-${repo.github_repository_id}`,
        githubRepositoryId: repo.github_repository_id,
        title: repo.full_name,
        repositoryFullName: repo.full_name,
        canonicalUrl: repo.html_url,
        isPrivate: Boolean(repo.is_private),
        isArchived: Boolean(repo.is_archived),
        defaultBranch: repo.default_branch ?? null,
        state: repo.is_archived ? 'archived' : 'available',
      })));
    }

    const referenceRows = await supabase.from('external_references').select('id, external_type, external_url, normalized_url, metadata, access_status, updated_at').eq('workspace_id', workspaceId).eq('provider', 'github').in('external_type', type === 'repository' ? ['repository'] : type === 'issue' ? ['issue'] : type === 'pull_request' ? ['pullRequest'] : ['issue', 'pullRequest']).order('updated_at', { ascending: false }).limit(200);
    if (referenceRows.error) throw referenceRows.error;
    const approvedById = new Map(repoRows.map((repo) => [String(repo.github_repository_id), repo]));
    const mappedReferences = (referenceRows.data ?? []).filter((reference) => {
      const repo = approvedById.get(String(reference.metadata?.githubRepositoryId ?? ''));
      if (!repo || repo.is_disabled) return false;
      const values = [reference.metadata?.title, reference.metadata?.repositoryFullName, reference.metadata?.ownerLogin, reference.metadata?.number, reference.normalized_url];
      return !normalizedQuery || values.some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    }).slice(0, limit).map((reference) => ({
      resourceType: reference.external_type === 'pullRequest' ? 'pull_request' : reference.external_type,
      referenceId: reference.id,
      githubRepositoryId: reference.metadata?.githubRepositoryId ?? null,
      githubId: reference.metadata?.githubId ?? null,
      number: reference.metadata?.number ?? null,
      title: reference.metadata?.title ?? (reference.external_type === 'pullRequest' ? `PR #${reference.metadata?.number ?? ''}` : `Issue #${reference.metadata?.number ?? ''}`),
      repositoryFullName: reference.metadata?.repositoryFullName ?? null,
      canonicalUrl: reference.normalized_url ?? reference.external_url,
      state: reference.metadata?.state ?? null,
      isPrivate: Boolean(reference.metadata?.isPrivate),
      accessStatus: reference.access_status,
    }));
    results.push(...mappedReferences);

    const repositoryId = String(req.query?.repositoryId ?? '').trim();
    if (repositoryId && query.length >= 2 && ['all', 'issue', 'pull_request'].includes(type)) {
      const repository = repoRows.find((row) => String(row.github_repository_id) === repositoryId);
      if (repository && installation.data?.status === 'active') {
        const remoteTypes = type === 'all' ? ['issue', 'pull_request'] : [type];
        for (const remoteType of remoteTypes) {
          const remote = await searchGithubWork({ repository, type: remoteType, query, state: 'all', limit: Math.min(limit, 20), installationId: installation.data.installation_id });
          results.push(...remote.map((item) => ({ ...item, resourceType: item.resourceKind === 'pullRequest' ? 'pull_request' : 'issue' })));
        }
      }
    }
    const seen = new Set();
    res.json(results.filter((item) => { const key = `${item.resourceType}:${item.referenceId ?? item.canonicalUrl}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit));
  } catch (error) { return res.status(error instanceof GithubProviderError ? 502 : (error.statusCode || 500)).json({ error: error instanceof GithubProviderError ? githubSafeMessage(error) : 'Could not search approved GitHub resources.' }); }
});

app.get('/api/integrations/github/search', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const repositoryId = String(req.query?.repositoryId ?? '').trim();
    const type = String(req.query?.type ?? '').trim();
    const query = String(req.query?.query ?? '').trim();
    if (!repositoryId || !['issue', 'pull_request'].includes(type)) return res.status(400).json({ error: 'repositoryId and a valid type are required.' });
    if (query && query.length < 2) return res.status(400).json({ error: 'Search requires at least two characters.' });
    const repo = await supabase.from('github_repositories').select('github_repository_id, owner_login, name, full_name').eq('workspace_id', workspaceId).eq('github_repository_id', repositoryId).maybeSingle();
    if (repo.error) throw repo.error;
    if (!repo.data) return res.status(404).json({ error: 'Repository access changed.' });
    const installation = await supabase.from('github_installations').select('installation_id, status').eq('workspace_id', workspaceId).maybeSingle();
    if (installation.error) throw installation.error;
    if (!installation.data || installation.data.status !== 'active') return res.status(409).json({ error: 'GitHub is not connected.' });
    const results = await searchGithubWork({ repository: repo.data, type, query, state: String(req.query?.state ?? 'open'), limit: req.query?.limit, installationId: installation.data.installation_id });
    res.json(results);
  } catch (error) { return res.status(error instanceof GithubProviderError ? 502 : (error.statusCode || 500)).json({ error: error instanceof GithubProviderError ? githubSafeMessage(error) : (error.message || 'GitHub search failed.') }); }
});

app.get('/api/integrations/github/attention', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const targetType = String(req.query?.targetType ?? '').trim() || null;
    const targetId = String(req.query?.targetId ?? '').trim() || null;
    res.json(await listGithubAttention({ supabase, workspaceId, targetType, targetId }));
  } catch (error) { return respondWithError(res, error); }
});

const requireFigmaCapability = async ({ userId, workspaceId, capability, targetType = null, targetId = null }) => {
  const minimumRole = getFigmaCapabilityMinimumRole(capability);
  const access = await requireWorkspaceAccess(userId, workspaceId, minimumRole || 'viewer');
  let targetExists = true;
  if (targetType && targetId) targetExists = await ensureExternalTarget({ workspaceId, targetType, targetId });
  assertFigmaCapability({ capability, workspaceRole: access.role, targetExists, targetEditable: roleAtLeast(access.role, 'member') });
  return access;
};

app.get('/api/integrations/figma/privacy', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'view_reference' });
    res.json(await getFigmaPreviewConsent({ supabase, workspaceId }));
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/integrations/figma/privacy/accept', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'manage_connection' });
    const result = await supabase.from('figma_workspace_settings').upsert({ workspace_id: workspaceId, preview_sharing_accepted: true, preview_sharing_policy_version: '2026-07-20', preview_sharing_accepted_by: req.authUser.id, preview_sharing_accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select('workspace_id, preview_sharing_accepted, preview_sharing_policy_version, preview_sharing_accepted_by, preview_sharing_accepted_at, updated_at').single();
    if (result.error) throw result.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_privacy_disclosure_accepted', targetType: 'workspace', targetId: workspaceId, metadata: { policy_version: '2026-07-20' } });
    res.json(result.data);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/external-references/parse', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const provider = String(req.body?.provider ?? '').trim().toLowerCase();
    const url = String(req.body?.url ?? '').trim();
    res.json(parseExternalUrl({ provider, url }));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/external-references', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const provider = String(req.body?.provider ?? '').trim().toLowerCase();
    const url = String(req.body?.url ?? '').trim();
    const result = await createOrGetExternalReference({ supabase, workspaceId, provider, url, createdByUserId: req.authUser.id });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: result.reused ? 'external_reference_reused' : 'external_reference_created', targetType: 'external_reference', targetId: result.reference.id, metadata: { provider } });
    res.status(result.reused ? 200 : 201).json(result.reference);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/external-references/:id/resolve', authMiddleware, rateLimit('figma_resolve'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const reference = await resolveExternalReference({ supabase, workspaceId, referenceId: String(req.params.id), requestedByUserId: req.authUser.id, getConnection: getConnectionForExternalReference });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'external_reference_resolved', targetType: 'external_reference', targetId: reference.id, metadata: { provider: reference.provider, access_status: reference.access_status } });
    res.json(reference);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/external-references/:id/links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const targetType = String(req.body?.target_type ?? '').trim();
    const targetId = String(req.body?.target_id ?? '').trim();
    await requireExternalReferenceEdit({ userId: req.authUser.id, workspaceId, targetType, targetId });
    const referenceForLink = await assertGithubReferenceApproved({ workspaceId, referenceId: String(req.params.id) });
    const source = String(req.body?.source ?? 'manual').trim();
    let linkMetadata = req.body?.link_metadata && typeof req.body.link_metadata === 'object' ? req.body.link_metadata : null;
    if (referenceForLink.provider === 'github' && referenceForLink.external_type === 'repository') {
      linkMetadata = { role: linkMetadata?.role === 'supporting' ? 'supporting' : 'primary' };
    }
    const link = await linkExternalReference({ supabase, workspaceId, referenceId: String(req.params.id), targetType, targetId, source, linkMetadata, createdByUserId: req.authUser.id, ensureTarget: ensureExternalTarget });
    if (linkMetadata?.role === 'primary') {
      const primary = await supabase.rpc('set_primary_external_reference_link', { p_workspace_id: workspaceId, p_link_id: link.id });
      if (primary.error) throw primary.error;
    }
    const referenceProvider = await supabase.from('external_references').select('provider').eq('workspace_id', workspaceId).eq('id', String(req.params.id)).maybeSingle();
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: referenceProvider.data?.provider === 'figma' ? 'figma_design_linked' : 'external_reference_linked', targetType, targetId, metadata: { source } });
    res.status(201).json(link);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/external-references/:id/links/:linkId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const linkLookup = await supabase.from('external_reference_links').select('target_type, target_id').eq('workspace_id', workspaceId).eq('external_reference_id', String(req.params.id)).eq('id', String(req.params.linkId)).maybeSingle();
    if (linkLookup.error) throw linkLookup.error;
    if (!linkLookup.data || !(await ensureExternalTarget({ workspaceId, targetType: linkLookup.data.target_type, targetId: linkLookup.data.target_id }))) return res.status(404).json({ error: 'External reference link not found' });
    await requireExternalReferenceEdit({ userId: req.authUser.id, workspaceId, targetType: linkLookup.data.target_type, targetId: linkLookup.data.target_id });
    const source = String(req.query?.source ?? '').trim() || null;
    const result = await unlinkExternalReference({ supabase, workspaceId, referenceId: String(req.params.id), linkId: String(req.params.linkId), source });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'external_reference_unlinked', targetType: linkLookup.data.target_type, targetId: linkLookup.data.target_id, metadata: { source: source || 'all' } });
    res.json(result);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/external-references', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const targetType = String(req.query?.targetType ?? '').trim();
    const targetId = String(req.query?.targetId ?? '').trim();
    if (!targetType || !targetId || !(await ensureExternalTarget({ workspaceId, targetType, targetId }))) return res.status(404).json({ error: 'Target object not found' });
    res.json(await getExternalReferencesForTarget({ supabase, workspaceId, targetType, targetId }));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/external-references/search', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    res.json(await searchExternalReferences({ supabase, workspaceId, provider: req.query?.provider, query: req.query?.query ?? '', limit: req.query?.limit }));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/external-references/:id/linked-targets', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    const linksResult = await supabase.from('external_reference_links').select('id, target_type, target_id, sources, created_at').eq('workspace_id', workspaceId).eq('external_reference_id', String(req.params.id));
    if (linksResult.error) throw linksResult.error;
    const visible = [];
    for (const link of linksResult.data ?? []) {
      if (!(await ensureExternalTarget({ workspaceId, targetType: link.target_type, targetId: link.target_id }))) continue;
      const table = externalTargetTables[link.target_type];
      const titleColumn = table === 'projects' ? 'name' : 'title';
      const targetResult = await supabase.from(table).select(`id, ${titleColumn}`).eq('workspace_id', workspaceId).eq('id', link.target_id).maybeSingle();
      if (!targetResult.error && targetResult.data) visible.push({ ...link, title: targetResult.data[titleColumn] ?? 'Untitled' });
    }
    res.json(visible);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/external-references/:id/preview', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'view_saved_preview', targetType: String(req.query?.targetType ?? '').trim(), targetId: String(req.query?.targetId ?? '').trim() });
    const targetType = String(req.query?.targetType ?? '').trim();
    const targetId = String(req.query?.targetId ?? '').trim();
    if (!targetType || !targetId || !(await ensureExternalTarget({ workspaceId, targetType, targetId }))) return res.status(404).json({ error: 'Target object not found' });
    const referenceAllowed = await supabase.from('external_references').select('id').eq('workspace_id', workspaceId).eq('id', String(req.params.id)).maybeSingle();
    if (referenceAllowed.error) throw referenceAllowed.error;
    if (!referenceAllowed.data) return res.status(404).json({ error: 'External reference not found' });
    let preview = await getExternalReferencePreview({ supabase, workspaceId, referenceId: String(req.params.id) });
    // A newly linked reference may not have a snapshot yet. Let an editor
    // recover it through the existing server-side capture service; viewers
    // still receive only already-saved previews.
    if (!preview?.url) {
      try {
        await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'refresh_preview', targetType, targetId });
        const captured = await generateExternalReferencePreview({
          supabase,
          workspaceId,
          referenceId: String(req.params.id),
          createdByUserId: req.authUser.id,
          getConnection: getFigmaConnectionForReference,
        });
        preview = captured.preview ?? preview;
      } catch { /* Preview capture remains best-effort and never blocks the target. */ }
    }
    res.json({ preview });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/external-references/:id/change-state', authMiddleware, rateLimit('figma_change_check'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const targetType = String(req.query?.targetType ?? '').trim();
    const targetId = String(req.query?.targetId ?? '').trim();
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'view_saved_preview', targetType, targetId });
    if (!targetType || !targetId || !(await ensureExternalTarget({ workspaceId, targetType, targetId }))) return res.status(404).json({ error: 'Target object not found' });
    const referenceId = String(req.params.id);
    const allowed = await supabase.from('external_references').select('id').eq('workspace_id', workspaceId).eq('id', referenceId).maybeSingle();
    if (allowed.error) throw allowed.error;
    if (!allowed.data) return res.status(404).json({ error: 'External reference not found' });
    const state = await checkExternalReferenceChange({ supabase, workspaceId, referenceId, requestedByUserId: req.authUser.id, getConnection: getFigmaConnectionForReference });
    res.json({ change_state: state });
  } catch (error) { return respondWithError(res, error); }
});

app.delete('/api/external-references/:id/preview', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const targetType = String(req.body?.target_type ?? '').trim();
    const targetId = String(req.body?.target_id ?? '').trim();
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'delete_saved_preview', targetType, targetId });
    const previews = await supabase.from('external_reference_previews').select('id, storage_key').eq('workspace_id', workspaceId).eq('external_reference_id', String(req.params.id)).eq('status', 'ready');
    if (previews.error) throw previews.error;
    const keys = (previews.data ?? []).map((row) => row.storage_key).filter(Boolean);
    if (keys.length) await supabase.storage.from('note-images').remove(keys);
    if (previews.data?.length) {
      const deleted = await supabase.from('external_reference_previews').delete().eq('workspace_id', workspaceId).in('id', previews.data.map((row) => row.id));
      if (deleted.error) throw deleted.error;
    }
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'figma_saved_preview_deleted', targetType, targetId, metadata: { preview_count: previews.data?.length ?? 0 } });
    res.json({ removed: previews.data?.length ?? 0 });
  } catch (error) { return respondWithError(res, error); }
});

const generateExternalReferencePreviewForTarget = async (req, res, force) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const targetType = String(req.body?.target_type ?? '').trim();
    const targetId = String(req.body?.target_id ?? '').trim();
    await requireFigmaCapability({ userId: req.authUser.id, workspaceId, capability: 'refresh_preview', targetType, targetId });
    if (!targetType || !targetId) return res.status(400).json({ error: 'target_type and target_id are required' });
    if (!(await ensureExternalTarget({ workspaceId, targetType, targetId }))) return res.status(404).json({ error: 'Target object not found' });
    if (force) await checkExternalReferenceChange({ supabase, workspaceId, referenceId: String(req.params.id), requestedByUserId: req.authUser.id, getConnection: getFigmaConnectionForReference });
    const result = await generateExternalReferencePreview({
      supabase,
      workspaceId,
      referenceId: String(req.params.id),
      createdByUserId: req.authUser.id,
      force,
      getConnection: getFigmaConnectionForReference,
    });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: force ? 'figma_preview_refreshed' : 'figma_preview_captured', targetType: 'external_reference', targetId: String(req.params.id), metadata: { access_status: result.accessStatus, consent_required: Boolean(result.consentRequired) } });
    res.json(result);
  } catch (error) {
    return respondWithError(res, error);
  }
};

app.post('/api/external-references/:id/preview', authMiddleware, rateLimit('figma_preview'), (req, res) => generateExternalReferencePreviewForTarget(req, res, false));
app.post('/api/external-references/:id/preview/refresh', authMiddleware, rateLimit('figma_preview'), (req, res) => generateExternalReferencePreviewForTarget(req, res, true));

app.post('/api/integrations/slack/events', rateLimit('write'), async (req, res) => {
  if (!verifySlackRequest(req)) {
    console.warn('[slack] event signature verification failed', {
      timestamp: req.headers['x-slack-request-timestamp'] ?? null,
    });
    return res.status(401).send('Invalid Slack signature');
  }

  const payload = typeof req.body === 'string' ? safeJson(req.body, null) : req.body;
  if (!payload) return res.status(400).send('Invalid Slack event payload');
  if (payload.type === 'url_verification') return res.status(200).json({ challenge: payload.challenge });
  if (payload.type !== 'event_callback') return res.status(200).json({ ok: true });

  // Slack only needs the acknowledgement here. Durable insertion and matching
  // happen after the response so event processing never extends Slack's timeout.
  res.status(200).json({ ok: true });
  void enqueueSlackEventDelivery(payload, req.headers['x-slack-retry-num'] ?? 0).catch((error) => {
    console.error('[slack] event enqueue failed', { message: error?.message ?? 'unknown_error' });
  });
});

app.post('/api/integrations/slack/interactivity', rateLimit('write'), async (req, res) => {
  if (!verifySlackRequest(req)) {
    console.warn('[slack] signature verification failed', {
      timestamp: req.headers['x-slack-request-timestamp'] ?? null,
    });
    return res.status(401).send('Invalid Slack signature');
  }

  const payload = safeJson(req.body?.payload, null);
  if (!payload) return res.status(400).send('Missing Slack payload');

  if (payload.callback_id !== 'save_to_ledger') {
    return res.status(200).json({ response_type: 'ephemeral', text: 'Unsupported Ledger action.' });
  }

  const responseUrl = payload.response_url;
  const startedAt = Date.now();
  const retryNumber = req.headers['x-slack-retry-num'] ?? null;
  if (retryNumber) {
    console.info('[slack] retry received', {
      retryNumber,
      retryReason: req.headers['x-slack-retry-reason'] ?? null,
    });
  }

  // Slack requires the acknowledgement within a few seconds. Database work
  // and the eventual ephemeral result happen after this response is sent.
  res.status(200).json({
    response_type: 'ephemeral',
    text: 'Sending to Ledger Intake…',
  });

  void (async () => {
    try {
      const result = await saveSlackMessageCapture(payload);
      if (!result?.ok) {
        const message =
          result.reason === 'missing_workspace'
            ? 'This Slack workspace is no longer connected to Ledger.'
            : result.reason === 'missing_team'
            ? 'This Slack workspace is no longer connected to Ledger.'
            : 'Ledger could not send this message to Intake. Please try again.';
        await postSlackCaptureResponse(responseUrl, { text: message });
        return;
      }

      await postSlackCaptureResponse(
        responseUrl,
        result.inboxId ? buildSlackOpenIntakeResponse(result.inboxId) : { text: 'Sent to Ledger Intake' }
      );
    } catch (error) {
      console.error('[slack] capture processing failed', {
        message: error?.message ?? 'unknown_error',
        durationMs: Date.now() - startedAt,
      });
      await postSlackCaptureResponse(responseUrl, {
        text: 'Ledger could not send this message to Intake. Please try again.',
      });
    } finally {
      console.info('[slack] capture request processed', {
        durationMs: Date.now() - startedAt,
        retryNumber,
      });
    }
  })();
});

app.get('/api/inbox/count', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await resumeDueInboxItemsForWorkspace(workspaceId);
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
    await resumeDueInboxItemsForWorkspace(workspaceId);
    const status = String(req.query?.status ?? 'unprocessed').trim() || 'unprocessed';
    const source = String(req.query?.source ?? '').trim();

    let query = supabase
      .from('inbox_items')
      .select(inboxItemSelectColumns)
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

app.post('/api/inbox/:id/github-project', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const inbox = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!inbox) return res.status(404).json({ error: 'Intake item not found' });
    const projectId = String(req.body?.project_id ?? '').trim();
    if (!projectId || !(await ensureWorkspaceResource('projects', projectId, workspaceId))) return res.status(404).json({ error: 'Project not found' });
    const links = await supabase.from('external_reference_links').select('external_reference_id').eq('workspace_id', workspaceId).eq('target_type', 'intake').eq('target_id', inbox.id);
    if (links.error) throw links.error;
    const referenceIds = (links.data ?? []).map((link) => link.external_reference_id).filter(Boolean);
    if (!referenceIds.length) return res.status(400).json({ error: 'This Intake item has no linked GitHub reference.' });
    const references = await supabase.from('external_references').select('id, provider, metadata, external_type').eq('workspace_id', workspaceId).in('id', referenceIds).eq('provider', 'github');
    if (references.error) throw references.error;
    const linkedProjects = [];
    for (const reference of references.data ?? []) {
      const existing = await supabase.from('external_reference_links').select('id').eq('workspace_id', workspaceId).eq('external_reference_id', reference.id).eq('target_type', 'project').eq('target_id', projectId).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) { linkedProjects.push(existing.data.id); continue; }
      const inserted = await supabase.from('external_reference_links').insert({ workspace_id: workspaceId, external_reference_id: reference.id, target_type: 'project', target_id: projectId, created_by_user_id: req.authUser.id, sources: ['manual'], link_metadata: {} }).select('id').single();
      if (inserted.error) throw inserted.error;
      linkedProjects.push(inserted.data.id);
    }
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_intake_attached_to_project', targetType: 'project', targetId: projectId, metadata: { inbox_id: inbox.id, external_reference_count: references.data?.length ?? 0 } });
    res.json({ attached: true, project_id: projectId, link_ids: linkedProjects });
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/inbox/:id/archive', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!allowed) {
      return res.status(404).json({ error: 'Intake item not found' });
    }

    const { data, error } = await supabase
      .from('inbox_items')
      .update({
        status: 'archived',
        snoozed_until: null,
        archived_at: new Date().toISOString(),
        archived_by: req.authUser.id,
        updated_by: req.authUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .select(inboxItemSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapInboxItemResponse(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/inbox/:id/restore', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const inboxItem = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!inboxItem) {
      return res.status(404).json({ error: 'Intake item not found' });
    }
    if (String(inboxItem.status ?? '') === 'converted') {
      return res.status(409).json({ error: 'Item has already been converted' });
    }
    if (String(inboxItem.status ?? '') !== 'archived') {
      return res.status(409).json({ error: 'Only archived intake items can be restored' });
    }

    const { data, error } = await supabase
      .from('inbox_items')
      .update({
        status: 'unprocessed',
        snoozed_until: null,
        archived_at: null,
        archived_by: null,
        updated_by: req.authUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .select(inboxItemSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapInboxItemResponse(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/inbox/:id/snooze', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const allowed = await loadInboxItemForWorkspace(workspaceId, req.params.id);
    if (!allowed) {
      return res.status(404).json({ error: 'Intake item not found' });
    }

    const snoozedUntilInput = String(req.body?.snoozed_until ?? '').trim();
    if (!snoozedUntilInput) {
      return res.status(400).json({ error: 'snoozed_until is required' });
    }

    const snoozedUntil = new Date(snoozedUntilInput);
    if (Number.isNaN(snoozedUntil.getTime())) {
      return res.status(400).json({ error: 'Invalid snoozed_until' });
    }

    const { data, error } = await supabase
      .from('inbox_items')
      .update({
        status: 'snoozed',
        snoozed_until: snoozedUntil.toISOString(),
        updated_by: req.authUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id)
      .select(inboxItemSelectColumns)
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
      return res.status(404).json({ error: 'Intake item not found' });
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
      return res.status(404).json({ error: 'Intake item not found' });
    }
    if (String(inboxItem.status ?? '') === 'converted' || (inboxItem.converted_type && inboxItem.converted_id)) {
      return res.status(409).json({ error: 'Item has already been converted' });
    }

    const type = String(req.body?.type ?? '').trim().toLowerCase();
    const title = String(req.body?.title ?? inboxItem.title ?? '').trim();
    const body = normalizeNullableText(req.body?.body ?? inboxItem.body);
    const rawTitle = title || inboxItem.title || 'Untitled';
    const inboxNotes = inboxItem.source_url
      ? `${body ? `${body}\n\n` : ''}Source: ${inboxItem.source_url}`
      : body;
    const assignedToUserId = normalizeNullableText(req.body?.assigned_to_user_id ?? req.body?.assigned_to);
    const assignedToTeamId = normalizeNullableText(req.body?.assigned_to_team_id ?? req.body?.assigned_team_id);
    const convertedAt = new Date().toISOString();
    const convertedBy = req.authUser.id;
    let createdId = null;

    if (assignedToUserId) {
      const targetAllowed = await ensureWorkspaceMemberTarget(workspaceId, assignedToUserId);
      if (!targetAllowed) {
        return res.status(404).json({ error: 'Assigned user not found' });
      }
    }
    if (assignedToTeamId) {
      const teamAllowed = await ensureWorkspaceTeam(assignedToTeamId, workspaceId);
      if (!teamAllowed) {
        return res.status(404).json({ error: 'Team not found' });
      }
    }

    if (type === 'capture') {
      const { data, error } = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'capture',
          converted_id: null,
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (error) throw error;
      return res.json({ inbox_item: mapInboxItemResponse(data), created: null });
    }

    if (type === 'task') {
      const showInToday = Boolean(req.body?.show_in_today ?? false);
      const isTodayFocus = Boolean(req.body?.is_today_focus ?? false);
      const requestedTaskHorizon = req.body?.task_horizon;
      const taskHorizon = String(
        requestedTaskHorizon ?? (showInToday || isTodayFocus ? 'today' : 'long_term')
      )
        .trim()
        .toLowerCase();
      const projectId = req.body?.project_id ? String(req.body.project_id) : null;

      if (projectId) {
        const projectAllowed = await ensureWorkspaceResource(
          'projects',
          projectId,
          workspaceId
        );
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }

      let createdTask = null;
      const insertAttempts = [
        { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: true },
        { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: false },
        { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: true },
        { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: false },
        { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: true },
        { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: false },
        { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: true },
        { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: false },
      ];

      for (const attempt of insertAttempts) {
        const taskPayload = {
          workspace_id: workspaceId,
          project_id: projectId,
          title: rawTitle,
          description: inboxNotes ? `inbox:${inboxItem.id}` : `inbox:${inboxItem.id}`,
          notes: inboxNotes || null,
          due_date: req.body?.due_date ? normalizeNullableDate(req.body.due_date, 'due date') : null,
          due_time: req.body?.due_time ? normalizeNullableText(req.body.due_time) : null,
          status: req.body?.status ? String(req.body.status) : 'todo',
          priority: req.body?.priority ? String(req.body.priority) : 'medium',
          assigned_to_user_id: assignedToUserId,
          assigned_to_team_id: assignedToTeamId,
          assigned_team_id: assignedToTeamId,
          assigned_by_user_id: assignedToUserId || assignedToTeamId ? req.authUser.id : null,
          assigned_at: assignedToUserId || assignedToTeamId ? new Date().toISOString() : null,
          tags: Array.isArray(req.body?.tags)
            ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean)
            : [],
          ...(attempt.includeShowInToday ? { show_in_today: showInToday } : {}),
          ...(attempt.includeIsTodayFocus ? { is_today_focus: isTodayFocus } : {}),
          ...(attempt.includeTaskHorizon ? { task_horizon: taskHorizon === 'today' ? 'today' : 'long_term' } : {}),
        };

        const { data, error } = await supabase
          .from('tasks')
          .insert(taskPayload)
          .select(buildTaskSelectColumns(attempt))
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
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      await transferInboxExternalReferences({ workspaceId, inboxId: inboxItem.id, targetType: 'task', targetId: createdId, userId: req.authUser.id });
      await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'task', targetId: createdId, userId: req.authUser.id });
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: createdTask,
      });
    }

    if (type === 'note') {
      const noteDate = req.body?.date
        ? normalizeNullableDate(req.body.date, 'date')
        : new Date().toISOString().slice(0, 10);
      const requestedSectionId = normalizeNullableText(req.body?.section_id);
      let sectionId = null;
      if (requestedSectionId) {
        const sectionAllowed = await ensureWorkspaceResource('note_sections', requestedSectionId, workspaceId);
        if (!sectionAllowed) {
          return res.status(404).json({ error: 'Section not found' });
        }
        sectionId = requestedSectionId;
      }
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
          section_id: sectionId,
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
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      await transferInboxExternalReferences({ workspaceId, inboxId: inboxItem.id, targetType: 'note', targetId: createdId, userId: req.authUser.id });
      await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'note', targetId: createdId, userId: req.authUser.id });
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
      const requestedCalendarId = normalizeNullableText(req.body?.calendar_id);
      let calendarId = null;
      let calendarColor = null;
      if (requestedCalendarId) {
        const calendarAllowed = await ensureWorkspaceResource('calendars', requestedCalendarId, workspaceId);
        if (!calendarAllowed) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
        const calendar = await getCalendarById(requestedCalendarId);
        calendarId = calendar.id;
        calendarColor = calendar.color ?? null;
      } else {
        const personalCalendar = await getPersonalCalendar(workspaceId, req.authUser.id);
        calendarId = personalCalendar.id;
        calendarColor = personalCalendar.color ?? null;
      }
      const reminderPayload = {
        workspace_id: workspaceId,
        calendar_id: calendarId,
        user_id: req.authUser.id,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title: rawTitle,
        remind_at: reminderAt,
        color: req.body?.color || calendarColor || '#F59E0B',
        is_done: false,
        notes: inboxNotes || null,
        project_id: req.body?.project_id || null,
        note_id: req.body?.note_id || null,
        assigned_to_user_id: assignedToUserId,
        assigned_to_team_id: assignedToTeamId,
        assigned_by_user_id: assignedToUserId || assignedToTeamId ? req.authUser.id : null,
        assigned_at: assignedToUserId || assignedToTeamId ? new Date().toISOString() : null,
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
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'reminder', targetId: createdId, userId: req.authUser.id });
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
      const endAt = normalizeEventEndAt(startAt, String(req.body?.end_at ?? '').trim() || null);
      const requestedCalendarId = normalizeNullableText(req.body?.calendar_id);
      const calendarId = requestedCalendarId || (await getCalendarId(workspaceId, req.authUser.id));
      if (requestedCalendarId) {
        const calendarAllowed = await ensureWorkspaceResource('calendars', requestedCalendarId, workspaceId);
        if (!calendarAllowed) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
      }
      const calendarColorInput = normalizeNullableText(req.body?.color);
      const calendarColorResult = calendarColorInput
        ? { data: { color: calendarColorInput }, error: null }
        : await supabase.from('calendars').select('color').eq('id', calendarId).maybeSingle();
      const calendarColor = calendarColorResult.data?.color || '#93C5FD';
      const normalizedEndAt = normalizeEventEndAt(startAt, endAt);
      const { data, error } = await supabase
        .from('events')
        .insert({
          workspace_id: workspaceId,
          calendar_id: calendarId,
          created_by: req.authUser.id,
          updated_by: req.authUser.id,
          title: rawTitle,
          start_at: startAt,
          end_at: normalizedEndAt,
          color: calendarColor,
          status: req.body?.status || 'planned',
          recurrence_rule: req.body?.recurrence_rule || null,
          notes: inboxNotes || null,
          location: req.body?.location || null,
          all_day: Boolean(req.body?.all_day ?? false),
          project_id: req.body?.project_id || null,
          linked_project_id: req.body?.project_id || null,
          note_id: req.body?.note_id || null,
          assigned_to_user_id: assignedToUserId,
          assigned_to_team_id: assignedToTeamId,
          assigned_by_user_id: assignedToUserId || assignedToTeamId ? req.authUser.id : null,
          assigned_at: assignedToUserId || assignedToTeamId ? new Date().toISOString() : null,
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
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'event', targetId: createdId, userId: req.authUser.id });
      return res.json({
        inbox_item: mapInboxItemResponse(inboxUpdate.data),
        created: data,
      });
    }

    if (type === 'project') {
      const description = normalizeNullableText(req.body?.description ?? body);
      const startDate = req.body?.start_date
        ? normalizeNullableDate(req.body.start_date, 'start date')
        : null;
      const endDate = req.body?.end_date
        ? normalizeNullableDate(req.body.end_date, 'end date')
        : null;
      const color = normalizeNullableText(req.body?.color) || '#007AFF';
      const projectType = normalizeProjectType(req.body?.project_type);
      const leadId = normalizeNullableText(req.body?.lead_id);
      const ownerTeamId = normalizeNullableText(req.body?.owner_team_id);
      if (leadId) {
        const leadAllowed = await ensureWorkspaceMemberTarget(workspaceId, leadId);
        if (!leadAllowed) {
          return res.status(404).json({ error: 'Lead not found' });
        }
      }
      if (ownerTeamId) {
        const teamAllowed = await ensureWorkspaceTeam(ownerTeamId, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      const status = req.body?.status
        ? projectStatusAliases[normalizeProjectSemanticStatus(req.body.status)][0]
        : 'NotStarted';

      const { data: existingProject, error: existingError } = await supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', workspaceId)
        .ilike('name', rawTitle)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existingProject) {
        const inboxUpdate = await supabase
          .from('inbox_items')
          .update({
            status: 'converted',
            converted_type: 'project',
            converted_id: existingProject.id,
            converted_at: convertedAt,
            converted_by: convertedBy,
            snoozed_until: null,
            archived_at: null,
            archived_by: null,
            updated_by: convertedBy,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId)
          .eq('id', inboxItem.id)
          .select(inboxItemSelectColumns)
          .single();
        if (inboxUpdate.error) throw inboxUpdate.error;
        if (githubRepositoryId) await linkGithubRepositoryToProject({ workspaceId, projectId: existingProject.id, repositoryId: githubRepositoryId, role: 'primary', userId: req.authUser.id });
        await transferInboxExternalReferences({ workspaceId, inboxId: inboxItem.id, targetType: 'project', targetId: existingProject.id, userId: req.authUser.id });
        await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'project', targetId: existingProject.id, userId: req.authUser.id });
        return res.json({
          inbox_item: mapInboxItemResponse(inboxUpdate.data),
          created: existingProject,
        });
      }

      const { data, error } = await supabase
        .from('projects')
        .insert({
          workspace_id: workspaceId,
          created_by: req.authUser.id,
          name: rawTitle,
          description,
          status,
          completeness: 0,
          color,
          start_date: startDate,
          end_date: endDate,
          project_type: projectType,
          lead_id: leadId,
          owner_team_id: ownerTeamId,
        })
        .select(projectSelectColumns)
        .single();

      if (error) throw error;
      createdId = data.id;
      const inboxUpdate = await supabase
        .from('inbox_items')
        .update({
          status: 'converted',
          converted_type: 'project',
          converted_id: createdId,
          converted_at: convertedAt,
          converted_by: convertedBy,
          snoozed_until: null,
          archived_at: null,
          archived_by: null,
          updated_by: convertedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', inboxItem.id)
        .select(inboxItemSelectColumns)
        .single();
      if (inboxUpdate.error) throw inboxUpdate.error;
      if (githubRepositoryId) await linkGithubRepositoryToProject({ workspaceId, projectId: createdId, repositoryId: githubRepositoryId, role: 'primary', userId: req.authUser.id });
      await transferInboxExternalReferences({ workspaceId, inboxId: inboxItem.id, targetType: 'project', targetId: createdId, userId: req.authUser.id });
      await transferInboxSlackContexts({ workspaceId, inboxId: inboxItem.id, targetType: 'project', targetId: createdId, userId: req.authUser.id });
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
    const choice = ['enabled', 'denied', 'skipped'].includes(String(req.body?.choice))
      ? String(req.body.choice)
      : null;
    const preferencesUpdate =
      choice !== null
        ? {
            mobileNotificationOnboardingCompleted: true,
            mobileNotificationOnboardingChoice: choice,
          }
        : null;
    const existingPreferencesResult = preferencesUpdate
      ? await supabase.from('users').select('preferences').eq('id', req.authUser.id).maybeSingle()
      : { data: null, error: null };

    if (existingPreferencesResult.error) throw existingPreferencesResult.error;
    const existingPreferences = normalizeUserPreferences(safeJson(existingPreferencesResult.data?.preferences, {}));

    let { data, error } = await supabase
      .from('users')
      .update({
        onboarding_completed: true,
        onboarding_completed_at: nowIso,
        ...(preferencesUpdate
          ? {
              preferences: normalizeUserPreferences({
                ...existingPreferences,
                ...preferencesUpdate,
              }),
            }
          : {}),
      })
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
          ...(preferencesUpdate
            ? {
                preferences: normalizeUserPreferences(preferencesUpdate),
              }
            : {}),
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

app.delete('/api/account', authMiddleware, rateLimit('write'), async (req, res) => {
  const userId = req.authUser.id;

  if (req.body?.confirmed !== true) {
    return res.status(400).json({ error: 'Account deletion requires explicit confirmation.' });
  }

  try {
    const ownedWorkspacesResult = await supabase
      .from('workspaces')
      .select('id, is_personal')
      .eq('owner_id', userId);

    if (ownedWorkspacesResult.error) throw ownedWorkspacesResult.error;

    for (const workspace of ownedWorkspacesResult.data ?? []) {
      if (workspace.is_personal) {
        const deletePersonalWorkspace = await supabase
          .from('workspaces')
          .delete()
          .eq('id', workspace.id);
        if (deletePersonalWorkspace.error) throw deletePersonalWorkspace.error;
        continue;
      }

      const membersResult = await supabase
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', workspace.id)
        .neq('user_id', userId)
        .order('role', { ascending: true });

      if (membersResult.error) throw membersResult.error;

      const memberRows = membersResult.data ?? [];
      const memberIds = memberRows.map((member) => member.user_id).filter(Boolean);
      const existingUsersResult = memberIds.length
        ? await supabase.from('users').select('id').in('id', memberIds)
        : { data: [], error: null };
      if (existingUsersResult.error) throw existingUsersResult.error;
      const existingUserIds = new Set(
        (existingUsersResult.data ?? []).map((member) => String(member.id))
      );

      const successor = memberRows
        .filter((member) => existingUserIds.has(String(member.user_id)))
        .sort((a, b) => {
        const rank = { admin: 0, member: 1, viewer: 2 };
        return (rank[a.role] ?? 3) - (rank[b.role] ?? 3);
        })[0];

      const transferWorkspace = await supabase
        .from('workspaces')
        .update({ owner_id: successor?.user_id ?? null })
        .eq('id', workspace.id);
      if (transferWorkspace.error) throw transferWorkspace.error;

      if (successor && successor.role !== 'admin') {
        const promoteSuccessor = await supabase
          .from('workspace_members')
          .update({ role: 'admin' })
          .eq('workspace_id', workspace.id)
          .eq('user_id', successor.user_id);
        if (promoteSuccessor.error) throw promoteSuccessor.error;
      }
    }

    // Final defensive detach: no workspace may still reference the account
    // when Supabase removes public.users through auth.admin.deleteUser().
    const clearRemainingOwnership = await supabase
      .from('workspaces')
      .update({ owner_id: null })
      .eq('owner_id', userId);
    if (clearRemainingOwnership.error) throw clearRemainingOwnership.error;

    const removeMemberships = await supabase
      .from('workspace_members')
      .delete()
      .eq('user_id', userId);
    if (removeMemberships.error) throw removeMemberships.error;

    const deleteUser = await supabase.auth.admin.deleteUser(userId);
    if (deleteUser.error) {
      // The admin operation can complete before a downstream FK response is
      // surfaced. Treat an already-absent auth user as an idempotent success.
      const remainingUser = await supabase.auth.admin.getUserById(userId);
      if (remainingUser.data?.user) throw deleteUser.error;
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Account deletion failed:', error);
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
    const activeWorkspaceIdInput = req.body?.active_workspace_id;
    const onboardingCompletedInput = req.body?.onboarding_completed;

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

    if (activeWorkspaceIdInput !== undefined) {
      const normalizedWorkspaceId = normalizeNullableText(activeWorkspaceIdInput);
      if (normalizedWorkspaceId !== null) {
        await requireWorkspaceAccess(req.authUser.id, normalizedWorkspaceId);
      }
      updatePayload.active_workspace_id = normalizedWorkspaceId;
    }

    if (preferencesInput !== undefined) {
      const existing = await supabase
        .from('users')
        .select('preferences')
        .eq('id', req.authUser.id)
        .maybeSingle();

      if (existing.error) throw existing.error;

      const existingPreferences = normalizeUserPreferences(safeJson(existing.data?.preferences, {}));
      const incomingPreferences = safeJson(preferencesInput, {});
      updatePayload.preferences = normalizeUserPreferences({
        ...existingPreferences,
        ...incomingPreferences,
      });
    }

    if (onboardingCompletedInput !== undefined) {
      updatePayload.onboarding_completed = Boolean(onboardingCompletedInput);
      if (Boolean(onboardingCompletedInput)) {
        updatePayload.onboarding_completed_at = new Date().toISOString();
      }
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

app.post('/api/mobile/push-tokens', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const pushToken = normalizeMobilePushToken(
      req.body?.pushToken ?? req.body?.expoPushToken ?? req.body?.token
    );
    if (!pushToken) {
      return res.status(400).json({ error: 'Missing push token' });
    }

    const payload = mobilePushTokenInsertPayload(req.authUser.id, {
      pushToken,
      platform: req.body?.platform,
    });

    const { data, error } = await supabase
      .from('mobile_push_tokens')
      .upsert(payload, { onConflict: 'push_token' })
      .select(mobilePushTokenSelectColumns)
      .single();

    if (error) throw error;
    res.json(mapMobilePushTokenRow(data));
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/mobile/push-tokens', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const pushToken = normalizeMobilePushToken(
      req.body?.pushToken ?? req.body?.expoPushToken ?? req.body?.token
    );
    const nowIso = new Date().toISOString();
    let query = supabase
      .from('mobile_push_tokens')
      .update({
        enabled: false,
        revoked_at: nowIso,
        updated_at: nowIso,
      })
      .eq('user_id', req.authUser.id)
      .is('revoked_at', null);

    if (pushToken) {
      query = query.eq('push_token', pushToken);
    }

    const { data, error } = await query.select(mobilePushTokenSelectColumns);

    if (error) throw error;
    res.json({ ok: true, revoked: Array.isArray(data) ? data.length : data ? 1 : 0 });
  } catch (error) {
    return respondWithError(res, error);
  }
});

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
        metadata: buildStoredNotificationMetadata(candidate),
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
          context: candidate?.context ?? null,
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

app.post('/api/notifications/read-all', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = normalizeNullableText(req.headers['x-workspace-id']);
    let workspace = null;
    if (workspaceId && workspaceId !== 'all') {
      const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
      workspace = access.workspace;
    }

    let query = supabase
      .from('notification_events')
      .select('id, action_taken')
      .eq('user_id', req.authUser.id)
      .not('delivered_in_app_at', 'is', null)
      .is('dismissed_at', null);
    if (workspace) query = query.eq('workspace_id', workspace.id);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const ids = (Array.isArray(rows) ? rows : [])
      .filter((row) => !['dismiss', 'snooze', 'complete', 'open'].includes(String(row.action_taken ?? '').trim().toLowerCase()))
      .map((row) => row.id)
      .filter(Boolean);

    if (ids.length > 0) {
      const { error: updateError } = await supabase
        .from('notification_events')
        .update({ action_taken: 'open', updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', req.authUser.id);
      if (updateError) throw updateError;
    }

    res.json({ ok: true, count: ids.length });
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
      const snoozeUntil =
        action === 'snooze'
          ? parseReminderTimestamp(
              req.body?.snooze_until ??
                new Date(Date.now() + prefs.defaultSnoozeMinutes * 60 * 1000).toISOString(),
              'snooze_until'
            )
          : null;

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
    const workspaceId = normalizeNullableText(req.query?.workspace_id);
    const data = await getNotificationCenterItems(req.authUser.id, workspaceId);
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

const LEDGER_TEMPLATE_PRESETS = [
  ['Meeting Notes', 'Decisions, owners, deadlines, and follow-ups.', 'meeting', '<h1>Meeting Notes</h1><p><strong>Date:</strong><br><strong>Attendees:</strong></p><h2>Agenda</h2><h2>Discussion</h2><h2>Decisions</h2><h2>Short-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Deadline:</li></ul><h2>Long-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Target:</li></ul><h2>Follow-ups</h2><h2>Next meeting</h2>'],
  ['Project Brief', 'Goals, scope, risks, and next actions.', 'project', '<h1>Project Brief</h1><p><strong>Project name:</strong><br><strong>Owner:</strong><br><strong>Team:</strong></p><h2>Problem or opportunity</h2><h2>Objective</h2><h2>Success criteria</h2><h2>Scope</h2><h2>Out of scope</h2><h2>Deliverables</h2><h2>Timeline</h2><h2>Short-term next actions</h2><h2>Long-term work</h2><h2>Risks</h2><h2>Blockers</h2><h2>Stakeholders</h2><h2>Linked resources</h2>'],
  ['Daily Reflection', 'What moved, what blocked, and what needs attention tomorrow.', 'personal', '<h1>Daily Reflection</h1><h2>Finished</h2><h2>Blocked</h2><h2>What moved forward</h2><h2>What I learned</h2><h2>Communication or follow-ups</h2><h2>First task tomorrow</h2><h2>Notes</h2>'],
  ['Book Notes', 'Summary, takeaways, and how to apply the ideas.', 'reading', '<h1>Book Notes</h1><p><strong>Title:</strong><br><strong>Author:</strong><br><strong>Date read:</strong></p><h2>Summary</h2><h2>Key takeaways</h2><h2>Memorable quotes</h2><h2>How I will apply this</h2>'],
  ['Weekly Internship Workspace', 'A reusable weekly home base for internship work and follow-through.', 'internship', '<h1>Week of</h1><h2>Goals for the week</h2><h2>Daily overview</h2><h3>Monday</h3><h3>Tuesday</h3><h3>Wednesday</h3><h3>Thursday</h3><h3>Friday</h3><h2>Short-term tasks</h2><ul><li>[ ] Task</li></ul><h2>Long-term tasks</h2><ul><li>[ ] Task</li></ul><h2>Meetings this week</h2><h2>Communication and follow-ups</h2><h2>Feedback received</h2><h2>Skills practiced</h2><h2>Work completed</h2><h2>Questions for supervisor</h2><h2>Next week</h2>'],
  ['Team Meeting Notes', 'Discussion, decisions, ownership, and the team update.', 'team', '<h1>Team Meeting</h1><p><strong>Date:</strong><br><strong>Meeting lead:</strong><br><strong>Location or call:</strong></p><h2>Attendance</h2><p>Present:<br>Absent:</p><h2>Agenda</h2><h2>Main room notes</h2><h2>Breakout room notes</h2><h2>Announcements</h2><h2>Decisions made</h2><h2>Short-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Long-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Target:</li></ul><h2>Questions and blockers</h2><h2>Team overview message</h2><h2>Next meeting</h2>'],
  ['Breakout Room Notes', 'Focused small-group discussion and the main-room update.', 'team', '<h1>Breakout Room Notes</h1><p><strong>Topic:</strong><br><strong>People present:</strong><br><strong>Facilitator:</strong></p><h2>Goal</h2><h2>Discussion</h2><h2>Decisions</h2><h2>Assigned tasks</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Questions to bring back</h2><h2>Main-room update</h2><h2>Follow-ups</h2>'],
  ['Formal Meeting Minutes', 'Concise minutes ready to distribute after a meeting.', 'meeting', '<h1>Meeting Minutes</h1><p><strong>Meeting:</strong><br><strong>Date:</strong><br><strong>Time:</strong><br><strong>Location:</strong><br><strong>Facilitator:</strong><br><strong>Minutes prepared by:</strong></p><h2>Attendees</h2><h2>Absent</h2><h2>Agenda</h2><h2>Discussion by topic</h2><h3>Topic 1</h3><p>Summary:<br>Decision:</p><h2>Action items</h2><ul><li>[ ] Action<br>Owner:<br>Deadline:</li></ul><h2>Motions or formal decisions</h2><h2>Items carried forward</h2><h2>Next meeting</h2><h2>Distribution</h2>'],
  ['Team Lead Weekly Overview', 'Priorities, support, blockers, and communication for a small team.', 'team', '<h1>Team Lead Weekly Overview</h1><h2>Team priorities</h2><h2>Short-term work</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Long-term work</h2><ul><li>[ ] Task<br>Owner:<br>Target:</li></ul><h2>Assignments by person</h2><h3>Team member</h3><p>Current work:<br>Support needed:<br>Next step:</p><h2>Blockers</h2><h2>People needing support</h2><h2>Upcoming deadlines</h2><h2>Meeting agenda</h2><h2>Communication to send</h2><h2>Wins</h2><h2>Risks</h2><h2>Next week</h2>'],
];

const provisionLedgerTemplates = async (workspaceId) => {
  for (const [name, description, category, content_html] of LEDGER_TEMPLATE_PRESETS) {
    const existing = await supabase.from('note_templates').select('id').eq('workspace_id', workspaceId).eq('name', name).eq('is_system', true).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      const result = await supabase.from('note_templates').insert({ workspace_id: workspaceId, name, description, category, content_html, is_default: false, is_system: true, visibility: 'workspace', usage_count: 0 });
      if (result.error) throw result.error;
    }
  }
};

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

    await provisionLedgerTemplates(insertResult.data.id);

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
      const hasWorkspaceType = typeof req.body?.is_personal === 'boolean';
      const isPersonal = hasWorkspaceType ? Boolean(req.body.is_personal) : null;

      if (!name) {
        return res.status(400).json({ error: 'Workspace name is required' });
      }

      const updatePayload = {
        name,
        description: description || null,
        updated_at: new Date().toISOString(),
        ...(hasWorkspaceType ? { is_personal: isPersonal } : {}),
      };

      const updated = await supabase
        .from('workspaces')
        .update(updatePayload)
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
          ...(hasWorkspaceType ? { is_personal: isPersonal } : {}),
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

const teamRoleValues = ['lead', 'member', 'viewer'];
const teamRoleOrder = { lead: 0, member: 1, viewer: 2 };

const normalizeTeamIdentifier = (value) =>
  String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();

const getInitialsFromName = (name, email = null) => {
  const source = String(name ?? '').trim() || String(email ?? '').split('@')[0] || 'Member';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const buildTeamWorkItem = ({
  kind,
  row,
  projectName,
}) => {
  const dueDate = kind === 'task' ? row.due_date ?? null : row.milestone_date ?? null;
  const dueLabel = dueDate ? new Date(dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
  const detail = [
    kind === 'task' ? 'Task' : 'Milestone',
    projectName,
    dueLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    kind,
    sourceId: row.id,
    title: row.title,
    projectId: row.project_id ?? null,
    projectName,
    detail,
    dueDate,
    priority: kind === 'task' ? row.priority ?? null : null,
    status: kind === 'task' ? row.status ?? null : row.completed ? 'completed' : 'open',
    typeLabel: kind === 'milestone' ? row.type ?? 'Custom' : null,
    assignedToUserId: row.assigned_to_user_id ?? row.assigned_to ?? null,
    assignedToTeamId: row.assigned_to_team_id ?? row.assigned_team_id ?? null,
    taskType: kind === 'task' ? row.task_horizon ?? null : null,
    searchText: [row.title, projectName, detail, row.priority, row.type].filter(Boolean).join(' ').toLowerCase(),
    assignedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
};

const loadWorkspaceTeams = async (workspaceId, currentUserId, options = {}) => {
  const includeArchived = Boolean(options.includeArchived);
  const [teamsResult, membersResult, projectsResult, tasksResult, milestonesResult, noteLinksResult] = await Promise.all([
    supabase
      .from('workspace_teams')
      .select(workspaceTeamSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),
    supabase
      .from('workspace_team_members')
      .select('team_id, user_id, role, created_by, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name, owner_team_id')
      .eq('workspace_id', workspaceId),
    supabase
      .from('tasks')
      .select(taskSelectWithHorizonColumns)
      .eq('workspace_id', workspaceId)
      .or('assigned_team_id.not.is.null,assigned_to_team_id.not.is.null'),
    supabase
      .from('project_milestones')
      .select(projectMilestoneSelectColumns)
      .eq('workspace_id', workspaceId)
      .or('assigned_team_id.not.is.null,assigned_to_team_id.not.is.null'),
    supabase
      .from('note_team_links')
      .select('id, workspace_id, note_id, team_id, created_by, created_at')
      .eq('workspace_id', workspaceId),
  ]);

  if (teamsResult.error) throw teamsResult.error;
  if (membersResult.error) throw membersResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (tasksResult.error) throw tasksResult.error;
  if (milestonesResult.error) throw milestonesResult.error;
  if (noteLinksResult.error) throw noteLinksResult.error;

  const teamRows = (teamsResult.data ?? []).filter((team) => includeArchived || !team.archived_at);
  const memberRows = membersResult.data ?? [];
  const projectRows = projectsResult.data ?? [];
  const projectMap = new Map(projectRows.map((project) => [project.id, project.name]));
  const projectIds = projectRows.map((project) => project.id).filter(Boolean);
  const projectMilestonesResult =
    projectIds.length > 0
      ? await supabase
          .from('project_milestones')
          .select('id, workspace_id, project_id, title, milestone_date, type, note, completed, linked_note_id, linked_reminder_id, linked_event_id, assigned_to_user_id, assigned_to_team_id, assigned_team_id, assigned_by_user_id, assigned_at, created_by, updated_by, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .in('project_id', projectIds)
      : { data: [], error: null };
  if (projectMilestonesResult.error) throw projectMilestonesResult.error;
  const projectMilestoneRows = projectMilestonesResult.data ?? [];
  const projectsByTeamId = new Map();
  for (const project of projectRows) {
    if (!project.owner_team_id) continue;
    if (!projectsByTeamId.has(project.owner_team_id)) {
      projectsByTeamId.set(project.owner_team_id, []);
    }
    projectsByTeamId.get(project.owner_team_id).push({
      id: project.id,
      name: project.name,
    });
  }

  const projectNoteLinksResult =
    projectIds.length > 0
      ? await supabase
          .from('project_note_links')
          .select('id, workspace_id, project_id, note_id, created_by, created_at')
          .eq('workspace_id', workspaceId)
          .in('project_id', projectIds)
      : { data: [], error: null };
  if (projectNoteLinksResult.error) throw projectNoteLinksResult.error;

  const userIds = [
    ...new Set(
      [
        ...teamRows.map((team) => team.created_by).filter(Boolean),
        ...memberRows.map((row) => row.user_id).filter(Boolean),
      ]
    ),
  ];

  const usersResult =
    userIds.length > 0
      ? await supabase.from('users').select('id, email, full_name').in('id', userIds)
      : { data: [], error: null };

  if (usersResult.error) throw usersResult.error;
  const userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user]));

  const membersByTeamId = new Map();
  for (const row of memberRows) {
    if (!row.team_id) continue;
    const member = userMap.get(row.user_id);
    const fullName = member?.full_name?.trim() || member?.email?.split('@')[0] || 'Team member';
    const nextMember = {
      id: row.user_id,
      name: fullName,
      email: member?.email ?? null,
      role: teamRoleValues.includes(String(row.role ?? '').toLowerCase())
        ? String(row.role ?? '').toLowerCase()
        : 'member',
      initials: getInitialsFromName(fullName, member?.email ?? null),
    };
    if (!membersByTeamId.has(row.team_id)) {
      membersByTeamId.set(row.team_id, []);
    }
    membersByTeamId.get(row.team_id).push(nextMember);
  }

  const tasksByTeamId = new Map();
  for (const task of tasksResult.data ?? []) {
    const assignedTeamId = task.assigned_team_id ?? task.assigned_to_team_id ?? null;
    if (!assignedTeamId) continue;
    const projectName = task.project_id ? projectMap.get(task.project_id) ?? 'Workspace' : 'Workspace';
    const item = buildTeamWorkItem({ kind: 'task', row: task, projectName });
    if (!tasksByTeamId.has(assignedTeamId)) {
      tasksByTeamId.set(assignedTeamId, []);
    }
    tasksByTeamId.get(assignedTeamId).push(item);
  }

  const milestonesByTeamId = new Map();
  for (const milestone of milestonesResult.data ?? []) {
    const assignedTeamId = milestone.assigned_team_id ?? milestone.assigned_to_team_id ?? null;
    if (!assignedTeamId) continue;
    const projectName = milestone.project_id ? projectMap.get(milestone.project_id) ?? 'Workspace' : 'Workspace';
    const item = buildTeamWorkItem({ kind: 'milestone', row: milestone, projectName });
    if (!milestonesByTeamId.has(assignedTeamId)) {
      milestonesByTeamId.set(assignedTeamId, []);
    }
    milestonesByTeamId.get(assignedTeamId).push(item);
  }

  const noteIds = [...new Set((noteLinksResult.data ?? []).map((row) => row.note_id).filter(Boolean))];
  const notesResult =
    noteIds.length > 0
      ? await supabase.from('notes').select('id, title, updated_at, preview').eq('workspace_id', workspaceId).in('id', noteIds)
      : { data: [], error: null };
  if (notesResult.error) throw notesResult.error;
  const noteMap = new Map((notesResult.data ?? []).map((note) => [note.id, note]));
  const notesByTeamId = new Map();
  for (const row of noteLinksResult.data ?? []) {
    const note = noteMap.get(row.note_id);
    if (!note) continue;
    const nextNote = {
      id: note.id,
      title: note.title ?? 'Untitled note',
      updatedAt: note.updated_at ?? null,
    };
    if (!notesByTeamId.has(row.team_id)) {
      notesByTeamId.set(row.team_id, []);
    }
    notesByTeamId.get(row.team_id).push(nextNote);
  }

  const projectNotesByTeamId = new Map();
  const projectMilestonesByTeamId = new Map();
  const projectNotesByProjectId = new Map();
  for (const row of projectNoteLinksResult.data ?? []) {
    const note = noteMap.get(row.note_id);
    const project = projectRows.find((item) => item.id === row.project_id);
    if (!note || !project?.owner_team_id) continue;
    const nextNote = {
      id: note.id,
      title: note.title ?? 'Untitled note',
      updatedAt: note.updated_at ?? null,
      projectId: project.id,
      projectName: project.name ?? 'Project',
    };
    if (!projectNotesByTeamId.has(project.owner_team_id)) {
      projectNotesByTeamId.set(project.owner_team_id, []);
    }
    projectNotesByTeamId.get(project.owner_team_id).push(nextNote);
    if (!projectNotesByProjectId.has(project.id)) {
      projectNotesByProjectId.set(project.id, []);
    }
    projectNotesByProjectId.get(project.id).push(nextNote);
  }

  for (const milestone of projectMilestoneRows ?? []) {
    const project = projectRows.find((item) => item.id === milestone.project_id);
    if (!project?.owner_team_id) continue;
    const item = buildTeamWorkItem({
      kind: 'milestone',
      row: milestone,
      projectName: project.name ?? 'Workspace',
    });
    if (!projectMilestonesByTeamId.has(project.owner_team_id)) {
      projectMilestonesByTeamId.set(project.owner_team_id, []);
    }
    projectMilestonesByTeamId.get(project.owner_team_id).push(item);
  }

  return teamRows.map((team) => {
    const teamMembers = (membersByTeamId.get(team.id) ?? []).sort((a, b) => {
      if (a.role !== b.role) return teamRoleOrder[a.role] - teamRoleOrder[b.role];
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
    const taskItems = (tasksByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(b.assignedAt).localeCompare(String(a.assignedAt))
    );
    const milestoneItems = (milestonesByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(b.assignedAt).localeCompare(String(a.assignedAt))
    );
    const assignedWork = [...taskItems, ...milestoneItems].sort((a, b) =>
      String(b.assignedAt).localeCompare(String(a.assignedAt))
    );
    const activeProjects = [...new Set(assignedWork.map((item) => item.projectName).filter(Boolean))];
    const ownedProjects = (projectsByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    );
    const ownedProjectNotes = (projectNotesByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
    );
    const ownedProjectMilestones = (projectMilestonesByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(b.assignedAt ?? '').localeCompare(String(a.assignedAt ?? ''))
    );
    const ownedProjectsWithCounts = ownedProjects.map((project) => {
      const noteCount = (projectNotesByProjectId.get(project.id) ?? []).length;
      const milestoneCount = ownedProjectMilestones.filter((item) => item.projectId === project.id).length;
      return {
        ...project,
        noteCount,
        milestoneCount,
      };
    });
    const linkedNotes = (notesByTeamId.get(team.id) ?? []).sort((a, b) =>
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
    );
    const allLinkedNotes = [...linkedNotes, ...ownedProjectNotes].reduce((acc, note) => {
      if (acc.some((item) => item.id === note.id)) return acc;
      acc.push(note);
      return acc;
    }, []);
    const currentUserMember = teamMembers.find((member) => member.id === currentUserId) ?? null;
    const currentUserRole =
      currentUserMember?.role ?? (team.created_by === currentUserId ? 'lead' : null);

    return {
      id: team.id,
      name: team.name,
      identifier: team.identifier,
      description: team.description ?? null,
      color: team.color ?? '#FF5F40',
      members: teamMembers,
      assignedWork,
      assignedCount: taskItems.length,
      milestoneCount: milestoneItems.length,
      activeProjects,
      ownedProjects: ownedProjectsWithCounts,
      linkedNotes: allLinkedNotes,
      projectMilestones: ownedProjectMilestones,
      currentUserRole,
      archivedAt: team.archived_at ?? null,
      archivedBy: team.archived_by ?? null,
      defaultTaskScope: team.default_task_scope ?? 'long_term',
      defaultProjectVisibility: team.default_project_visibility ?? 'workspace',
      defaultAssigneeBehavior: team.default_assignee_behavior ?? 'team',
    };
  });
};

const personPreferenceSelectColumns =
  'workspace_id, user_id, person_user_id, is_pinned, sort_order, created_at, updated_at';
const pinSelectColumns =
  'id, workspace_id, user_id, object_type, object_id, folder_id, sort_order, created_at, updated_at';
const pinFolderSelectColumns =
  'id, workspace_id, user_id, name, sort_order, collapsed, created_at, updated_at';
const personTaskSelectColumns =
  'id, workspace_id, project_id, title, status, priority, due_date, due_time, completed_at, assigned_to, assigned_to_user_id, assigned_to_team_id, assigned_team_id, assigned_by_user_id, assigned_at, created_at, updated_at';
const personProjectSelectColumns =
  'id, workspace_id, name, status, completeness, color, end_date, lead_id, created_by, created_at, updated_at';
const personAuditSelectColumns =
  'id, workspace_id, actor_user_id, action, target_type, target_id, metadata, created_at';

const supportedPinObjectTypes = new Set([
  'person',
  'project',
  'note',
  'team',
  'task',
  'event',
  'reminder',
  'saved_view',
  'follow_up_view',
  'team_page',
]);

const normalizePinObjectType = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'people') return 'person';
  if (normalized === 'team_page') return 'team';
  if (supportedPinObjectTypes.has(normalized)) return normalized;
  return null;
};

const getPinObjectTypeLabel = (value) => {
  switch (normalizePinObjectType(value)) {
    case 'person':
      return 'Person';
    case 'project':
      return 'Project';
    case 'note':
      return 'Note';
    case 'team':
      return 'Team';
    case 'task':
      return 'Task';
    case 'event':
      return 'Event';
    case 'reminder':
      return 'Reminder';
    case 'saved_view':
      return 'Saved view';
    case 'follow_up_view':
      return 'Follow-up view';
    case 'team_page':
      return 'Team page';
    default:
      return 'Item';
  }
};

const getPinFolderName = (folder) => normalizeNullableText(folder?.name) || 'Folder';

const formatPinTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatPinStatusLabel = (status) => {
  const normalized = String(status ?? '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('complete')) return 'Completed';
  if (normalized.includes('pause') || normalized.includes('archiv')) return 'Paused';
  if (normalized.includes('progress') || normalized.includes('in_')) return 'In progress';
  if (normalized.includes('done')) return 'Done';
  if (normalized.includes('todo')) return 'To do';
  return titleCaseLabel(normalized);
};

const buildCirclePersonPinContext = (personId, personName) =>
  `ledger-person|${personId}|${encodeURIComponent(personName ?? 'Member')}`;

const normalizeCirclePersonName = (user) =>
  normalizeNullableText(user?.full_name) || normalizeNullableText(user?.email?.split('@')?.[0]) || 'Member';

const circleActivityActionLabels = {
  'member.joined': 'Joined workspace',
  'member.role_updated': 'Updated membership',
  'member.removed': 'Removed member',
  'workspace.updated': 'Updated workspace',
  'workspace.deleted': 'Deleted workspace',
  'invite.accepted': 'Accepted invite',
  'invite.created': 'Created invite',
  'invite.revoked': 'Revoked invite',
};

const getMostRecentIso = (...values) => {
  let latest = null;
  for (const value of values.flat()) {
    if (!value) continue;
    const normalized = String(value);
    if (!latest || normalized > latest) {
      latest = normalized;
    }
  }
  return latest;
};

const formatCircleProjectStatus = (status) => {
  const normalized = normalizeProjectSemanticStatus(status);
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'paused') return 'Paused';
  if (normalized === 'in_progress') return 'In progress';
  return 'Not started';
};

const formatCircleTaskStatus = (status) => {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'cancelled') return 'Cancelled';
  if (normalized === 'in_progress') return 'In progress';
  return 'Open';
};

const isCircleOpenTask = (task) => !['completed', 'cancelled'].includes(String(task?.status ?? '').toLowerCase());

const buildCircleTeamLabels = (teamMembershipRows, teamMap) => {
  const teamsByUserId = new Map();

  for (const row of teamMembershipRows ?? []) {
    if (!row?.user_id || !row?.team_id) continue;
    const team = teamMap.get(row.team_id);
    if (!team) continue;
    const nextTeam = {
      id: team.id,
      name: team.name,
      role: String(row.role ?? 'member').toLowerCase(),
      sortRole: row.role === 'lead' ? 0 : row.role === 'member' ? 1 : 2,
    };
    if (!teamsByUserId.has(row.user_id)) {
      teamsByUserId.set(row.user_id, []);
    }
    teamsByUserId.get(row.user_id).push(nextTeam);
  }

  for (const teams of teamsByUserId.values()) {
    teams.sort((a, b) => a.sortRole - b.sortRole || String(a.name).localeCompare(String(b.name)));
  }

  return teamsByUserId;
};

const loadCircleWorkspacePeople = async (workspaceId, currentUserId) => {
  const access = await requireWorkspaceAccess(currentUserId, workspaceId, 'member');
  const workspace = access.workspace;
  const nowIso = new Date().toISOString();
  const [
    memberRowsResult,
    teamRowsResult,
    teamMemberRowsResult,
    taskRowsResult,
    projectRowsResult,
    auditRowsResult,
    preferenceRowsResult,
    personPinRowsResult,
  ] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id, role, joined_at')
      .eq('workspace_id', workspaceId),
    supabase
      .from('workspace_teams')
      .select('id, workspace_id, name, identifier, color, created_by, archived_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),
    supabase
      .from('workspace_team_members')
      .select('workspace_id, team_id, user_id, role, created_at')
      .eq('workspace_id', workspaceId),
    supabase
      .from('tasks')
      .select(personTaskSelectColumns)
      .eq('workspace_id', workspaceId),
    supabase
      .from('projects')
      .select(personProjectSelectColumns)
      .eq('workspace_id', workspaceId),
    supabase
      .from('workspace_audit_logs')
      .select(personAuditSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('person_preferences')
      .select(personPreferenceSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', currentUserId),
    supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', currentUserId)
      .eq('object_type', 'person'),
  ]);

  if (memberRowsResult.error) throw memberRowsResult.error;
  if (teamRowsResult.error) throw teamRowsResult.error;
  if (teamMemberRowsResult.error) throw teamMemberRowsResult.error;
  if (taskRowsResult.error) throw taskRowsResult.error;
  if (projectRowsResult.error) throw projectRowsResult.error;
  if (auditRowsResult.error) throw auditRowsResult.error;
  if (preferenceRowsResult.error) throw preferenceRowsResult.error;
  if (personPinRowsResult.error) throw personPinRowsResult.error;

  const memberRows = memberRowsResult.data ?? [];
  const teamRows = teamRowsResult.data ?? [];
  const teamMemberRows = teamMemberRowsResult.data ?? [];
  const taskRows = taskRowsResult.data ?? [];
  const projectRows = projectRowsResult.data ?? [];
  const auditRows = auditRowsResult.data ?? [];
  const preferenceRows = preferenceRowsResult.data ?? [];
  const personPinRows = personPinRowsResult.data ?? [];

  const userIds = [
    workspace.owner_id,
    ...memberRows.map((row) => row.user_id),
    currentUserId,
  ].filter(Boolean);
  const uniqueUserIds = [...new Set(userIds)];

  const usersResult =
    uniqueUserIds.length > 0
      ? await supabase
          .from('users')
          .select('id, email, full_name, avatar_url, created_at, updated_at')
          .in('id', uniqueUserIds)
      : { data: [], error: null };

  if (usersResult.error) throw usersResult.error;

  const userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user]));
  const teamMap = new Map(teamRows.map((team) => [team.id, team]));
  const teamMembershipsByUserId = buildCircleTeamLabels(teamMemberRows, teamMap);
  const preferenceByPersonId = new Map(
    preferenceRows.map((row) => [row.person_user_id, row])
  );
  const personPinByPersonId = new Map(personPinRows.map((row) => [row.object_id, row]));

  const membersByUserId = new Map(memberRows.map((row) => [row.user_id, row]));
  const allPeople = [];

  const addPerson = (userId, { roleOverride = null, isOwner = false } = {}) => {
    if (!userId || allPeople.some((person) => person.id === userId)) return;
    const user = userMap.get(userId);
    if (!user) return;

    const memberRow = membersByUserId.get(userId);
    const teamMemberships = (teamMembershipsByUserId.get(userId) ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      role: team.role,
    }));
    const role = roleOverride || (isOwner ? 'owner' : String(memberRow?.role ?? 'member').toLowerCase());
    const personTasks = taskRows.filter((task) => task.assigned_to_user_id === userId);
    const openTasks = personTasks.filter(isCircleOpenTask);
    const assignedByCurrentUser = openTasks.filter((task) => task.assigned_by_user_id === currentUserId);
    const currentUserTasks = taskRows.filter((task) => task.assigned_to_user_id === currentUserId);
    const projectIdsForPerson = new Set([
      ...personTasks.map((task) => task.project_id).filter(Boolean),
      ...projectRows
        .filter((project) => project.lead_id === userId || project.created_by === userId)
        .map((project) => project.id)
        .filter(Boolean),
    ]);
    const projectIdsForCurrentUser = new Set([
      ...currentUserTasks.map((task) => task.project_id).filter(Boolean),
      ...projectRows
        .filter((project) => project.lead_id === currentUserId || project.created_by === currentUserId)
        .map((project) => project.id)
        .filter(Boolean),
    ]);
    const sharedProjectIds = [...projectIdsForPerson].filter((projectId) =>
      projectIdsForCurrentUser.has(projectId)
    );
    const latestTaskTimestamp = getMostRecentIso(
      ...personTasks.map((task) => task.completed_at ?? task.updated_at ?? task.assigned_at ?? task.created_at)
    );
    const latestProjectTimestamp = getMostRecentIso(
      ...projectRows
        .filter(
          (project) =>
            project.lead_id === userId ||
            project.created_by === userId ||
            sharedProjectIds.includes(project.id)
        )
        .map((project) => project.updated_at ?? project.created_at)
    );
    const latestAuditTimestamp = getMostRecentIso(
      ...auditRows.filter((row) => row.actor_user_id === userId).map((row) => row.created_at)
    );

    allPeople.push({
      id: userId,
      name: normalizeCirclePersonName(user),
      email: user.email ?? null,
      avatar_url: user.avatar_url ?? null,
      role,
      teams: teamMemberships,
      team_labels: teamMemberships.map((team) => team.name).filter(Boolean),
      open_task_count: openTasks.length,
      shared_project_count: sharedProjectIds.length,
      follow_up_count: 0,
      waiting_on_count: assignedByCurrentUser.length,
      is_pinned:
        Boolean(personPinByPersonId.get(userId)) || Boolean(preferenceByPersonId.get(userId)?.is_pinned),
      last_active_at:
        latestAuditTimestamp || latestTaskTimestamp || latestProjectTimestamp || memberRow?.joined_at || workspace.created_at || nowIso,
      joined_at: memberRow?.joined_at ?? workspace.created_at ?? null,
      workspace_role: role,
      is_owner: isOwner,
    });
  };

  addPerson(workspace.owner_id, { isOwner: true, roleOverride: 'owner' });
  for (const memberRow of memberRows) {
    addPerson(memberRow.user_id, {});
  }

  const peopleById = new Map(allPeople.map((person) => [person.id, person]));

  const buildTaskRow = (task) => {
    const project = projectRows.find((entry) => entry.id === task.project_id) ?? null;
    return {
      id: task.id,
      title: task.title ?? 'Untitled task',
      status: task.status ?? 'todo',
      status_label: formatCircleTaskStatus(task.status),
      priority: task.priority ?? 'medium',
      due_date: task.due_date ?? null,
      due_time: task.due_time ?? null,
      project_id: task.project_id ?? null,
      project_name: project?.name ?? null,
      project_status: project ? formatCircleProjectStatus(project.status) : null,
      project_color: project?.color ?? null,
      assigned_by_user_id: task.assigned_by_user_id ?? null,
      assigned_at: task.assigned_at ?? null,
      completed_at: task.completed_at ?? null,
      updated_at: task.updated_at ?? null,
      created_at: task.created_at ?? null,
      is_open: isCircleOpenTask(task),
      is_overdue:
        isCircleOpenTask(task) &&
        Boolean(task.due_date) &&
        String(task.due_date) < nowIso.slice(0, 10),
    };
  };

  const buildProjectRow = (project, personId) => {
    const personTasks = taskRows.filter(
      (task) => task.project_id === project.id && task.assigned_to_user_id === personId
    );
    const currentUserTasks = taskRows.filter(
      (task) => task.project_id === project.id && task.assigned_to_user_id === currentUserId
    );
    const role = project.lead_id === personId ? 'Lead' : project.created_by === personId ? 'Owner' : 'Shared';
    return {
      id: project.id,
      title: project.name ?? 'Untitled project',
      status: formatCircleProjectStatus(project.status),
      progress: Number(project.completeness ?? 0),
      color: project.color ?? '#FF5F40',
      role,
      due_date: project.end_date ?? null,
      next_action_count: [...personTasks, ...currentUserTasks].filter(isCircleOpenTask).length,
      updated_at: project.updated_at ?? project.created_at ?? null,
      created_at: project.created_at ?? null,
    };
  };

  const buildActivityRow = (item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    timestamp: item.timestamp,
    project_id: item.project_id ?? null,
    task_id: item.task_id ?? null,
  });

  return {
    workspace,
    people: allPeople.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    peopleById,
    teamMap,
    taskRows,
    projectRows,
    auditRows,
    preferenceByPersonId,
    buildTaskRow,
    buildProjectRow,
    buildActivityRow,
    nowIso,
  };
};

const ensureTeamManageAccess = async ({ userId, teamId, workspaceId }) => {
  const access = await requireWorkspaceAccess(userId, workspaceId, 'member');
  if (access.role === 'owner' || access.role === 'admin') {
    return access;
  }

  const teamResult = await supabase
    .from('workspace_teams')
    .select('id, created_by, workspace_id')
    .eq('id', teamId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (teamResult.error) throw teamResult.error;
  if (!teamResult.data?.id) {
    const error = new Error('Team not found');
    error.statusCode = 404;
    throw error;
  }

  if (teamResult.data.created_by === userId) {
    return access;
  }

  const memberResult = await supabase
    .from('workspace_team_members')
    .select('id, role')
    .eq('workspace_id', workspaceId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberResult.error) throw memberResult.error;
  if (String(memberResult.data?.role ?? '').toLowerCase() === 'lead') {
    return access;
  }

  const error = new Error('Team access denied');
  error.statusCode = 403;
  throw error;
};

const loadWorkspaceTeamById = async (teamId, workspaceId = null) => {
  let query = supabase.from('workspace_teams').select(workspaceTeamSelectColumns).eq('id', teamId);
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
};

const requireTeamAccess = async (userId, teamId, workspaceId = null) => {
  const team = await loadWorkspaceTeamById(teamId, workspaceId);
  if (!team) {
    const error = new Error('Team not found');
    error.statusCode = 404;
    throw error;
  }

  const access = await requireWorkspaceMember(userId, team.workspace_id);
  return { team, workspaceId: team.workspace_id, access };
};

const requireTeamMember = async (userId, teamId, workspaceId = null) => {
  const context = await requireTeamAccess(userId, teamId, workspaceId);
  const membership = await supabase
    .from('workspace_team_members')
    .select('id, team_id, user_id, role, created_at, updated_at')
    .eq('workspace_id', context.workspaceId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membership.error) throw membership.error;
  if (!membership.data?.id) {
    const error = new Error('Team not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    ...context,
    membership: membership.data,
  };
};

const requireTeamAdmin = async (userId, teamId, workspaceId = null) => {
  const context = await requireTeamAccess(userId, teamId, workspaceId);
  await ensureTeamManageAccess({ userId, teamId, workspaceId: context.workspaceId });
  return context;
};

const loadUsersByIds = async (userIds) => {
  const ids = [...new Set((userIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!ids.length) {
    return new Map();
  }

  const result = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, created_at, updated_at')
    .in('id', ids);

  if (result.error) throw result.error;
  return new Map((result.data ?? []).map((user) => [user.id, user]));
};

const loadPinFolderById = async ({ folderId, workspaceId, userId }) => {
  if (!folderId) return null;

  const result = await supabase
    .from('pin_folders')
    .select(pinFolderSelectColumns)
    .eq('id', folderId)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ?? null;
};

const getNextPinSortOrder = async ({ workspaceId, userId, folderId }) => {
  let query = supabase
    .from('user_pins')
    .select('sort_order', { count: 'exact', head: false })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (folderId) {
    query = query.eq('folder_id', folderId);
  } else {
    query = query.is('folder_id', null);
  }

  const result = await query.order('sort_order', { ascending: false }).limit(1);
  if (result.error) throw result.error;

  const current = Number(result.data?.[0]?.sort_order ?? -1);
  return Number.isFinite(current) ? current + 1 : 0;
};

const buildPinPersonPayload = ({ person, memberRow, currentUserId }) => {
  const name = normalizeCirclePersonName(person);
  return {
    title: name,
    subtitle: person.workspace_role ? titleCaseLabel(person.workspace_role) : 'Circle',
    icon_kind: 'person',
    initials: getInitialsFromName(name, person.email),
    color: null,
    destination: {
      kind: 'circle',
      focusContext: buildCirclePersonPinContext(person.id, name),
    },
    metadata: {
      role: memberRow?.role ?? null,
      is_owner: Boolean(person.is_owner),
      current_user_id: currentUserId,
    },
  };
};

const buildPinProjectPayload = (project) => ({
  title: project.name ?? 'Untitled project',
  subtitle: formatPinStatusLabel(project.status) ?? 'Project',
  icon_kind: 'project',
  initials: null,
  color: project.color ?? null,
  destination: {
    kind: 'projects',
    focusProjectId: project.id,
  },
});

const buildPinNotePayload = (note) => ({
  title: note.title ?? 'Untitled note',
  subtitle: note.source ? titleCaseLabel(note.source) : 'Note',
  icon_kind: 'note',
  initials: null,
  color: null,
  destination: {
    kind: 'notes',
    focusNoteId: note.id,
  },
});

const buildPinTeamPayload = (team, currentUserRole = null) => ({
  title: team.name ?? 'Untitled team',
  subtitle: currentUserRole ? `${titleCaseLabel(currentUserRole)} · Team` : 'Team',
  icon_kind: 'team',
  initials: normalizeTeamIdentifier(team.identifier) || getInitialsFromName(team.name),
  color: team.color ?? null,
  destination: {
    kind: 'teams',
    focusContext: `team:${team.id}`,
  },
});

const buildPinTaskPayload = (task, project = null) => ({
  title: task.title ?? 'Untitled task',
  subtitle:
    [
      task.due_date ? `Due ${formatPinTimestamp(task.due_date) ?? task.due_date}` : null,
      project?.name ?? null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Task',
  icon_kind: 'task',
  initials: null,
  color: null,
  destination: {
    kind: 'dashboard',
    focusTaskId: task.id,
  },
});

const buildPinEventPayload = (event, calendar = null) => ({
  title: event.title ?? 'Untitled event',
  subtitle:
    [
      event.start_at ? formatPinTimestamp(event.start_at) : null,
      calendar?.name ?? null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Event',
  icon_kind: 'event',
  initials: null,
  color: event.color ?? calendar?.color ?? null,
  destination: {
    kind: 'calendar',
    focusContext: `focus-event:${event.id}`,
  },
});

const buildPinReminderPayload = (reminder, calendar = null) => ({
  title: reminder.title ?? 'Untitled reminder',
  subtitle:
    [
      reminder.remind_at ? formatPinTimestamp(reminder.remind_at) : null,
      calendar?.name ?? null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Reminder',
  icon_kind: 'reminder',
  initials: null,
  color: reminder.color ?? calendar?.color ?? null,
  destination: {
    kind: 'calendar',
    focusContext: `focus-reminder:${reminder.id}`,
  },
});

const resolvePinnedObjectTarget = async ({ workspaceId, userId, objectType, objectId }) => {
  const normalizedType = normalizePinObjectType(objectType);
  const normalizedObjectId = String(objectId ?? '').trim();
  if (!normalizedType || !normalizedObjectId) {
    const error = new Error('Unsupported pin target');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedType === 'person') {
    const [workspaceResult, memberResult, userResult] = await Promise.all([
      supabase
        .from('workspaces')
        .select('id, owner_id, name, created_at')
        .eq('id', workspaceId)
        .maybeSingle(),
      supabase
        .from('workspace_members')
        .select('user_id, role, joined_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', normalizedObjectId)
        .maybeSingle(),
      supabase
        .from('users')
        .select('id, email, full_name, avatar_url')
        .eq('id', normalizedObjectId)
        .maybeSingle(),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;
    if (memberResult.error) throw memberResult.error;
    if (userResult.error) throw userResult.error;
    if (!userResult.data?.id) return null;
    if (!memberResult.data?.user_id && workspaceResult.data?.owner_id !== normalizedObjectId) return null;
    const role = memberResult.data?.role ?? (workspaceResult.data?.owner_id === normalizedObjectId ? 'owner' : 'member');
    const person = {
      id: userResult.data.id,
      name: normalizeCirclePersonName(userResult.data),
      email: userResult.data.email ?? null,
      avatar_url: userResult.data.avatar_url ?? null,
      role: String(role ?? 'member').toLowerCase(),
      workspace_role: String(role ?? 'member').toLowerCase(),
      is_owner: workspaceResult.data?.owner_id === normalizedObjectId,
    };
    return buildPinPersonPayload({ person, memberRow: memberResult.data, currentUserId: userId });
  }

  if (normalizedType === 'team') {
    const [teamResult, memberResult] = await Promise.all([
      supabase
        .from('workspace_teams')
        .select('id, workspace_id, name, identifier, color, created_by, archived_at')
        .eq('workspace_id', workspaceId)
        .eq('id', normalizedObjectId)
        .maybeSingle(),
      supabase
        .from('workspace_team_members')
        .select('id, team_id, user_id, role')
        .eq('workspace_id', workspaceId)
        .eq('team_id', normalizedObjectId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (teamResult.error) throw teamResult.error;
    if (memberResult.error) throw memberResult.error;
    if (!teamResult.data?.id) return null;
    if (teamResult.data.archived_at) return null;
    if (!memberResult.data?.id && teamResult.data.created_by !== userId) return null;
    return buildPinTeamPayload(teamResult.data, memberResult.data?.role ?? null);
  }

  if (normalizedType === 'project') {
    const result = await supabase
      .from('projects')
      .select('id, workspace_id, name, status, color, created_by, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', normalizedObjectId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data?.id) return null;
    return buildPinProjectPayload(result.data);
  }

  if (normalizedType === 'note') {
    const result = await supabase
      .from('notes')
      .select('id, workspace_id, title, source, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', normalizedObjectId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data?.id) return null;
    return buildPinNotePayload(result.data);
  }

  if (normalizedType === 'task') {
    const taskResult = await supabase
      .from('tasks')
      .select('id, workspace_id, title, status, due_date, project_id, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', normalizedObjectId)
      .maybeSingle();
    if (taskResult.error) throw taskResult.error;
    if (!taskResult.data?.id) return null;
    const projectResult = taskResult.data.project_id
      ? await supabase
          .from('projects')
          .select('id, name')
          .eq('workspace_id', workspaceId)
          .eq('id', taskResult.data.project_id)
          .maybeSingle()
      : null;
    if (projectResult?.error) throw projectResult.error;
    return buildPinTaskPayload(taskResult.data, projectResult?.data ?? null);
  }

  if (normalizedType === 'event') {
    const result = await supabase
      .from('events')
      .select('id, workspace_id, title, start_at, end_at, calendar_id, color, status')
      .eq('workspace_id', workspaceId)
      .eq('id', normalizedObjectId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data?.id) return null;
    const calendarResult = result.data.calendar_id
      ? await supabase.from('calendars').select('id, name, color').eq('workspace_id', workspaceId).eq('id', result.data.calendar_id).maybeSingle()
      : null;
    if (calendarResult?.error) throw calendarResult.error;
    return buildPinEventPayload(result.data, calendarResult?.data ?? null);
  }

  if (normalizedType === 'reminder') {
    const result = await supabase
      .from('reminders')
      .select('id, workspace_id, title, remind_at, calendar_id, color, status')
      .eq('workspace_id', workspaceId)
      .eq('id', normalizedObjectId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data?.id) return null;
    const calendarResult = result.data.calendar_id
      ? await supabase.from('calendars').select('id, name, color').eq('workspace_id', workspaceId).eq('id', result.data.calendar_id).maybeSingle()
      : null;
    if (calendarResult?.error) throw calendarResult.error;
    return buildPinReminderPayload(result.data, calendarResult?.data ?? null);
  }

  const error = new Error('Unsupported pin target');
  error.statusCode = 400;
  throw error;
};

const resolvePinnedObjectTargetSummary = async ({ workspaceId, userId, objectType, objectId }) => {
  const target = await resolvePinnedObjectTarget({ workspaceId, userId, objectType, objectId });
  return target
    ? {
        ...target,
        object_type: normalizePinObjectType(objectType),
        object_id: String(objectId),
      }
    : null;
};

const buildPinnedRecordResponse = (pinRow, target) => ({
  id: pinRow.id,
  workspace_id: pinRow.workspace_id,
  user_id: pinRow.user_id,
  object_type: pinRow.object_type,
  object_id: pinRow.object_id,
  folder_id: pinRow.folder_id ?? null,
  sort_order: Number(pinRow.sort_order ?? 0),
  created_at: pinRow.created_at,
  updated_at: pinRow.updated_at,
  title: target.title,
  subtitle: target.subtitle ?? null,
  icon_kind: target.icon_kind,
  initials: target.initials ?? null,
  color: target.color ?? null,
  destination: target.destination,
});

const loadUserPinsForWorkspace = async ({ workspaceId, userId }) => {
  const result = await supabase
    .from('user_pins')
    .select(pinSelectColumns)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('folder_id', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true });

  if (result.error) throw result.error;
  return result.data ?? [];
};

const loadPinFoldersForWorkspace = async ({ workspaceId, userId }) => {
  const result = await supabase
    .from('pin_folders')
    .select(pinFolderSelectColumns)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (result.error) throw result.error;
  return result.data ?? [];
};

const syncLegacyPersonPreferencePin = async ({
  workspaceId,
  userId,
  personId,
  isPinned,
  sortOrder,
}) => {
  const nowIso = new Date().toISOString();
  if (isPinned) {
    const result = await supabase
      .from('person_preferences')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: userId,
          person_user_id: personId,
          is_pinned: true,
          sort_order: Math.max(0, Number(sortOrder) || 0),
          updated_at: nowIso,
          created_at: nowIso,
        },
        { onConflict: 'workspace_id,user_id,person_user_id' }
      )
      .select(personPreferenceSelectColumns)
      .single();

    if (result.error) throw result.error;
    return result.data ?? null;
  }

  const result = await supabase
    .from('person_preferences')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('person_user_id', personId);

  if (result.error) throw result.error;
  return null;
};

const isTeamOpenTask = (task) => !['completed', 'cancelled'].includes(String(task?.status ?? '').toLowerCase());

const isTeamActiveProject = (project) => !['completed', 'paused'].includes(
  normalizeProjectSemanticStatus(project?.status)
);

const getTeamTaskAssignmentId = (task) => task.assigned_to_user_id ?? task.assigned_to ?? null;

const getTeamTaskOwnerTeamId = (task) => task.assigned_to_team_id ?? task.assigned_team_id ?? null;

const getTeamTaskDueValue = (task) => task.due_date ?? null;

const getTeamProjectStatus = (project) => normalizeProjectSemanticStatus(project?.status);

const detachTeamReferences = async ({ workspaceId, teamId }) => {
  const updates = [
    supabase
      .from('tasks')
      .update({
        assigned_to_team_id: null,
        assigned_team_id: null,
        assigned_by_user_id: null,
        assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .or(`assigned_to_team_id.eq.${teamId},assigned_team_id.eq.${teamId}`),
    supabase
      .from('project_milestones')
      .update({
        assigned_to_team_id: null,
        assigned_team_id: null,
        assigned_by_user_id: null,
        assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .or(`assigned_to_team_id.eq.${teamId},assigned_team_id.eq.${teamId}`),
    supabase
      .from('projects')
      .update({
        owner_team_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('owner_team_id', teamId),
    supabase
      .from('events')
      .update({
        assigned_to_team_id: null,
        assigned_by_user_id: null,
        assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('assigned_to_team_id', teamId),
    supabase
      .from('reminders')
      .update({
        assigned_to_team_id: null,
        assigned_by_user_id: null,
        assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('assigned_to_team_id', teamId),
    supabase
      .from('note_team_links')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId),
    supabase
      .from('workspace_team_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId),
  ];

  const results = await Promise.all(updates);
  const firstError = results.find((result) => result?.error)?.error ?? null;
  if (firstError) throw firstError;
};

const loadTeamRouteContext = async (req, teamId) => {
  const workspaceId = await resolveWorkspaceIdForRequest(req);
  const { team, access } = await requireTeamAccess(req.authUser.id, teamId, workspaceId);
  const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
  const teamData = teams.find((item) => item.id === teamId) ?? null;
  if (!teamData) {
    const error = new Error('Team not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    workspaceId,
    team,
    access,
    teamData,
    teams,
  };
};

app.get('/api/teams', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const includeArchived = String(req.query?.include_archived ?? req.query?.includeArchived ?? '')
      .toLowerCase()
      .trim() === 'true';
    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived });
    res.json({ current_user_role: access.role, teams });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const team = teams.find((item) => item.id === teamId) ?? null;
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ team });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/teams', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    const identifierSource = normalizeTeamIdentifier(req.body?.identifier) || normalizeTeamIdentifier(name);
    if (!identifierSource) {
      return res.status(400).json({ error: 'Team identifier is required' });
    }

    const description = normalizeNullableText(req.body?.description);
    const color = normalizeNullableText(req.body?.color) || '#FF5F40';
    const requestedMemberIds = Array.isArray(req.body?.member_ids)
      ? [...new Set(req.body.member_ids.map((memberId) => String(memberId).trim()).filter(Boolean))]
      : [];
    const selectedMemberIds = requestedMemberIds.filter((memberId) => memberId !== req.authUser.id);
    if (selectedMemberIds.length > 0) {
      const memberLookup = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .in('user_id', selectedMemberIds);
      if (memberLookup.error) throw memberLookup.error;

      const validMemberIds = new Set((memberLookup.data ?? []).map((row) => String(row.user_id)));
      const invalidMemberIds = selectedMemberIds.filter((memberId) => !validMemberIds.has(memberId));
      if (invalidMemberIds.length > 0) {
        return res.status(400).json({ error: 'Selected members must belong to the workspace' });
      }
    }

    let identifier = identifierSource;
    for (let suffix = 0; suffix < 20; suffix += 1) {
      const candidate = suffix === 0 ? identifierSource : `${identifierSource}-${suffix + 1}`;
      const existing = await supabase
        .from('workspace_teams')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('identifier', candidate)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data?.id) {
        identifier = candidate;
        break;
      }
    }

    const teamInsert = await supabase
      .from('workspace_teams')
      .insert({
        workspace_id: workspaceId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        name,
        identifier,
        description,
        color,
        default_task_scope: 'long_term',
        default_project_visibility: 'workspace',
        default_assignee_behavior: 'team',
      })
      .select(workspaceTeamSelectColumns)
      .single();

    if (teamInsert.error) throw teamInsert.error;

    const memberInsert = await supabase.from('workspace_team_members').insert({
      workspace_id: workspaceId,
      team_id: teamInsert.data.id,
      user_id: req.authUser.id,
      role: 'lead',
      created_by: req.authUser.id,
    });
    if (memberInsert.error) throw memberInsert.error;

    if (selectedMemberIds.length > 0) {
      const teamMemberInsert = await supabase.from('workspace_team_members').insert(
        selectedMemberIds.map((userId) => ({
          workspace_id: workspaceId,
          team_id: teamInsert.data.id,
          user_id: userId,
          role: 'member',
          created_by: req.authUser.id,
        }))
      );
      if (teamMemberInsert.error) throw teamMemberInsert.error;
    }

    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.created',
      targetType: 'workspace_team',
      targetId: teamInsert.data.id,
      metadata: {
        name,
        identifier,
        color,
        member_count: selectedMemberIds.length + 1,
      },
    });

    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const createdTeam = teams.find((team) => team.id === teamInsert.data.id) ?? null;
    res.status(201).json({ team: createdTeam ?? teamInsert.data, current_user_role: 'lead' });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/teams/:teamId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    await ensureTeamManageAccess({ userId: req.authUser.id, teamId, workspaceId });

    const update = { updated_at: new Date().toISOString(), updated_by: req.authUser.id };
    if (req.body?.name !== undefined) {
      const name = String(req.body.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'Team name is required' });
      update.name = name;
    }
    if (req.body?.identifier !== undefined) {
      const identifier = normalizeTeamIdentifier(req.body.identifier);
      if (!identifier) return res.status(400).json({ error: 'Team identifier is required' });
      const existingIdentifier = await supabase
        .from('workspace_teams')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('identifier', identifier)
        .neq('id', teamId)
        .maybeSingle();
      if (existingIdentifier.error) throw existingIdentifier.error;
      if (existingIdentifier.data?.id) {
        return res.status(409).json({ error: 'Identifier already in use' });
      }
      update.identifier = identifier;
    }
    if (req.body?.description !== undefined) update.description = normalizeNullableText(req.body.description);
    if (req.body?.color !== undefined) update.color = normalizeNullableText(req.body.color) || '#FF5F40';
    if (req.body?.default_task_scope !== undefined) {
      const scope = String(req.body.default_task_scope ?? '').toLowerCase();
      update.default_task_scope = scope === 'today' ? 'today' : 'long_term';
    }
    if (req.body?.default_project_visibility !== undefined) {
      const visibility = String(req.body.default_project_visibility ?? '').toLowerCase();
      update.default_project_visibility = visibility === 'team' ? 'team' : 'workspace';
    }
    if (req.body?.default_assignee_behavior !== undefined) {
      const assigneeBehavior = String(req.body.default_assignee_behavior ?? '').toLowerCase();
      update.default_assignee_behavior = assigneeBehavior === 'lead' ? 'lead' : 'team';
    }

    const updated = await supabase
      .from('workspace_teams')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', teamId)
      .select(workspaceTeamSelectColumns)
      .single();

    if (updated.error) throw updated.error;
    const changedFields = Object.keys(req.body ?? {}).filter((key) =>
      [
        'name',
        'identifier',
        'description',
        'color',
        'default_task_scope',
        'default_project_visibility',
        'default_assignee_behavior',
      ].includes(key)
    );
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.updated',
      targetType: 'workspace_team',
      targetId: teamId,
      metadata: {
        changed_fields: changedFields,
      },
    });
    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const team = teams.find((item) => item.id === teamId) ?? null;
    res.json({ team: team ?? updated.data });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/teams/:teamId/members', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const userId = normalizeNullableText(req.body?.user_id);
    if (!userId) return res.status(400).json({ error: 'Member user id is required' });

    const teamRecord = await loadWorkspaceTeamById(teamId, workspaceId);
    if (!teamRecord) return res.status(404).json({ error: 'Team not found' });

    const workspaceMember = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (workspaceMember.error) throw workspaceMember.error;
    if (!workspaceMember.data?.user_id && userId !== req.authUser.id) {
      return res.status(404).json({ error: 'Workspace member not found' });
    }

    const requestedRole = String(req.body?.role ?? 'member').toLowerCase();
    const role = teamRoleValues.includes(requestedRole) ? requestedRole : 'member';
    const insert = await supabase
      .from('workspace_team_members')
      .upsert(
        {
          workspace_id: workspaceId,
          team_id: teamId,
          user_id: userId,
          role,
          created_by: req.authUser.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,user_id' }
      )
      .select('id')
      .single();

    if (insert.error) throw insert.error;
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.member_added',
      targetType: 'workspace_team_member',
      targetId: insert.data.id,
      metadata: {
        team_id: teamId,
        user_id: userId,
        role,
      },
    });
    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const team = teams.find((item) => item.id === teamId) ?? null;
    res.json({ team });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/teams/:teamId/members/:userId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    const userId = String(req.params.userId);
    await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const requestedRole = String(req.body?.role ?? '').toLowerCase();
    if (!teamRoleValues.includes(requestedRole)) {
      return res.status(400).json({ error: 'Invalid team role' });
    }

    const membership = await supabase
      .from('workspace_team_members')
      .select('id, role, created_at')
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data?.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const previousRole = String(membership.data.role ?? 'member').toLowerCase();
    const leadCountResult = await supabase
      .from('workspace_team_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('role', 'lead');
    if (leadCountResult.error) throw leadCountResult.error;

    if (previousRole === 'lead' && requestedRole !== 'lead' && Number(leadCountResult.count ?? 0) <= 1) {
      return res.status(409).json({ error: 'Assign another lead before changing the final lead role.' });
    }

    const updated = await supabase
      .from('workspace_team_members')
      .update({
        role: requestedRole,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .select('id, workspace_id, team_id, user_id, role, created_by, created_at, updated_at')
      .single();

    if (updated.error) throw updated.error;

    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.member_role_updated',
      targetType: 'workspace_team_member',
      targetId: userId,
      metadata: {
        team_id: teamId,
        previous_role: previousRole,
        next_role: requestedRole,
      },
    });

    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const team = teams.find((item) => item.id === teamId) ?? null;
    res.json({ member: updated.data, team });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/teams/:teamId/members/:userId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    const userId = String(req.params.userId);
    await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const membership = await supabase
      .from('workspace_team_members')
      .select('id, role, created_at')
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data?.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const leadCountResult = await supabase
      .from('workspace_team_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('role', 'lead');
    if (leadCountResult.error) throw leadCountResult.error;

    if (String(membership.data.role ?? '').toLowerCase() === 'lead' && Number(leadCountResult.count ?? 0) <= 1) {
      return res.status(409).json({ error: 'Assign another lead before removing the final lead.' });
    }

    const deleted = await supabase
      .from('workspace_team_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('user_id', userId);

    if (deleted.error) throw deleted.error;
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.member_removed',
      targetType: 'workspace_team_member',
      targetId: userId,
      metadata: {
        team_id: teamId,
        removed_role: String(membership.data.role ?? 'member').toLowerCase(),
      },
    });
    const teams = await loadWorkspaceTeams(workspaceId, req.authUser.id, { includeArchived: true });
    const team = teams.find((item) => item.id === teamId) ?? null;
    res.json({ team });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/teams/:teamId/archive', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const update = {
      archived_at: new Date().toISOString(),
      archived_by: req.authUser.id,
      updated_at: new Date().toISOString(),
      updated_by: req.authUser.id,
    };

    const archived = await supabase
      .from('workspace_teams')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', teamId)
      .select(workspaceTeamSelectColumns)
      .single();

    if (archived.error) throw archived.error;
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.archived',
      targetType: 'workspace_team',
      targetId: teamId,
      metadata: {},
    });
    res.json({ team: archived.data });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/teams/:teamId/unarchive', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const update = {
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
      updated_by: req.authUser.id,
    };

    const restored = await supabase
      .from('workspace_teams')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', teamId)
      .select(workspaceTeamSelectColumns)
      .single();

    if (restored.error) throw restored.error;
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.unarchived',
      targetType: 'workspace_team',
      targetId: teamId,
      metadata: {},
    });
    res.json({ team: restored.data });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/teams/:teamId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    const context = await requireTeamAdmin(req.authUser.id, teamId, workspaceId);

    const archiveResult = await supabase
      .from('workspace_teams')
      .update({
        archived_at: context.team.archived_at ?? new Date().toISOString(),
        archived_by: context.team.archived_by ?? req.authUser.id,
        updated_at: new Date().toISOString(),
        updated_by: req.authUser.id,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', teamId)
      .select(workspaceTeamSelectColumns)
      .maybeSingle();
    if (archiveResult.error) throw archiveResult.error;

    await detachTeamReferences({ workspaceId, teamId });

    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'team.deleted',
      targetType: 'workspace_team',
      targetId: teamId,
      metadata: {
        archived_at: context.team.archived_at ?? new Date().toISOString(),
      },
    });

    const deleted = await supabase.from('workspace_teams').delete().eq('workspace_id', workspaceId).eq('id', teamId);
    if (deleted.error) throw deleted.error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    const query = String(req.query?.query ?? req.query?.q ?? '').trim().toLowerCase();
    const projectNameById = new Map(data.projectRows.map((project) => [project.id, project.name ?? 'Project']));

    const buildPersonSearchText = (person) => {
      const sections = [
        person.name,
        person.email,
        person.role,
        person.workspace_role,
        person.team_labels?.join(' '),
        ...person.teams.map((team) => [team.name, team.role].filter(Boolean).join(' ')),
        ...data.taskRows
          .filter(
            (task) =>
              task.assigned_to_user_id === person.id || task.assigned_by_user_id === person.id
          )
          .map((task) =>
            [
              task.title,
              formatCircleTaskStatus(task.status),
              task.project_id ? projectNameById.get(task.project_id) : null,
            ]
              .filter(Boolean)
              .join(' ')
          ),
        ...data.projectRows
          .filter(
            (project) =>
              project.lead_id === person.id ||
              project.created_by === person.id ||
              data.taskRows.some(
                (task) => task.project_id === project.id && task.assigned_to_user_id === person.id
              )
          )
          .map((project) =>
            [project.name ?? 'Project', formatCircleProjectStatus(project.status), project.color]
              .filter(Boolean)
              .join(' ')
          ),
        ...data.auditRows
          .filter((row) => row.actor_user_id === person.id)
          .map((row) =>
            [
              circleActivityActionLabels[row.action] ?? titleCaseLabel(row.action),
              row.target_type,
              row.metadata?.role,
              row.metadata?.next_role,
            ]
              .filter(Boolean)
              .join(' ')
          ),
      ];

      return sections.filter(Boolean).join(' ').toLowerCase();
    };

    const people = query
      ? data.people.filter((person) => {
          const text = buildPersonSearchText(person);
          if (!text) return false;
          return query
            .split(/\s+/)
            .filter(Boolean)
            .every((term) => text.includes(term));
        })
      : data.people;

    res.json({
      workspace_id: workspaceId,
      workspace_name: data.workspace?.name ?? 'Workspace',
      current_user_id: req.authUser.id,
      people,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people/:id', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    const person = data.peopleById.get(personId);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json({
      workspace_id: workspaceId,
      workspace_name: data.workspace?.name ?? 'Workspace',
      current_user_id: req.authUser.id,
      person,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people/:id/work', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    const person = data.peopleById.get(personId);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const assignedTasks = data.taskRows
      .filter((task) => task.assigned_to_user_id === personId)
      .map(data.buildTaskRow)
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')));
    const waitingOnThem = data.taskRows
      .filter(
        (task) =>
          task.assigned_to_user_id === personId &&
          task.assigned_by_user_id === req.authUser.id &&
          isCircleOpenTask(task)
      )
      .map(data.buildTaskRow)
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')));
    const waitingOnMe = data.taskRows
      .filter(
        (task) =>
          task.assigned_to_user_id === req.authUser.id &&
          task.assigned_by_user_id === personId &&
          isCircleOpenTask(task)
      )
      .map(data.buildTaskRow)
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')));
    const needsAttention = [
      ...assignedTasks.filter((task) => task.is_overdue),
      ...waitingOnThem,
      ...waitingOnMe.filter((task) => task.is_overdue),
    ]
      .filter((item, index, array) => array.findIndex((entry) => entry.id === item.id) === index)
      .slice(0, 10);

    res.json({
      person,
      summary: {
        open_task_count: person.open_task_count,
        shared_project_count: person.shared_project_count,
        follow_up_count: person.follow_up_count,
        waiting_on_count: person.waiting_on_count,
        waiting_on_me_count: waitingOnMe.length,
        waiting_on_them_count: waitingOnThem.length,
      },
      assigned_tasks: assignedTasks,
      waiting_on_me: waitingOnMe,
      waiting_on_them: waitingOnThem,
      needs_attention: needsAttention,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people/:id/projects', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    const person = data.peopleById.get(personId);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const currentUserProjectIds = new Set(
      data.taskRows
        .filter((task) => task.assigned_to_user_id === req.authUser.id && task.project_id)
        .map((task) => task.project_id)
    );
    for (const project of data.projectRows) {
      if (project.lead_id === req.authUser.id || project.created_by === req.authUser.id) {
        currentUserProjectIds.add(project.id);
      }
    }

    const personProjectIds = new Set(
      data.taskRows
        .filter((task) => task.assigned_to_user_id === personId && task.project_id)
        .map((task) => task.project_id)
    );
    for (const project of data.projectRows) {
      if (project.lead_id === personId || project.created_by === personId) {
        personProjectIds.add(project.id);
      }
    }

    const sharedProjectIds = [...personProjectIds].filter((projectId) => currentUserProjectIds.has(projectId));
    const projects = data.projectRows
      .filter((project) => sharedProjectIds.includes(project.id))
      .map((project) => data.buildProjectRow(project, personId))
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')));

    res.json({
      person,
      shared_projects: projects,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people/:id/follow-ups', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    if (!data.peopleById.has(personId)) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json({
      available: false,
      items: [],
      message: 'Follow-ups are not enabled yet.',
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/people/:id/activity', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    const person = data.peopleById.get(personId);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const projectNameById = new Map(data.projectRows.map((project) => [project.id, project.name ?? 'Project']));
    const activity = [];

    for (const task of data.taskRows) {
      if (task.assigned_to_user_id !== personId && task.assigned_by_user_id !== personId) continue;
      const projectName = task.project_id ? projectNameById.get(task.project_id) ?? 'Project' : null;
      const taskLabel = task.title ?? 'Untitled task';
      const timestamp = task.completed_at ?? task.updated_at ?? task.assigned_at ?? task.created_at;
      let title = 'Updated task';
      if (task.completed_at) {
        title = 'Completed task';
      } else if (task.assigned_by_user_id === personId) {
        title = 'Assigned task';
      } else if (task.assigned_to_user_id === personId) {
        title = 'Received task';
      }

      activity.push({
        id: `task:${task.id}`,
        kind: 'task',
        title,
        detail: [taskLabel, projectName].filter(Boolean).join(' · '),
        timestamp,
        task_id: task.id,
        project_id: task.project_id ?? null,
      });
    }

    for (const project of data.projectRows) {
      if (project.created_by !== personId && project.lead_id !== personId) continue;
      activity.push({
        id: `project:${project.id}`,
        kind: 'project',
        title: project.created_by === personId ? 'Created project' : 'Updated project',
        detail: project.name ?? 'Untitled project',
        timestamp: project.updated_at ?? project.created_at ?? null,
        project_id: project.id,
      });
    }

    for (const row of data.auditRows) {
      if (row.actor_user_id !== personId) continue;
      activity.push({
        id: `audit:${row.id}`,
        kind: 'audit',
        title: circleActivityActionLabels[row.action] ?? titleCaseLabel(row.action),
        detail: [row.target_type, row.metadata?.role ?? row.metadata?.next_role ?? null]
          .filter(Boolean)
          .join(' · '),
        timestamp: row.created_at,
      });
    }

    activity.sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));

    res.json({
      person,
      activity: activity.slice(0, 50),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/people/:id/preferences', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const personId = String(req.params.id);
    const data = await loadCircleWorkspacePeople(workspaceId, req.authUser.id);
    if (!data.peopleById.has(personId)) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const existing = data.preferenceByPersonId.get(personId) ?? null;
    const nextPinned =
      req.body?.is_pinned === undefined ? existing?.is_pinned ?? false : Boolean(req.body.is_pinned);
    const nextSortOrder =
      req.body?.sort_order === undefined
        ? existing?.sort_order ?? 0
        : Math.max(0, Number(req.body.sort_order) || 0);
    const nowIso = new Date().toISOString();
    const existingPinResult = await supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('object_type', 'person')
      .eq('object_id', personId)
      .maybeSingle();
    if (existingPinResult.error) throw existingPinResult.error;

    const { data: updated, error } = await supabase
      .from('person_preferences')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          person_user_id: personId,
          is_pinned: nextPinned,
          sort_order: nextSortOrder,
          updated_at: nowIso,
          created_at: existing?.created_at ?? nowIso,
        },
        { onConflict: 'workspace_id,user_id,person_user_id' }
      )
      .select(personPreferenceSelectColumns)
      .single();

    if (error) throw error;

    if (nextPinned) {
      const pinUpsert = await supabase
        .from('user_pins')
        .upsert(
          {
            workspace_id: workspaceId,
            user_id: req.authUser.id,
            object_type: 'person',
            object_id: personId,
            folder_id: null,
            sort_order: nextSortOrder,
            updated_at: nowIso,
            created_at: existingPinResult.data?.created_at ?? nowIso,
          },
          { onConflict: 'workspace_id,user_id,object_type,object_id' }
        )
        .select(pinSelectColumns)
        .single();
      if (pinUpsert.error) throw pinUpsert.error;
    } else {
      const pinDelete = await supabase
        .from('user_pins')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('user_id', req.authUser.id)
        .eq('object_type', 'person')
        .eq('object_id', personId);
      if (pinDelete.error) throw pinDelete.error;
    }

    res.json({
      preference: updated,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/pins', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

    const pinRows = await loadUserPinsForWorkspace({ workspaceId, userId: req.authUser.id });
    const invalidPinIds = [];

    const pins = (
      await Promise.all(
        pinRows.map(async (pinRow) => {
          const target = await resolvePinnedObjectTargetSummary({
            workspaceId,
            userId: req.authUser.id,
            objectType: pinRow.object_type,
            objectId: pinRow.object_id,
          });
          if (!target) {
            invalidPinIds.push(pinRow.id);
            return null;
          }
          return buildPinnedRecordResponse(pinRow, target);
        })
      )
    ).filter(Boolean);

    if (invalidPinIds.length > 0) {
      const cleanup = await supabase.from('user_pins').delete().in('id', invalidPinIds);
      if (cleanup.error) throw cleanup.error;
    }

    res.json({
      workspace_id: workspaceId,
      current_user_id: req.authUser.id,
      pins,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/pin-folders', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const folders = await loadPinFoldersForWorkspace({ workspaceId, userId: req.authUser.id });
    res.json({
      workspace_id: workspaceId,
      current_user_id: req.authUser.id,
      folders,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/pin-folders', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const sortOrder =
      req.body?.sort_order === undefined
        ? await getNextPinSortOrder({ workspaceId, userId: req.authUser.id, folderId: null })
        : Math.max(0, Number(req.body.sort_order) || 0);
    const collapsed = Boolean(req.body?.collapsed ?? false);
    const nowIso = new Date().toISOString();

    const result = await supabase
      .from('pin_folders')
      .insert({
        workspace_id: workspaceId,
        user_id: req.authUser.id,
        name,
        sort_order: sortOrder,
        collapsed,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(pinFolderSelectColumns)
      .single();

    if (result.error) throw result.error;
    res.json({ folder: result.data });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/pin-folders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const folderId = String(req.params.id);
    const folder = await loadPinFolderById({
      folderId,
      workspaceId,
      userId: req.authUser.id,
    });
    if (!folder?.id) {
      return res.status(404).json({ error: 'Pin folder not found' });
    }

    const nextName =
      req.body?.name === undefined ? folder.name : String(req.body.name ?? '').trim();
    if (!nextName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const nextCollapsed =
      req.body?.collapsed === undefined ? Boolean(folder.collapsed) : Boolean(req.body.collapsed);
    const nextSortOrder =
      req.body?.sort_order === undefined
        ? folder.sort_order ?? 0
        : Math.max(0, Number(req.body.sort_order) || 0);

    const result = await supabase
      .from('pin_folders')
      .update({
        name: nextName,
        collapsed: nextCollapsed,
        sort_order: nextSortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', folderId)
      .select(pinFolderSelectColumns)
      .single();

    if (result.error) throw result.error;
    res.json({ folder: result.data });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/pin-folders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const folderId = String(req.params.id);
    const folder = await loadPinFolderById({
      folderId,
      workspaceId,
      userId: req.authUser.id,
    });
    if (!folder?.id) {
      return res.status(404).json({ error: 'Pin folder not found' });
    }

    const folderPinsResult = await supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('folder_id', folderId)
      .order('sort_order', { ascending: true });
    if (folderPinsResult.error) throw folderPinsResult.error;

    const nextRootSortOrder = await getNextPinSortOrder({
      workspaceId,
      userId: req.authUser.id,
      folderId: null,
    });

    for (const [index, pinRow] of (folderPinsResult.data ?? []).entries()) {
      const updateResult = await supabase
        .from('user_pins')
        .update({
          folder_id: null,
          sort_order: nextRootSortOrder + index,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('user_id', req.authUser.id)
        .eq('id', pinRow.id);
      if (updateResult.error) throw updateResult.error;

      if (String(pinRow.object_type) === 'person') {
        const syncResult = await syncLegacyPersonPreferencePin({
          workspaceId,
          userId: req.authUser.id,
          personId: pinRow.object_id,
          isPinned: true,
          sortOrder: nextRootSortOrder + index,
        });
        if (syncResult?.error) throw syncResult.error;
      }
    }

    const deleteResult = await supabase
      .from('pin_folders')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', folderId);
    if (deleteResult.error) throw deleteResult.error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/pin-folders/reorder', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const folderItems = Array.isArray(req.body?.folders) ? req.body.folders : [];

    const folders = await loadPinFoldersForWorkspace({ workspaceId, userId: req.authUser.id });
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));

    for (const [index, folderItem] of folderItems.entries()) {
      const folderId = String(folderItem?.id ?? '').trim();
      if (!folderId || !folderById.has(folderId)) {
        return res.status(404).json({ error: 'Pin folder not found' });
      }

      const updateResult = await supabase
        .from('pin_folders')
        .update({
          sort_order:
            folderItem?.sort_order === undefined ? index : Math.max(0, Number(folderItem.sort_order) || 0),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('user_id', req.authUser.id)
        .eq('id', folderId);
      if (updateResult.error) throw updateResult.error;
    }

    const nextFolders = await loadPinFoldersForWorkspace({ workspaceId, userId: req.authUser.id });
    res.json({ folders: nextFolders });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/pins', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const objectType = normalizePinObjectType(req.body?.object_type);
    const objectId = String(req.body?.object_id ?? '').trim();
    if (!objectType || !objectId) {
      return res.status(400).json({ error: 'Pin target is required' });
    }

    const target = await resolvePinnedObjectTargetSummary({
      workspaceId,
      userId: req.authUser.id,
      objectType,
      objectId,
    });
    if (!target) {
      return res.status(404).json({ error: 'Pinned object not found' });
    }

    const existingResult = await supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('object_type', objectType)
      .eq('object_id', objectId)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;

    const folderId =
      req.body?.folder_id === undefined
        ? existingResult.data?.folder_id ?? null
        : String(req.body.folder_id ?? '').trim() || null;
    if (folderId) {
      const folder = await loadPinFolderById({
        folderId,
        workspaceId,
        userId: req.authUser.id,
      });
      if (!folder?.id) {
        return res.status(404).json({ error: 'Pin folder not found' });
      }
    }

    const nextSortOrder =
      req.body?.sort_order === undefined
        ? existingResult.data?.sort_order ??
          (await getNextPinSortOrder({
            workspaceId,
            userId: req.authUser.id,
            folderId,
          }))
        : Math.max(0, Number(req.body.sort_order) || 0);
    const nowIso = new Date().toISOString();

    const result = await supabase
      .from('user_pins')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: req.authUser.id,
          object_type: objectType,
          object_id: objectId,
          folder_id: folderId,
          sort_order: nextSortOrder,
          updated_at: nowIso,
          created_at: existingResult.data?.created_at ?? nowIso,
        },
        { onConflict: 'workspace_id,user_id,object_type,object_id' }
      )
      .select(pinSelectColumns)
      .single();

    if (result.error) throw result.error;

    if (objectType === 'person') {
      const syncResult = await syncLegacyPersonPreferencePin({
        workspaceId,
        userId: req.authUser.id,
        personId: objectId,
        isPinned: true,
        sortOrder: nextSortOrder,
      });
      if (syncResult?.error) throw syncResult.error;
    }

    res.json({
      pin: buildPinnedRecordResponse(result.data, target),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/pins/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const pinId = String(req.params.id);
    const existingResult = await supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', pinId)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data?.id) {
      return res.status(404).json({ error: 'Pin not found' });
    }

    const nextFolderId =
      req.body?.folder_id === undefined ? existingResult.data.folder_id ?? null : String(req.body.folder_id ?? '').trim() || null;
    if (nextFolderId) {
      const folder = await loadPinFolderById({
        folderId: nextFolderId,
        workspaceId,
        userId: req.authUser.id,
      });
      if (!folder?.id) {
        return res.status(404).json({ error: 'Pin folder not found' });
      }
    }

    const nextSortOrder =
      req.body?.sort_order === undefined
        ? existingResult.data.sort_order
        : Math.max(0, Number(req.body.sort_order) || 0);

    const result = await supabase
      .from('user_pins')
      .update({
        folder_id: nextFolderId,
        sort_order: nextSortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', pinId)
      .select(pinSelectColumns)
      .single();

    if (result.error) throw result.error;
    const target = await resolvePinnedObjectTargetSummary({
      workspaceId,
      userId: req.authUser.id,
      objectType: result.data.object_type,
      objectId: result.data.object_id,
    });
    if (!target) {
      await supabase.from('user_pins').delete().eq('workspace_id', workspaceId).eq('user_id', req.authUser.id).eq('id', pinId);
      return res.status(404).json({ error: 'Pinned object not found' });
    }

    if (String(result.data.object_type) === 'person') {
      const syncResult = await syncLegacyPersonPreferencePin({
        workspaceId,
        userId: req.authUser.id,
        personId: result.data.object_id,
        isPinned: true,
        sortOrder: nextSortOrder,
      });
      if (syncResult?.error) throw syncResult.error;
    }

    res.json({ pin: buildPinnedRecordResponse(result.data, target) });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/pins/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const pinId = String(req.params.id);
    const existingResult = await supabase
      .from('user_pins')
      .select(pinSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', pinId)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data?.id) {
      return res.status(404).json({ error: 'Pin not found' });
    }

    const deleteResult = await supabase
      .from('user_pins')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.authUser.id)
      .eq('id', pinId);
    if (deleteResult.error) throw deleteResult.error;

    if (String(existingResult.data.object_type) === 'person') {
      const syncResult = await syncLegacyPersonPreferencePin({
        workspaceId,
        userId: req.authUser.id,
        personId: existingResult.data.object_id,
        isPinned: false,
        sortOrder: existingResult.data.sort_order,
      });
      if (syncResult?.error) throw syncResult.error;
    }

    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/pins/reorder', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const pinItems = Array.isArray(req.body?.pins) ? req.body.pins : [];
    if (pinItems.length === 0) {
      return res.json({ pins: [] });
    }

    const existingPins = await loadUserPinsForWorkspace({ workspaceId, userId: req.authUser.id });
    const pinById = new Map(existingPins.map((pin) => [pin.id, pin]));

    for (const [index, pinItem] of pinItems.entries()) {
      const pinId = String(pinItem?.id ?? '').trim();
      const existingPin = pinById.get(pinId);
      if (!pinId || !existingPin) {
        return res.status(404).json({ error: 'Pin not found' });
      }

      const nextFolderId =
        pinItem?.folder_id === undefined ? existingPin.folder_id ?? null : String(pinItem.folder_id ?? '').trim() || null;
      if (nextFolderId) {
        const folder = await loadPinFolderById({
          folderId: nextFolderId,
          workspaceId,
          userId: req.authUser.id,
        });
        if (!folder?.id) {
          return res.status(404).json({ error: 'Pin folder not found' });
        }
      }

      const updateResult = await supabase
        .from('user_pins')
        .update({
          folder_id: nextFolderId,
          sort_order:
            pinItem?.sort_order === undefined ? index : Math.max(0, Number(pinItem.sort_order) || 0),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('user_id', req.authUser.id)
        .eq('id', pinId);
      if (updateResult.error) throw updateResult.error;

      if (String(existingPin.object_type) === 'person') {
        const syncResult = await syncLegacyPersonPreferencePin({
          workspaceId,
          userId: req.authUser.id,
          personId: existingPin.object_id,
          isPinned: true,
          sortOrder: pinItem?.sort_order === undefined ? index : Math.max(0, Number(pinItem.sort_order) || 0),
        });
        if (syncResult?.error) throw syncResult.error;
      }
    }

    const nextPins = await loadUserPinsForWorkspace({ workspaceId, userId: req.authUser.id });
    res.json({ pins: nextPins });
  } catch (error) {
    return respondWithError(res, error);
  }
});

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
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
      const name = String(req.body?.name ?? '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Project name required' });
      }

      const description = normalizeNullableText(req.body?.description);
      const startDate = normalizeNullableDate(req.body?.start_date, 'start date');
      const endDate = normalizeNullableDate(req.body?.end_date, 'end date');
      const color = normalizeNullableText(req.body?.color);
      const projectType = normalizeProjectType(req.body?.project_type);
      const leadId = normalizeNullableText(req.body?.lead_id);
      const ownerTeamId = normalizeNullableText(req.body?.owner_team_id);
      const githubRepositoryId = normalizeNullableText(req.body?.github_repository_id);
      if (ownerTeamId) {
        const teamAllowed = await ensureWorkspaceTeam(ownerTeamId, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      const status = req.body?.status
        ? projectStatusAliases[normalizeProjectSemanticStatus(req.body.status)][0]
        : 'NotStarted';

      const { data: existingProject, error: existingError } = await supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', workspaceId)
        .ilike('name', name)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existingProject) {
        if (githubRepositoryId) await linkGithubRepositoryToProject({ workspaceId, projectId: existingProject.id, repositoryId: githubRepositoryId, role: 'primary', userId: req.authUser.id });
        return res.json(existingProject);
      }

      const { data, error } = await supabase
        .from('projects')
        .insert({
          workspace_id: workspaceId,
          created_by: req.authUser.id,
          name,
          description,
          status,
          completeness: 0,
          color: color || '#007AFF',
          start_date: startDate,
          end_date: endDate,
          project_type: projectType,
          lead_id: leadId,
          owner_team_id: ownerTeamId,
        })
        .select(projectSelectColumns)
        .single();

      if (error) throw error;
      if (githubRepositoryId) {
        try {
          await linkGithubRepositoryToProject({ workspaceId, projectId: data.id, repositoryId: githubRepositoryId, role: 'primary', userId: req.authUser.id });
        } catch (linkError) {
          await supabase.from('projects').delete().eq('workspace_id', workspaceId).eq('id', data.id);
          throw linkError;
        }
      }
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
    if (req.body?.project_type !== undefined)
      update.project_type = normalizeProjectType(req.body.project_type);
    if (req.body?.lead_id !== undefined)
      update.lead_id = normalizeNullableText(req.body.lead_id);
    if (req.body?.owner_team_id !== undefined) {
      const ownerTeamId = normalizeNullableText(req.body.owner_team_id);
      if (ownerTeamId) {
        const teamAllowed = await ensureWorkspaceTeam(ownerTeamId, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      update.owner_team_id = ownerTeamId;
    }
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

app.get('/api/projects/:id/github-repositories', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'viewer');
    if (!(await ensureWorkspaceResource('projects', req.params.id, workspaceId))) return res.status(404).json({ error: 'Project not found' });
    const links = await getProjectGithubRepositoryLinks(workspaceId, req.params.id);
    res.json(links.map(mapProjectGithubRepositoryLink));
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/projects/:id/github-repositories', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const role = req.body?.role === 'supporting' ? 'supporting' : 'primary';
    const link = await linkGithubRepositoryToProject({ workspaceId, projectId: req.params.id, repositoryId: req.body?.repository_id, role, userId: req.authUser.id });
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_repository_linked_to_project', targetType: 'project', targetId: req.params.id, metadata: { external_reference_id: link.external_reference_id, role } });
    res.status(201).json(mapProjectGithubRepositoryLink(link));
  } catch (error) { return respondWithError(res, error); }
});

app.patch('/api/projects/:id/github-repositories/:linkId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const link = await supabase.from('external_reference_links').select('id, external_reference_id, target_type, target_id, link_metadata').eq('workspace_id', workspaceId).eq('id', req.params.linkId).eq('target_type', 'project').eq('target_id', req.params.id).maybeSingle();
    if (link.error) throw link.error;
    if (!link.data) return res.status(404).json({ error: 'Project repository link not found' });
    const role = req.body?.role === 'primary' ? 'primary' : 'supporting';
    if (role === 'primary') {
      const primary = await supabase.rpc('set_primary_external_reference_link', { p_workspace_id: workspaceId, p_link_id: link.data.id });
      if (primary.error) throw primary.error;
    } else {
      const updated = await supabase.from('external_reference_links').update({ link_metadata: { ...(link.data.link_metadata ?? {}), role: 'supporting' } }).eq('workspace_id', workspaceId).eq('id', link.data.id);
      if (updated.error) throw updated.error;
    }
    const links = await getProjectGithubRepositoryLinks(workspaceId, req.params.id);
    const result = links.find((item) => item.id === link.data.id);
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_project_repository_role_changed', targetType: 'project', targetId: req.params.id, metadata: { external_reference_id: link.data.external_reference_id, role } });
    res.json(mapProjectGithubRepositoryLink(result));
  } catch (error) { return respondWithError(res, error); }
});

app.delete('/api/projects/:id/github-repositories/:linkId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');
    const link = await supabase.from('external_reference_links').select('id, external_reference_id').eq('workspace_id', workspaceId).eq('id', req.params.linkId).eq('target_type', 'project').eq('target_id', req.params.id).maybeSingle();
    if (link.error) throw link.error;
    if (!link.data) return res.status(404).json({ error: 'Project repository link not found' });
    const removed = await supabase.from('external_reference_links').delete().eq('workspace_id', workspaceId).eq('id', link.data.id);
    if (removed.error) throw removed.error;
    await writeWorkspaceAuditLog({ workspaceId, actorUserId: req.authUser.id, action: 'github_repository_unlinked_from_project', targetType: 'project', targetId: req.params.id, metadata: { external_reference_id: link.data.external_reference_id } });
    res.json({ removed: true });
  } catch (error) { return respondWithError(res, error); }
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
        .select('id, title, preview, updated_at')
        .eq('workspace_id', workspaceId)
        .in('id', noteIds);
      if (notesResult.error) throw notesResult.error;
      noteById = new Map((notesResult.data ?? []).map((note) => [note.id, note]));
    }

    const links = (data ?? [])
      .map((row) => {
        const note = noteById.get(row.note_id);
        if (!note) return null;
        return {
          id: row.id,
          note_id: row.note_id,
          created_at: row.created_at,
          note: {
            id: note.id,
            title: note.title || 'Untitled note',
            preview: String(note.preview ?? '').slice(0, 160),
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

app.get('/api/workspaces/:workspaceId/project-note-links', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId);
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member');

    const { data, error } = await supabase
      .from('project_note_links')
      .select('id, project_id, note_id, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const projectIds = [...new Set((data ?? []).map((row) => row.project_id).filter(Boolean))];
    const projectsResult =
      projectIds.length > 0
        ? await supabase
            .from('projects')
            .select('id, name, status, completeness, end_date')
            .eq('workspace_id', workspaceId)
            .in('id', projectIds)
        : { data: [], error: null };
    if (projectsResult.error) throw projectsResult.error;

    const projectMap = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));

    const links = (data ?? [])
      .map((row) => {
        const project = projectMap.get(row.project_id);
        if (!project) return null;
        return {
          id: row.id,
          note_id: row.note_id,
          project_id: row.project_id,
          project_name: project.name || 'Untitled project',
          project_status: project.status ?? null,
          project_completeness: project.completeness ?? null,
          project_end_date: project.end_date ?? null,
          created_at: row.created_at,
        };
      })
      .filter(Boolean);

    res.json({
      current_user_role: access.role,
      links,
    });
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
      .select('id, title, preview, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', noteId)
      .single();
    if (noteResult.error) throw noteResult.error;
    const note = noteResult.data;

    res.json({
      id: data.id,
      note_id: data.note_id,
      created_at: data.created_at,
      note: {
        id: note.id,
        title: note.title || 'Untitled note',
        preview: String(note.preview ?? '').slice(0, 160),
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

app.post('/api/teams/:teamId/notes', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    const noteId = String(req.body?.note_id ?? '').trim();
    if (!noteId) {
      return res.status(400).json({ error: 'note_id is required' });
    }

    const [teamAllowed, noteAllowed] = await Promise.all([
      ensureWorkspaceTeam(teamId, workspaceId),
      ensureWorkspaceResource('notes', noteId, workspaceId),
    ]);

    if (!teamAllowed) return res.status(404).json({ error: 'Team not found' });
    if (!noteAllowed) return res.status(404).json({ error: 'Note not found' });

    const existing = await supabase
      .from('note_team_links')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('note_id', noteId)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (!existing.data) {
      const insert = await supabase.from('note_team_links').insert({
        workspace_id: workspaceId,
        team_id: teamId,
        note_id: noteId,
        created_by: req.authUser.id,
      });
      if (insert.error) throw insert.error;
    }

    const { data, error } = await supabase
      .from('note_team_links')
      .select('id, note_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('note_id', noteId)
      .single();

    if (error) throw error;

    const noteResult = await supabase
      .from('notes')
      .select('id, title, preview, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', noteId)
      .single();
    if (noteResult.error) throw noteResult.error;
    const note = noteResult.data;

    res.json({
      id: data.id,
      note_id: data.note_id,
      created_at: data.created_at,
      note: {
        id: note.id,
        title: note.title || 'Untitled note',
        preview: String(note.preview ?? '').slice(0, 160),
        updated_at: note.updated_at ?? null,
      },
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/teams/:teamId/notes/:noteId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const teamId = String(req.params.teamId);
    const noteId = String(req.params.noteId);

    const teamAllowed = await ensureWorkspaceTeam(teamId, workspaceId);
    if (!teamAllowed) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const { error } = await supabase
      .from('note_team_links')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('team_id', teamId)
      .eq('note_id', noteId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/overview', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId, team, teamData } = await loadTeamRouteContext(req, teamId);
    await resumeDueInboxItemsForWorkspace(workspaceId);

    const teamProjectRows = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('owner_team_id', teamId)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (teamProjectRows.error) throw teamProjectRows.error;

    const teamProjects = teamProjectRows.data ?? [];
    const teamProjectIds = teamProjects.map((project) => project.id).filter(Boolean);

    const [memberRowsResult, workspaceMembersResult, userLookup, taskRowsResult, noteRowsResult, projectNoteRowsResult, eventRowsResult, reminderRowsResult, inboxRowsResult, auditRowsResult] =
      await Promise.all([
        supabase
          .from('workspace_team_members')
          .select('team_id, user_id, role, created_at')
          .eq('workspace_id', workspaceId)
          .eq('team_id', teamId)
          .order('created_at', { ascending: true }),
        supabase
          .from('workspace_members')
          .select('user_id, role, joined_at')
          .eq('workspace_id', workspaceId),
        loadUsersByIds([
          team.created_by,
          ...teamData.members.map((member) => member.id),
          ...teamProjects.map((project) => project.lead_id ?? project.created_by ?? null).filter(Boolean),
        ]),
        supabase
          .from('tasks')
          .select(taskSelectWithHorizonColumns)
          .eq('workspace_id', workspaceId)
          .or(`assigned_to_team_id.eq.${teamId},assigned_team_id.eq.${teamId}`)
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('note_team_links')
          .select('id, note_id, created_at')
          .eq('workspace_id', workspaceId)
          .eq('team_id', teamId)
          .order('created_at', { ascending: false }),
        teamProjectIds.length
          ? supabase
              .from('project_note_links')
              .select('id, project_id, note_id, created_at')
              .eq('workspace_id', workspaceId)
              .in('project_id', teamProjectIds)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('events')
          .select('id, workspace_id, title, start_at, end_at, all_day, calendar_id, status, notes, location, project_id, note_id, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .or(`assigned_to_team_id.eq.${teamId}${teamProjectIds.length ? `,project_id.in.(${teamProjectIds.join(',')})` : ''}`)
          .order('start_at', { ascending: true })
          .limit(50),
        supabase
          .from('reminders')
          .select('id, workspace_id, title, body, remind_at, status, project_id, note_id, calendar_id, notes, is_done, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .or(`assigned_to_team_id.eq.${teamId}${teamProjectIds.length ? `,project_id.in.(${teamProjectIds.join(',')})` : ''}`)
          .order('remind_at', { ascending: true })
          .limit(50),
        supabase
          .from('inbox_items')
          .select(inboxItemSelectColumns)
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('workspace_audit_logs')
          .select('id, workspace_id, actor_user_id, action, target_type, target_id, metadata, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

    if (memberRowsResult.error) throw memberRowsResult.error;
    if (workspaceMembersResult.error) throw workspaceMembersResult.error;
    if (taskRowsResult.error) throw taskRowsResult.error;
    if (noteRowsResult.error) throw noteRowsResult.error;
    if (projectNoteRowsResult.error) throw projectNoteRowsResult.error;
    if (eventRowsResult.error) throw eventRowsResult.error;
    if (reminderRowsResult.error) throw reminderRowsResult.error;
    if (inboxRowsResult.error) throw inboxRowsResult.error;
    if (auditRowsResult.error) throw auditRowsResult.error;

    const workspaceMemberByUserId = new Map(
      (workspaceMembersResult.data ?? []).map((row) => [row.user_id, row])
    );

    const taskRows = (taskRowsResult.data ?? []).filter((row) => {
      const projectId = row.project_id ?? null;
      return row.assigned_to_team_id === teamId || row.assigned_team_id === teamId || (projectId && teamProjectIds.includes(projectId));
    });
    const openTaskRows = taskRows.filter(isTeamOpenTask);
    const overdueTaskRows = openTaskRows.filter(
      (task) => task.due_date && String(task.due_date) < new Date().toISOString().slice(0, 10)
    );

    const projectById = new Map(teamProjects.map((project) => [project.id, project]));
    const noteLinks = [
      ...(noteRowsResult.data ?? []).map((row) => ({
        note_id: row.note_id,
        project_id: null,
        created_at: row.created_at,
      })),
      ...(projectNoteRowsResult.data ?? []).map((row) => ({
        note_id: row.note_id,
        project_id: row.project_id,
        created_at: row.created_at,
      })),
    ];
    const noteIds = [...new Set(noteLinks.map((row) => row.note_id).filter(Boolean))];
    const notesResult = noteIds.length
      ? await supabase
          .from('notes')
          .select('id, workspace_id, user_id, updated_by, title, preview, section_id, parent_id, updated_at, created_at')
          .eq('workspace_id', workspaceId)
          .in('id', noteIds)
      : { data: [], error: null };
    if (notesResult.error) throw notesResult.error;

    const noteById = new Map((notesResult.data ?? []).map((note) => [note.id, note]));
    const linkedNotes = noteLinks
      .map((link) => {
        const note = noteById.get(link.note_id);
        if (!note) return null;
        return {
          id: note.id,
          title: note.title || 'Untitled note',
          preview: String(note.preview ?? '').slice(0, 160),
          created_by: note.user_id ?? null,
          updated_by: note.updated_by ?? null,
          linked_project: link.project_id ? { id: link.project_id, title: projectById.get(link.project_id)?.name ?? 'Untitled project' } : null,
          updated_at: note.updated_at ?? null,
          created_at: note.created_at ?? null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')))
      .slice(0, 10);
    const noteCount = new Set(noteLinks.map((row) => row.note_id)).size;
    const activeProjectRows = teamProjects.filter((project) => isTeamActiveProject(project));
    const leadCount = teamData.members.filter((member) => member.role === 'lead').length;

    const memberRows = teamData.members.map((member) => {
      const user = userLookup.get(member.id) ?? null;
      const workspaceMember = workspaceMemberByUserId.get(member.id) ?? null;
      const memberTasks = openTaskRows.filter(
        (task) => getTeamTaskAssignmentId(task) === member.id
      );
      const memberProjects = activeProjectRows.filter(
        (project) => project.lead_id === member.id || project.created_by === member.id
      );
      return {
        id: member.id,
        name: member.name,
        avatar: user?.avatar_url ?? null,
        role: workspaceMember?.role ?? 'member',
        team_role: member.role,
        open_work_count: memberTasks.length,
        joined_at: workspaceMember?.joined_at ?? null,
        last_active_at: memberTasks[0]?.updated_at ?? memberProjects[0]?.updated_at ?? null,
      };
    });

    const upcomingWindowEnd = new Date();
    upcomingWindowEnd.setDate(upcomingWindowEnd.getDate() + 30);
    const upcomingItems = [
      ...(eventRowsResult.data ?? [])
        .filter((event) => new Date(event.start_at).getTime() >= Date.now() && new Date(event.start_at).getTime() <= upcomingWindowEnd.getTime())
        .map((event) => ({
          id: event.id,
          title: event.title,
          type: 'event',
          start: event.start_at,
          end: event.end_at,
          project: event.project_id ? projectById.get(event.project_id) ?? null : null,
          note_id: event.note_id ?? null,
          owner: event.assigned_by_user_id ?? null,
          status: event.status ?? null,
        })),
      ...(reminderRowsResult.data ?? [])
        .filter((reminder) => new Date(reminder.remind_at).getTime() >= Date.now() && new Date(reminder.remind_at).getTime() <= upcomingWindowEnd.getTime())
        .map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          type: 'reminder',
          start: reminder.remind_at,
          end: reminder.remind_at,
          project: reminder.project_id ? projectById.get(reminder.project_id) ?? null : null,
        note_id: reminder.note_id ?? null,
        owner: reminder.assigned_by_user_id ?? null,
        status: reminder.is_done ? 'done' : reminder.status ?? 'active',
        })),
    ]
      .sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')))
      .slice(0, 10);

    const intakeRows = (inboxRowsResult.data ?? []).filter((item) => {
      const raw = item.raw_payload ?? {};
      const routedTeamId = String(raw.suggested_team_id ?? raw.team_id ?? '').trim();
      return (
        item.status !== 'converted' &&
        item.status !== 'archived' &&
        routedTeamId === teamId
      );
    });

    const overviewActivity = (auditRowsResult.data ?? [])
      .filter((row) => row.target_type === 'workspace_team_member' || row.target_type === 'workspace_team')
      .map((row) => ({
        id: row.id,
        actor: row.actor_user_id,
        action: titleCaseLabel(row.action),
        object_type: row.target_type,
        object_id: row.target_id ?? null,
        object_title: team.name,
        timestamp: row.created_at,
        metadata: row.metadata ?? null,
      }))
      .slice(0, 5);

    res.json({
      team: {
        id: team.id,
        name: team.name,
        identifier: team.identifier,
        color: team.color ?? '#FF5F40',
        workspace_id: workspaceId,
        member_count: teamData.members.length,
        lead_count: leadCount,
        created_at: team.created_at ?? null,
        updated_at: team.updated_at ?? null,
      },
      summary: {
        open_task_count: openTaskRows.length,
        overdue_task_count: overdueTaskRows.length,
        active_project_count: activeProjectRows.length,
        milestone_count: teamData.projectMilestones.length,
        note_count: noteCount,
        upcoming_event_count: upcomingItems.length,
        intake_needs_review_count: intakeRows.length,
      },
      quick_links: [
        { key: 'overview', team_id: team.id, count: null },
        { key: 'members', team_id: team.id, count: teamData.members.length },
        { key: 'tasks', team_id: team.id, count: openTaskRows.length },
        { key: 'projects', team_id: team.id, count: activeProjectRows.length },
        { key: 'notes', team_id: team.id, count: noteCount },
        { key: 'calendar', team_id: team.id, count: upcomingItems.length },
        { key: 'intake', team_id: team.id, count: intakeRows.length },
        { key: 'activity', team_id: team.id, count: overviewActivity.length },
      ],
      needs_attention: {
        overdue_tasks: overdueTaskRows.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          task_type: task.task_horizon ?? null,
          priority: task.priority ?? null,
          due_date: task.due_date ?? null,
          assignee: task.assigned_to_user_id ?? null,
          project: task.project_id ? projectById.get(task.project_id) ?? null : null,
          blocked: false,
        })),
        overdue_milestones: teamData.projectMilestones
          .filter((milestone) => milestone.status !== 'completed' && milestone.dueDate && String(milestone.dueDate) < new Date().toISOString().slice(0, 10))
          .map((milestone) => ({
            id: milestone.sourceId,
            title: milestone.title,
            project: milestone.projectId ?? null,
            due_date: milestone.dueDate ?? null,
          })),
        intake_items: intakeRows.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          source: item.source,
        })),
      },
      active_projects: activeProjectRows
        .map((project) => ({
          id: project.id,
          title: project.name ?? 'Untitled project',
          status: project.status ?? null,
          progress: project.completeness ?? 0,
          lead: project.lead_id ?? null,
          due_date: project.end_date ?? null,
          next_action_count: openTaskRows.filter((task) => task.project_id === project.id).length,
        }))
        .slice(0, 10),
      assigned_work: openTaskRows.slice(0, 10).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        task_type: task.task_horizon ?? null,
        priority: task.priority ?? null,
        due_date: task.due_date ?? null,
        assignee: task.assigned_to_user_id ?? null,
        project: task.project_id ? projectById.get(task.project_id) ?? null : null,
        blocked: false,
        created_at: task.created_at ?? null,
        updated_at: task.updated_at ?? null,
      })),
      recent_notes: linkedNotes,
      upcoming: upcomingItems,
      members: memberRows,
      recent_activity: overviewActivity,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/members', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId, team, teamData } = await loadTeamRouteContext(req, teamId);
    const [workspaceMembersResult, userMap, projectsResult, taskRowsResult] = await Promise.all([
      supabase
        .from('workspace_members')
        .select('user_id, role, joined_at')
        .eq('workspace_id', workspaceId),
      loadUsersByIds(teamData.members.map((member) => member.id)),
      supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', workspaceId)
        .eq('owner_team_id', teamId),
      supabase
        .from('tasks')
        .select(taskSelectWithHorizonColumns)
        .eq('workspace_id', workspaceId)
        .or(`assigned_to_team_id.eq.${teamId},assigned_team_id.eq.${teamId}`),
    ]);

    if (workspaceMembersResult.error) throw workspaceMembersResult.error;
    if (projectsResult.error) throw projectsResult.error;
    if (taskRowsResult.error) throw taskRowsResult.error;

    const workspaceMemberById = new Map(
      (workspaceMembersResult.data ?? []).map((row) => [row.user_id, row])
    );
    const projects = projectsResult.data ?? [];
    const openTasks = (taskRowsResult.data ?? []).filter(isTeamOpenTask);

    const members = teamData.members.map((member) => {
      const user = userMap.get(member.id) ?? null;
      const workspaceMember = workspaceMemberById.get(member.id) ?? null;
      const memberTasks = openTasks.filter((task) => getTeamTaskAssignmentId(task) === member.id);
      const memberProjects = projects.filter(
        (project) => project.lead_id === member.id || project.created_by === member.id
      );
      const lastActiveAt = [
        workspaceMember?.joined_at ?? null,
        ...memberTasks.map((task) => task.updated_at ?? task.created_at ?? null),
        ...memberProjects.map((project) => project.updated_at ?? project.created_at ?? null),
      ]
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

      return {
        id: member.id,
        name: member.name,
        email: user?.email ?? member.email ?? null,
        avatar: user?.avatar_url ?? null,
        workspace_role: workspaceMember?.role ?? null,
        team_role: member.role,
        is_lead: member.role === 'lead',
        open_task_count: memberTasks.length,
        active_project_count: memberProjects.filter((project) => isTeamActiveProject(project)).length,
        joined_at: workspaceMember?.joined_at ?? null,
        last_active_at: lastActiveAt,
      };
    });

    res.json({ team: { id: team.id, name: team.name, identifier: team.identifier }, members });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId, team, teamData } = await loadTeamRouteContext(req, teamId);
    const statusFilter = String(req.query?.status ?? '').trim().toLowerCase();
    const taskTypeFilter = String(req.query?.task_type ?? '').trim().toLowerCase();
    const assigneeFilter = String(req.query?.assignee ?? '').trim();
    const projectFilter = String(req.query?.project_id ?? '').trim();
    const priorityFilter = String(req.query?.priority ?? '').trim().toLowerCase();
    const dueFilter = String(req.query?.due ?? '').trim().toLowerCase();
    const search = String(req.query?.search ?? '').trim().toLowerCase();
    const sort = String(req.query?.sort ?? 'updated_at').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit ?? 50) || 50));
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1);
    const cursor = String(req.query?.cursor ?? '').trim();
    const teamProjectsResult = await supabase
      .from('projects')
      .select('id, name, status, completeness, color, start_date, end_date, lead_id, owner_team_id, created_by, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('owner_team_id', teamId);
    if (teamProjectsResult.error) throw teamProjectsResult.error;
    const teamProjects = teamProjectsResult.data ?? [];
    const teamProjectIds = teamProjects.map((project) => project.id).filter(Boolean);
    const [taskRowsResult, userLookup] = await Promise.all([
      supabase
        .from('tasks')
        .select(taskSelectWithHorizonColumns)
        .eq('workspace_id', workspaceId)
        .or(`assigned_to_team_id.eq.${teamId},assigned_team_id.eq.${teamId}${teamProjectIds.length ? `,project_id.in.(${teamProjectIds.join(',')})` : ''}`)
        .order('updated_at', { ascending: false })
        .limit(500),
      loadUsersByIds(
        [
          ...teamData.members.map((member) => member.id),
          ...teamProjects.map((project) => project.lead_id ?? project.created_by ?? null).filter(Boolean),
        ].filter(Boolean)
      ),
    ]);
    if (taskRowsResult.error) throw taskRowsResult.error;

    const projectById = new Map(teamProjects.map((project) => [project.id, project]));
    const rawTasks = (taskRowsResult.data ?? []).filter((task) => {
      if (projectFilter && task.project_id !== projectFilter) return false;
      if (taskTypeFilter && String(task.task_horizon ?? '').toLowerCase() !== taskTypeFilter) return false;
      if (priorityFilter && String(task.priority ?? '').toLowerCase() !== priorityFilter) return false;
      if (assigneeFilter.startsWith('team:')) {
        if (getTeamTaskOwnerTeamId(task) !== assigneeFilter.slice('team:'.length)) return false;
      } else if (assigneeFilter && getTeamTaskAssignmentId(task) !== assigneeFilter) {
        return false;
      }
      if (statusFilter === 'active' && !isTeamOpenTask(task)) return false;
      if (statusFilter === 'backlog' && String(task.task_horizon ?? '').toLowerCase() !== 'long_term') return false;
      if (statusFilter === 'assigned' && !getTeamTaskAssignmentId(task) && !getTeamTaskOwnerTeamId(task)) return false;
      if (statusFilter === 'completed' && String(task.status ?? '').toLowerCase() !== 'completed') return false;
      if (dueFilter === 'overdue') {
        if (!task.due_date || String(task.due_date) >= new Date().toISOString().slice(0, 10)) return false;
      } else if (dueFilter === 'today') {
        if (!task.due_date || String(task.due_date) !== new Date().toISOString().slice(0, 10)) return false;
      } else if (dueFilter === 'upcoming') {
        if (!task.due_date || String(task.due_date) <= new Date().toISOString().slice(0, 10)) return false;
      } else if (dueFilter && /^\d{4}-\d{2}-\d{2}$/.test(dueFilter) && String(task.due_date ?? '') !== dueFilter) {
        return false;
      }
      if (search) {
        const projectName = task.project_id ? projectById.get(task.project_id)?.name ?? '' : '';
        const text = [task.title, task.description, task.notes, task.priority, task.status, task.task_horizon, projectName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    const sortRows = [...rawTasks].sort((a, b) => {
      const desc = !sort.endsWith(':asc');
      const key = sort.replace(/:(asc|desc)$/i, '');
      const aValue =
        key === 'due'
          ? a.due_date ?? ''
          : key === 'created'
          ? a.created_at ?? ''
          : key === 'priority'
          ? a.priority ?? ''
          : a.updated_at ?? '';
      const bValue =
        key === 'due'
          ? b.due_date ?? ''
          : key === 'created'
          ? b.created_at ?? ''
          : key === 'priority'
          ? b.priority ?? ''
          : b.updated_at ?? '';
      return desc ? String(bValue).localeCompare(String(aValue)) : String(aValue).localeCompare(String(bValue));
    });

    const cursorFiltered = cursor
      ? sortRows.filter((task) => {
          const value =
            sort.includes('due')
              ? task.due_date ?? ''
              : sort.includes('created')
              ? task.created_at ?? ''
              : task.updated_at ?? '';
          return String(value) < cursor;
        })
      : sortRows;

    const pageRows = cursor ? cursorFiltered.slice(0, limit) : cursorFiltered.slice((page - 1) * limit, (page - 1) * limit + limit);
    const nextCursor = pageRows.length ? (sort.includes('due') ? pageRows[pageRows.length - 1].due_date ?? null : sort.includes('created') ? pageRows[pageRows.length - 1].created_at ?? null : pageRows[pageRows.length - 1].updated_at ?? null) : null;

    const tasks = pageRows.map((task) => {
      const assigneeUser = getTeamTaskAssignmentId(task) ? userLookup.get(getTeamTaskAssignmentId(task)) ?? null : null;
      const assigneeTeam = getTeamTaskOwnerTeamId(task) === teamId ? { id: team.id, name: team.name, identifier: team.identifier } : null;
      return {
        id: task.id,
        title: task.title,
        status: task.status ?? null,
        task_type: task.task_horizon ?? null,
        priority: task.priority ?? null,
        due_date: task.due_date ?? null,
        assignee: assigneeUser
          ? { id: assigneeUser.id, name: assigneeUser.full_name ?? assigneeUser.email ?? 'Member', avatar: assigneeUser.avatar_url ?? null }
          : assigneeTeam,
        project: task.project_id ? projectById.get(task.project_id) ?? null : null,
        blocked: false,
        created_at: task.created_at ?? null,
        updated_at: task.updated_at ?? null,
      };
    });

    res.json({ tasks, next_cursor: nextCursor, total_count: rawTasks.length });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/projects', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    const statusFilter = String(req.query?.status ?? '').trim().toLowerCase();
    const leadFilter = String(req.query?.lead ?? '').trim();
    const search = String(req.query?.search ?? '').trim().toLowerCase();
    const sort = String(req.query?.sort ?? 'updated_at').trim().toLowerCase();
    const activeOnly = ['active', 'open'].includes(statusFilter);
    const completedOnly = statusFilter === 'completed';

    const [projectsResult, taskRowsResult, milestoneRowsResult, userLookup] = await Promise.all([
      supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', workspaceId)
        .eq('owner_team_id', teamId)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('tasks')
        .select(taskSelectWithHorizonColumns)
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(500),
      supabase
        .from('project_milestones')
        .select(projectMilestoneSelectColumns)
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(500),
      loadUsersByIds([]),
    ]);
    if (projectsResult.error) throw projectsResult.error;
    if (taskRowsResult.error) throw taskRowsResult.error;
    if (milestoneRowsResult.error) throw milestoneRowsResult.error;

    const projectMap = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));
    const tasks = taskRowsResult.data ?? [];
    const milestones = milestoneRowsResult.data ?? [];
    const projects = (projectsResult.data ?? []).filter((project) => {
      if (leadFilter && String(project.lead_id ?? '') !== leadFilter) return false;
      if (activeOnly && isTeamActiveProject(project) === false) return false;
      if (completedOnly && normalizeProjectSemanticStatus(project.status) !== 'completed') return false;
      if (search) {
        const text = [
          project.name,
          project.description,
          project.status,
          project.project_type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    const sortRows = [...projects].sort((a, b) => {
      const desc = !sort.endsWith(':asc');
      const key = sort.replace(/:(asc|desc)$/i, '');
      const aValue =
        key === 'due'
          ? a.end_date ?? ''
          : key === 'status'
          ? a.status ?? ''
          : key === 'created'
          ? a.created_at ?? ''
          : a.updated_at ?? '';
      const bValue =
        key === 'due'
          ? b.end_date ?? ''
          : key === 'status'
          ? b.status ?? ''
          : key === 'created'
          ? b.created_at ?? ''
          : b.updated_at ?? '';
      return desc ? String(bValue).localeCompare(String(aValue)) : String(aValue).localeCompare(String(bValue));
    });

    const nextActionsByProjectId = new Map();
    const openTasksByProjectId = new Map();
    for (const task of tasks) {
      if (!task.project_id || !projectMap.has(task.project_id)) continue;
      const bucket = openTasksByProjectId.get(task.project_id) ?? [];
      bucket.push(task);
      openTasksByProjectId.set(task.project_id, bucket);
      if (isTeamOpenTask(task)) {
        const openBucket = nextActionsByProjectId.get(task.project_id) ?? [];
        openBucket.push(task);
        nextActionsByProjectId.set(task.project_id, openBucket);
      }
    }
    const milestoneByProjectId = new Map();
    for (const milestone of milestones) {
      if (!milestone.project_id || !projectMap.has(milestone.project_id)) continue;
      const bucket = milestoneByProjectId.get(milestone.project_id) ?? [];
      bucket.push(milestone);
      milestoneByProjectId.set(milestone.project_id, bucket);
    }

    res.json({
      projects: sortRows.map((project) => ({
        id: project.id,
        title: project.name ?? 'Untitled project',
        status: project.status ?? null,
        progress: project.completeness ?? 0,
        lead: project.lead_id ?? null,
        owner_team: { id: teamId },
        start_date: project.start_date ?? null,
        due_date: project.end_date ?? null,
        open_task_count: (openTasksByProjectId.get(project.id) ?? []).length,
        next_action_count: (nextActionsByProjectId.get(project.id) ?? []).length,
        milestone_count: (milestoneByProjectId.get(project.id) ?? []).length,
        updated_at: project.updated_at ?? null,
      })),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/milestones', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    const projectFilter = String(req.query?.project_id ?? '').trim();
    const dateFrom = String(req.query?.date_from ?? '').trim();
    const dateTo = String(req.query?.date_to ?? '').trim();
    const statusFilter = String(req.query?.status ?? '').trim().toLowerCase();

    const projectsResult = await supabase
      .from('projects')
      .select('id, name, status, completeness, color, start_date, end_date, lead_id, owner_team_id, created_by, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('owner_team_id', teamId);
    if (projectsResult.error) throw projectsResult.error;
    const projectIds = (projectsResult.data ?? []).map((project) => project.id).filter(Boolean);
    const milestonesResult = projectIds.length
      ? await supabase
          .from('project_milestones')
          .select(projectMilestoneSelectColumns)
          .eq('workspace_id', workspaceId)
          .in('project_id', projectIds)
          .order('milestone_date', { ascending: true })
          .order('created_at', { ascending: true })
      : { data: [], error: null };
    if (milestonesResult.error) throw milestonesResult.error;

    const projectMap = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));
    const milestones = (milestonesResult.data ?? []).filter((milestone) => {
      if (projectFilter && milestone.project_id !== projectFilter) return false;
      if (dateFrom && milestone.milestone_date < dateFrom) return false;
      if (dateTo && milestone.milestone_date > dateTo) return false;
      const isCompleted = Boolean(milestone.completed);
      const isOverdue = !isCompleted && milestone.milestone_date && milestone.milestone_date < new Date().toISOString().slice(0, 10);
      if (statusFilter === 'completed' && !isCompleted) return false;
      if (statusFilter === 'overdue' && !isOverdue) return false;
      if (statusFilter === 'upcoming' && (isCompleted || isOverdue)) return false;
      return true;
    });

    res.json({
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        status: milestone.completed
          ? 'completed'
          : milestone.milestone_date && milestone.milestone_date < new Date().toISOString().slice(0, 10)
          ? 'overdue'
          : 'upcoming',
        type: milestone.type ?? 'Custom',
        due_date: milestone.milestone_date ?? null,
        project: milestone.project_id ? projectMap.get(milestone.project_id) ?? null : null,
        assignee: milestone.assigned_to_user_id ?? milestone.assigned_to_team_id ?? null,
        completed_at: milestone.completed ? milestone.updated_at ?? null : null,
        updated_at: milestone.updated_at ?? null,
      })),
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/notes', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    const search = String(req.query?.search ?? '').trim().toLowerCase();
    const projectFilter = String(req.query?.project_id ?? '').trim();
    const createdByFilter = String(req.query?.created_by ?? '').trim();
    const sectionFilter = String(req.query?.section ?? '').trim();
    const recent = ['true', '1', 'yes'].includes(String(req.query?.recent ?? '').toLowerCase());
    const updatedAfter = String(req.query?.updated_after ?? req.query?.updated ?? '').trim();
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit ?? (recent ? 25 : 50)) || 50));

    const [directLinksResult, projectLinksResult, projectsResult] = await Promise.all([
      supabase
        .from('note_team_links')
        .select('id, workspace_id, note_id, team_id, created_by, created_at')
        .eq('workspace_id', workspaceId)
        .eq('team_id', teamId),
      supabase
        .from('project_note_links')
        .select('id, workspace_id, project_id, note_id, created_by, created_at')
        .eq('workspace_id', workspaceId),
      supabase
        .from('projects')
        .select('id, name, owner_team_id')
        .eq('workspace_id', workspaceId)
        .eq('owner_team_id', teamId),
    ]);
    if (directLinksResult.error) throw directLinksResult.error;
    if (projectLinksResult.error) throw projectLinksResult.error;
    if (projectsResult.error) throw projectsResult.error;

    const projectIds = (projectsResult.data ?? []).map((project) => project.id).filter(Boolean);
    const noteIds = [
      ...new Set([
        ...(directLinksResult.data ?? []).map((row) => row.note_id),
        ...(projectLinksResult.data ?? []).filter((row) => projectIds.includes(row.project_id)).map((row) => row.note_id),
      ].filter(Boolean)),
    ];
    const notesResult = noteIds.length
      ? await supabase
          .from('notes')
          .select('id, workspace_id, user_id, updated_by, title, preview, section_id, parent_id, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .in('id', noteIds)
      : { data: [], error: null };
    if (notesResult.error) throw notesResult.error;
    const notesById = new Map((notesResult.data ?? []).map((note) => [note.id, note]));
    const projectById = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));

    const rows = [...(directLinksResult.data ?? []), ...(projectLinksResult.data ?? [])]
      .map((link) => {
        const note = notesById.get(link.note_id);
        if (!note) return null;
        const project = link.project_id ? projectById.get(link.project_id) ?? null : null;
        return {
          id: note.id,
          title: note.title || 'Untitled note',
          preview: String(note.preview ?? '').slice(0, 160),
          created_by: note.user_id ?? null,
          updated_by: note.updated_by ?? null,
          linked_project: project ? { id: project.id, title: project.name ?? 'Untitled project' } : null,
          updated_at: note.updated_at ?? null,
          created_at: note.created_at ?? null,
          section_id: note.section_id ?? null,
          project_id: link.project_id ?? null,
        };
      })
      .filter(Boolean)
      .filter((note) => {
        if (projectFilter && note.project_id !== projectFilter) return false;
        if (createdByFilter && String(note.created_by ?? '') !== createdByFilter) return false;
        if (sectionFilter && String(note.section_id ?? '') !== sectionFilter) return false;
        if (updatedAfter && String(note.updated_at ?? '') < updatedAfter) return false;
        if (search) {
          const text = [note.title, note.preview, note.linked_project?.title].filter(Boolean).join(' ').toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')))
      .slice(0, limit);

    res.json({ notes: rows });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/calendar', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    const start = String(req.query?.start ?? '').trim() || new Date().toISOString();
    const end = String(req.query?.end ?? '').trim() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const eventType = String(req.query?.event_type ?? '').trim().toLowerCase();
    const projectFilter = String(req.query?.project_id ?? '').trim();
    const assigneeFilter = String(req.query?.assignee ?? req.query?.owner ?? '').trim();

    const projectsResult = await supabase
      .from('projects')
      .select('id, name, status, completeness, color, start_date, end_date, lead_id, owner_team_id, created_by, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('owner_team_id', teamId);
    if (projectsResult.error) throw projectsResult.error;
    const projectIds = (projectsResult.data ?? []).map((project) => project.id).filter(Boolean);
    const projectById = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));

    const [eventsResult, remindersResult, milestonesResult] = await Promise.all([
      supabase
        .from('events')
        .select('id, workspace_id, title, start_at, end_at, all_day, calendar_id, status, notes, location, project_id, note_id, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .gte('start_at', start)
        .lte('start_at', end),
      withReminderTable((table) =>
        supabase
          .from(table)
          .select('id, workspace_id, title, remind_at, status, project_id, note_id, calendar_id, notes, is_done, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .gte('remind_at', start)
          .lte('remind_at', end)
      ),
      projectIds.length
        ? supabase
            .from('project_milestones')
            .select(projectMilestoneSelectColumns)
            .eq('workspace_id', workspaceId)
            .in('project_id', projectIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsResult.error) throw eventsResult.error;
    if (remindersResult.error) throw remindersResult.error;
    if (milestonesResult.error) throw milestonesResult.error;

    const isTeamRelevantEvent = (event) =>
      event.assigned_to_team_id === teamId ||
      event.assigned_team_id === teamId ||
      (event.project_id && projectIds.includes(event.project_id));

    const isTeamRelevantReminder = (reminder) =>
      reminder.assigned_to_team_id === teamId ||
      reminder.assigned_team_id === teamId ||
      (reminder.project_id && projectIds.includes(reminder.project_id));

    const items = [
      ...(eventsResult.data ?? [])
        .filter(isTeamRelevantEvent)
        .filter((event) => (projectFilter ? event.project_id === projectFilter : true))
        .filter(() => !eventType || eventType === 'event')
        .map((event) => ({
          id: event.id,
          title: event.title,
          type: 'event',
          start: event.start_at,
          end: event.end_at,
          all_day: Boolean(event.all_day),
          project: event.project_id ? projectById.get(event.project_id) ?? null : null,
          note_id: event.note_id ?? null,
          owner: event.assigned_to_user_id ?? event.assigned_to_team_id ?? null,
          status: event.status ?? null,
        })),
      ...(remindersResult.data ?? [])
        .filter(isTeamRelevantReminder)
        .filter((reminder) => (projectFilter ? reminder.project_id === projectFilter : true))
        .filter(() => !eventType || eventType === 'reminder')
        .map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          type: 'reminder',
          start: reminder.remind_at,
          end: reminder.remind_at,
          all_day: false,
          project: reminder.project_id ? projectById.get(reminder.project_id) ?? null : null,
          note_id: reminder.note_id ?? null,
          owner: reminder.assigned_to_user_id ?? reminder.assigned_to_team_id ?? null,
          status: reminder.is_done ? 'completed' : reminder.status ?? 'active',
        })),
      ...(milestonesResult.data ?? [])
        .filter((milestone) => (projectFilter ? milestone.project_id === projectFilter : true))
        .filter(() => !eventType || eventType === 'milestone')
        .map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          type: 'milestone',
          start: milestone.milestone_date,
          end: milestone.milestone_date,
          all_day: true,
          project: milestone.project_id ? projectById.get(milestone.project_id) ?? null : null,
          note_id: milestone.linked_note_id ?? null,
          owner: milestone.assigned_to_user_id ?? milestone.assigned_to_team_id ?? null,
          status: milestone.completed ? 'completed' : 'planned',
        })),
    ]
      .filter((item) => (assigneeFilter ? String(item.owner ?? '') === assigneeFilter : true))
      .sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')));

    res.json({ items });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/intake', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    await resumeDueInboxItemsForWorkspace(workspaceId);
    const statusFilter = String(req.query?.status ?? '').trim().toLowerCase();
    const sourceFilter = String(req.query?.source ?? '').trim().toLowerCase();
    const suggestedTypeFilter = String(req.query?.suggested_type ?? '').trim().toLowerCase();
    const assigneeFilter = String(req.query?.assignee ?? '').trim();
    const search = String(req.query?.search ?? '').trim().toLowerCase();
    const createdAfter = String(req.query?.created_after ?? req.query?.created_date ?? '').trim();

    const intakeResult = await supabase
      .from('inbox_items')
      .select(inboxItemSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (intakeResult.error) throw intakeResult.error;

    const items = (intakeResult.data ?? [])
      .filter((item) => {
        const raw = item.raw_payload ?? {};
        const routedTeamId = String(raw.suggested_team_id ?? raw.team_id ?? '').trim();
        if (routedTeamId !== teamId) return false;
        if (statusFilter && String(item.status ?? '').toLowerCase() !== statusFilter) return false;
        if (sourceFilter && String(item.source ?? '').toLowerCase() !== sourceFilter) return false;
        if (suggestedTypeFilter && String(item.suggested_type ?? '').toLowerCase() !== suggestedTypeFilter) return false;
        if (assigneeFilter && String(item.suggested_assignee_id ?? '').trim() !== assigneeFilter) return false;
        if (createdAfter && String(item.created_at ?? '') < createdAfter) return false;
        if (search) {
          const text = [item.title, item.body, item.source, item.suggested_type].filter(Boolean).join(' ').toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        title: item.title,
        preview: htmlToPlainText(item.body ?? '').slice(0, 160),
        source: item.source,
        status: item.status,
        suggested_type: item.suggested_type ?? null,
        suggested_project_id: item.suggested_project_id ?? null,
        suggested_assignee_id: item.suggested_assignee_id ?? null,
        suggested_calendar_id: item.suggested_calendar_id ?? null,
        suggested_date: item.suggested_date ?? null,
        suggested_due_at: item.suggested_due_at ?? null,
        converted_type: item.converted_type ?? null,
        converted_id: item.converted_id ?? null,
        converted_at: item.converted_at ?? null,
        archived_at: item.archived_at ?? null,
        snoozed_until: item.snoozed_until ?? null,
        created_at: item.created_at ?? null,
        updated_at: item.updated_at ?? null,
      }));

    res.json({ items });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/teams/:teamId/activity', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const teamId = String(req.params.teamId);
    const { workspaceId } = await loadTeamRouteContext(req, teamId);
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit ?? 50) || 50));
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1);
    const cursor = String(req.query?.cursor ?? '').trim();

    const [projectsResult, tasksResult, notesResult, projectNotesResult, activitiesResult, intakeResult, eventsResult, remindersResult] = await Promise.all([
      supabase
        .from('projects')
        .select(projectSelectColumns)
        .eq('workspace_id', workspaceId)
        .eq('owner_team_id', teamId)
        .order('updated_at', { ascending: false })
        .limit(50),
      supabase
        .from('tasks')
        .select(taskSelectWithHorizonColumns)
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('note_team_links')
        .select('id, note_id, created_at')
        .eq('workspace_id', workspaceId)
        .eq('team_id', teamId),
      supabase
        .from('project_note_links')
        .select('id, project_id, note_id, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('workspace_audit_logs')
        .select('id, actor_user_id, action, target_type, target_id, metadata, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('inbox_items')
        .select(inboxItemSelectColumns)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('events')
        .select('id, title, start_at, end_at, status, project_id, note_id, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('assigned_to_team_id', teamId)
        .order('updated_at', { ascending: false })
        .limit(50),
      withReminderTable((table) =>
        supabase
          .from(table)
          .select('id, title, remind_at, status, project_id, note_id, assigned_to_user_id, assigned_to_team_id, assigned_by_user_id, assigned_at, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .eq('assigned_to_team_id', teamId)
          .order('updated_at', { ascending: false })
          .limit(50)
      ),
    ]);

    if (projectsResult.error) throw projectsResult.error;
    if (tasksResult.error) throw tasksResult.error;
    if (notesResult.error) throw notesResult.error;
    if (projectNotesResult.error) throw projectNotesResult.error;
    if (activitiesResult.error) throw activitiesResult.error;
    if (intakeResult.error) throw intakeResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (remindersResult.error) throw remindersResult.error;

    const projectMap = new Map((projectsResult.data ?? []).map((project) => [project.id, project]));
    const teamProjectIds = (projectsResult.data ?? []).map((project) => project.id).filter(Boolean);
    const noteLinks = [
      ...(notesResult.data ?? []).map((row) => ({ note_id: row.note_id, project_id: null, created_at: row.created_at })),
      ...(projectNotesResult.data ?? []).map((row) => ({ note_id: row.note_id, project_id: row.project_id, created_at: row.created_at })),
    ];
    const noteIds = [...new Set(noteLinks.map((row) => row.note_id).filter(Boolean))];
    const noteLookupResult = noteIds.length
      ? await supabase
          .from('notes')
          .select('id, title, updated_at')
          .eq('workspace_id', workspaceId)
          .in('id', noteIds)
      : { data: [], error: null };
    if (noteLookupResult.error) throw noteLookupResult.error;
    const noteMap = new Map((noteLookupResult.data ?? []).map((note) => [note.id, note]));
    const isTeamRelevantTask = (task) =>
      task.assigned_to_team_id === teamId ||
      task.assigned_team_id === teamId ||
      (task.project_id && teamProjectIds.includes(task.project_id));
    const isTeamRelevantEvent = (event) =>
      event.assigned_to_team_id === teamId ||
      event.assigned_team_id === teamId ||
      (event.project_id && teamProjectIds.includes(event.project_id));
    const isTeamRelevantReminder = (reminder) =>
      reminder.assigned_to_team_id === teamId ||
      reminder.assigned_team_id === teamId ||
      (reminder.project_id && teamProjectIds.includes(reminder.project_id));
    const taskMap = new Map(
      (tasksResult.data ?? [])
        .filter(isTeamRelevantTask)
        .map((task) => [task.id, task])
    );
    const eventMap = new Map(
      (eventsResult.data ?? [])
        .filter(isTeamRelevantEvent)
        .map((event) => [event.id, event])
    );
    const reminderMap = new Map(
      (remindersResult.data ?? [])
        .filter(isTeamRelevantReminder)
        .map((reminder) => [reminder.id, reminder])
    );
    const intakeMap = new Map(
      (intakeResult.data ?? [])
        .filter((item) => String(item.raw_payload?.suggested_team_id ?? item.raw_payload?.team_id ?? '').trim() === teamId)
        .map((item) => [item.id, item])
    );

    const resolveActivityTitle = (targetType, targetId) => {
      if (targetType === 'workspace_team_member') return 'Team member';
      if (targetType === 'workspace_team') return 'Team';
      if (targetType === 'project') return projectMap.get(targetId)?.name ?? 'Untitled project';
      if (targetType === 'task') return taskMap.get(targetId)?.title ?? 'Untitled task';
      if (targetType === 'note') return noteMap.get(targetId)?.title ?? 'Untitled note';
      if (targetType === 'inbox_item') return intakeMap.get(targetId)?.title ?? 'Intake item';
      if (targetType === 'event') return eventMap.get(targetId)?.title ?? 'Untitled event';
      if (targetType === 'reminder') return reminderMap.get(targetId)?.title ?? 'Untitled reminder';
      return targetType;
    };
    const isRelevantAuditRow = (row) => {
      if (row.target_type === 'workspace_team_member' || row.target_type === 'workspace_team') return true;
      if (row.target_type === 'project') return projectMap.has(row.target_id);
      if (row.target_type === 'task') return taskMap.has(row.target_id);
      if (row.target_type === 'note') return noteMap.has(row.target_id);
      if (row.target_type === 'inbox_item') return intakeMap.has(row.target_id);
      if (row.target_type === 'event') return eventMap.has(row.target_id);
      if (row.target_type === 'reminder') return reminderMap.has(row.target_id);
      return false;
    };

    const activity = [
      ...(activitiesResult.data ?? [])
        .filter(isRelevantAuditRow)
        .map((row) => ({
        id: row.id,
        actor: row.actor_user_id,
        action: titleCaseLabel(row.action),
        object_type: row.target_type,
        object_id: row.target_id ?? null,
        object_title: resolveActivityTitle(row.target_type, row.target_id ?? null),
        timestamp: row.created_at,
        metadata: row.metadata ?? null,
      })),
      ...(projectsResult.data ?? []).map((project) => ({
        id: `project:${project.id}`,
        actor: project.updated_by ?? project.created_by ?? null,
        action: isTeamActiveProject(project) ? 'Updated project' : 'Project update',
        object_type: 'project',
        object_id: project.id,
        object_title: project.name ?? 'Untitled project',
        timestamp: project.updated_at ?? project.created_at ?? null,
        metadata: { team_id: teamId },
      })),
      ...(tasksResult.data ?? [])
        .filter(isTeamRelevantTask)
        .map((task) => ({
          id: `task:${task.id}`,
          actor: task.assigned_by_user_id ?? null,
          action: String(task.status ?? '').toLowerCase() === 'completed' ? 'Completed task' : 'Updated task',
          object_type: 'task',
          object_id: task.id,
        object_title: task.title,
        timestamp: task.updated_at ?? task.created_at ?? null,
        metadata: { project_id: task.project_id ?? null },
      })),
      ...noteLinks
        .map((row) => ({
          id: `note:${row.note_id}:${row.project_id ?? 'team'}`,
          actor: null,
          action: row.project_id ? 'Linked note to project' : 'Linked note',
          object_type: 'note',
          object_id: row.note_id,
          object_title: noteMap.get(row.note_id)?.title ?? 'Untitled note',
          timestamp: row.created_at ?? null,
          metadata: { team_id: teamId, project_id: row.project_id ?? null },
        })),
      ...(intakeResult.data ?? [])
        .filter((item) => String(item.raw_payload?.suggested_team_id ?? item.raw_payload?.team_id ?? '').trim() === teamId)
        .map((item) => ({
          id: `intake:${item.id}`,
          actor: item.updated_by ?? item.user_id ?? null,
          action: String(item.status ?? '') === 'converted' ? 'Converted intake' : 'Updated intake',
          object_type: 'intake',
          object_id: item.id,
        object_title: item.title,
        timestamp: item.updated_at ?? item.created_at ?? null,
        metadata: { source: item.source ?? null },
      })),
      ...(eventsResult.data ?? [])
        .filter(isTeamRelevantEvent)
        .map((event) => ({
        id: `event:${event.id}`,
        actor: event.assigned_by_user_id ?? null,
        action: 'Updated event',
        object_type: 'event',
        object_id: event.id,
        object_title: event.title,
        timestamp: event.updated_at ?? event.created_at ?? null,
        metadata: { project_id: event.project_id ?? null },
      })),
      ...(remindersResult.data ?? [])
        .filter(isTeamRelevantReminder)
        .map((reminder) => ({
        id: `reminder:${reminder.id}`,
        actor: reminder.assigned_by_user_id ?? null,
        action: 'Updated reminder',
        object_type: 'reminder',
        object_id: reminder.id,
        object_title: reminder.title,
        timestamp: reminder.updated_at ?? reminder.created_at ?? null,
        metadata: { project_id: reminder.project_id ?? null },
      })),
    ]
      .filter((row) => row.timestamp)
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    const filtered = cursor ? activity.filter((row) => String(row.timestamp) < cursor) : activity;
    const pageRows = cursor ? filtered.slice(0, limit) : filtered.slice((page - 1) * limit, (page - 1) * limit + limit);
    const nextCursor = pageRows.length ? pageRows[pageRows.length - 1].timestamp ?? null : null;

    res.json({ activity: pageRows, next_cursor: nextCursor, total_count: activity.length });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/projects/:id/milestones', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const projectId = String(req.params.id);
    const allowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
    if (!allowed) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { data, error } = await supabase
      .from('project_milestones')
      .select(projectMilestoneSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('project_id', projectId)
      .order('milestone_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/project-milestones', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { data, error } = await supabase
      .from('project_milestones')
      .select(projectMilestoneSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('milestone_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data ?? []);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/projects/:id/milestones', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const projectId = String(req.params.id);
    const title = String(req.body?.title ?? '').trim();
    const milestoneDate = normalizeNullableDate(req.body?.milestone_date, 'milestone date');
    const type = normalizeProjectMilestoneType(req.body?.type);
    const note = normalizeNullableText(req.body?.note);
    const linkedNoteId = normalizeNullableText(req.body?.linked_note_id);
    const linkedReminderId = normalizeNullableText(req.body?.linked_reminder_id);
    const linkedEventId = normalizeNullableText(req.body?.linked_event_id);
    if (!title) return res.status(400).json({ error: 'Milestone title required' });
    if (!milestoneDate) return res.status(400).json({ error: 'Milestone date required' });

    const [projectAllowed, noteAllowed, reminderAllowed, eventAllowed] = await Promise.all([
      ensureWorkspaceResource('projects', projectId, workspaceId),
      linkedNoteId ? ensureWorkspaceResource('notes', linkedNoteId, workspaceId) : Promise.resolve(true),
      linkedReminderId
        ? ensureWorkspaceResource('reminders', linkedReminderId, workspaceId)
        : Promise.resolve(true),
      linkedEventId ? ensureWorkspaceResource('events', linkedEventId, workspaceId) : Promise.resolve(true),
    ]);

    if (!projectAllowed) return res.status(404).json({ error: 'Project not found' });
    if (!noteAllowed) return res.status(404).json({ error: 'Linked note not found' });
    if (!reminderAllowed) return res.status(404).json({ error: 'Linked reminder not found' });
    if (!eventAllowed) return res.status(404).json({ error: 'Linked event not found' });
    const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});
    if (assignmentTarget.assigned_to_user_id) {
      const userAllowed = await ensureWorkspaceMemberTarget(
        workspaceId,
        assignmentTarget.assigned_to_user_id
      );
      if (!userAllowed) return res.status(404).json({ error: 'Assigned user not found' });
    }
    if (assignmentTarget.assigned_to_team_id) {
      const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
      if (!teamAllowed) return res.status(404).json({ error: 'Team not found' });
    }
    const nowIso = new Date().toISOString();
    const assignedFields = buildMilestoneAssignmentPersistenceFields(
      assignmentTarget,
      req.authUser.id,
      nowIso
    );

    const { data, error } = await supabase
      .from('project_milestones')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title,
        milestone_date: milestoneDate,
        type,
        note,
        completed: Boolean(req.body?.completed),
        linked_note_id: linkedNoteId,
        linked_reminder_id: linkedReminderId,
        linked_event_id: linkedEventId,
        ...assignedFields,
      })
      .select(projectMilestoneSelectColumns)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.patch('/api/project-milestones/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const milestoneId = String(req.params.id);
    const allowed = await ensureWorkspaceResource('project_milestones', milestoneId, workspaceId);
    if (!allowed) return res.status(404).json({ error: 'Milestone not found' });

    const update = { updated_at: new Date().toISOString(), updated_by: req.authUser.id };
    if (req.body?.title !== undefined) {
      const title = String(req.body.title ?? '').trim();
      if (!title) return res.status(400).json({ error: 'Milestone title required' });
      update.title = title;
    }
    if (req.body?.milestone_date !== undefined) {
      const milestoneDate = normalizeNullableDate(req.body.milestone_date, 'milestone date');
      if (!milestoneDate) return res.status(400).json({ error: 'Milestone date required' });
      update.milestone_date = milestoneDate;
    }
    if (req.body?.type !== undefined) update.type = normalizeProjectMilestoneType(req.body.type);
    if (req.body?.note !== undefined) update.note = normalizeNullableText(req.body.note);
    if (req.body?.completed !== undefined) update.completed = Boolean(req.body.completed);
    if (req.body?.project_id !== undefined) {
      const projectId = String(req.body.project_id ?? '').trim();
      const projectAllowed = await ensureWorkspaceResource('projects', projectId, workspaceId);
      if (!projectAllowed) return res.status(404).json({ error: 'Project not found' });
      update.project_id = projectId;
    }
    if (
      req.body?.assigned_to !== undefined ||
      req.body?.assigned_to_user_id !== undefined ||
      req.body?.assigned_to_team_id !== undefined ||
      req.body?.assigned_team_id !== undefined
    ) {
      const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});
      if (assignmentTarget.assigned_to_user_id) {
        const userAllowed = await ensureWorkspaceMemberTarget(
          workspaceId,
          assignmentTarget.assigned_to_user_id
        );
        if (!userAllowed) return res.status(404).json({ error: 'Assigned user not found' });
      }
      if (assignmentTarget.assigned_to_team_id) {
        const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
        if (!teamAllowed) return res.status(404).json({ error: 'Team not found' });
      }
      Object.assign(
        update,
        buildMilestoneAssignmentPersistenceFields(
          assignmentTarget,
          req.authUser.id,
          new Date().toISOString()
        )
      );
    }

    const linkChecks = [];
    const linkedNoteId =
      req.body?.linked_note_id !== undefined ? normalizeNullableText(req.body.linked_note_id) : undefined;
    const linkedReminderId =
      req.body?.linked_reminder_id !== undefined
        ? normalizeNullableText(req.body.linked_reminder_id)
        : undefined;
    const linkedEventId =
      req.body?.linked_event_id !== undefined ? normalizeNullableText(req.body.linked_event_id) : undefined;
    if (linkedNoteId) linkChecks.push(['note', ensureWorkspaceResource('notes', linkedNoteId, workspaceId)]);
    if (linkedReminderId)
      linkChecks.push(['reminder', ensureWorkspaceResource('reminders', linkedReminderId, workspaceId)]);
    if (linkedEventId) linkChecks.push(['event', ensureWorkspaceResource('events', linkedEventId, workspaceId)]);
    const linkResults = await Promise.all(linkChecks.map(([, check]) => check));
    const failedLink = linkChecks.find((_, index) => !linkResults[index])?.[0];
    if (failedLink) return res.status(404).json({ error: `Linked ${failedLink} not found` });
    if (linkedNoteId !== undefined) update.linked_note_id = linkedNoteId;
    if (linkedReminderId !== undefined) update.linked_reminder_id = linkedReminderId;
    if (linkedEventId !== undefined) update.linked_event_id = linkedEventId;

    const { data, error } = await supabase
      .from('project_milestones')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', milestoneId)
      .select(projectMilestoneSelectColumns)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.delete('/api/project-milestones/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await supabase
      .from('project_milestones')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const selectAttempts = [taskSelectWithHorizonColumns, taskSelectColumns];
    let lastError = null;

    for (const columns of selectAttempts) {
      let query = supabase.from('tasks').select(columns).eq('workspace_id', workspaceId);
      if (req.query?.projectId) {
        query = query.eq('project_id', String(req.query.projectId));
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
      if (!error) {
        res.json(data ?? []);
        return;
      }

      lastError = error;
      if (!isMissingTaskTodayColumnError(error)) {
        throw error;
      }
    }

    throw lastError ?? new Error('Could not load tasks.');
  } catch (error) {
    return respondWithError(res, error);
  }
});

const contextLinkTypes = new Set(['note', 'project', 'task', 'event', 'reminder', 'intake']);
const contextLinkTables = { note: 'notes', project: 'projects', task: 'tasks', event: 'events', reminder: 'reminders', intake: 'inbox_items' };
const contextLinkTitleColumns = { note: 'title', project: 'name', task: 'title', event: 'title', reminder: 'title', intake: 'title' };
const contextLinkTypeRank = { event: 1, intake: 2, note: 3, project: 4, reminder: 5, task: 6 };
const contextLinkCanonical = (type, id, otherType, otherId) => {
  const leftRank = contextLinkTypeRank[type];
  const rightRank = contextLinkTypeRank[otherType];
  return leftRank < rightRank || (leftRank === rightRank && String(id) < String(otherId))
    ? { resource_a_type: type, resource_a_id: id, resource_b_type: otherType, resource_b_id: otherId }
    : { resource_a_type: otherType, resource_a_id: otherId, resource_b_type: type, resource_b_id: id };
};

const syncLegacyCalendarContextLinks = async (workspaceId, calendarType, calendarId, projectId, noteId, userId) => {
  for (const type of ['project', 'note']) {
    const removals = await supabase.from('ledger_context_links').delete().eq('workspace_id', workspaceId).or(`and(resource_a_type.eq.${calendarType},resource_a_id.eq.${calendarId},resource_b_type.eq.${type}),and(resource_b_type.eq.${calendarType},resource_b_id.eq.${calendarId},resource_a_type.eq.${type})`);
    if (removals.error) throw removals.error;
  }
  for (const [type, id] of [['project', projectId], ['note', noteId]]) {
    if (!id) continue;
    const { error } = await supabase.from('ledger_context_links').upsert({ workspace_id: workspaceId, ...contextLinkCanonical(calendarType, calendarId, type, String(id)), created_by: userId }, { onConflict: 'workspace_id,resource_a_type,resource_a_id,resource_b_type,resource_b_id' });
    if (error) throw error;
  }
};

const loadContextLinkResource = async (type, id, workspaceId) => {
  const table = contextLinkTables[type];
  const titleColumn = contextLinkTitleColumns[type];
  const select = type === 'task' ? 'id, title, status, due_date, due_time, assigned_to, project_id' : `id, ${titleColumn}`;
  const { data, error } = await supabase.from(table).select(select).eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
  if (error) throw error;
  return data ? { type, id: String(data.id), title: String(data[titleColumn] ?? 'Untitled'), ...(type === 'task' ? { status: data.status ?? null, dueDate: data.due_date ?? null, dueTime: data.due_time ?? null, assignee: data.assigned_to ?? null, projectId: data.project_id ?? null } : {}) } : null;
};

app.get('/api/context-links', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const resourceType = String(req.query?.resource_type ?? '');
    const resourceId = String(req.query?.resource_id ?? '');
    if (!contextLinkTypes.has(resourceType) || !resourceId) return res.status(400).json({ error: 'A valid resource is required.' });
    if (!(await ensureWorkspaceResource(contextLinkTables[resourceType], resourceId, workspaceId))) return res.status(404).json({ error: 'Resource not found.' });
    const { data, error } = await supabase.from('ledger_context_links').select('id, resource_a_type, resource_a_id, resource_b_type, resource_b_id, created_at').eq('workspace_id', workspaceId).or(`and(resource_a_type.eq.${resourceType},resource_a_id.eq.${resourceId}),and(resource_b_type.eq.${resourceType},resource_b_id.eq.${resourceId})`).order('created_at', { ascending: false });
    if (error) throw error;
    const links = [];
    for (const row of data ?? []) {
      const otherType = row.resource_a_type === resourceType && row.resource_a_id === resourceId ? row.resource_b_type : row.resource_a_type;
      const otherId = row.resource_a_type === resourceType && row.resource_a_id === resourceId ? row.resource_b_id : row.resource_a_id;
      const resource = await loadContextLinkResource(otherType, otherId, workspaceId);
      if (resource) links.push({ id: row.id, created_at: row.created_at, resource });
    }
    res.json(links);
  } catch (error) { return respondWithError(res, error); }
});

app.post('/api/context-links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const resourceType = String(req.body?.resource_type ?? '');
    const resourceId = String(req.body?.resource_id ?? '');
    const targetType = String(req.body?.target_type ?? '');
    const targetId = String(req.body?.target_id ?? '');
    if (!contextLinkTypes.has(resourceType) || !contextLinkTypes.has(targetType) || !resourceId || !targetId) return res.status(400).json({ error: 'Valid resources are required.' });
    if (resourceType === targetType && resourceId === targetId) return res.status(400).json({ error: 'A resource cannot link to itself.' });
    if (resourceType === 'task' && targetType === 'task') return res.status(400).json({ error: 'Task-to-task links are not supported.' });
    const [resourceAllowed, targetAllowed] = await Promise.all([ensureWorkspaceResource(contextLinkTables[resourceType], resourceId, workspaceId), ensureWorkspaceResource(contextLinkTables[targetType], targetId, workspaceId)]);
    if (!resourceAllowed || !targetAllowed) return res.status(404).json({ error: 'Resource not found.' });
    const canonical = contextLinkCanonical(resourceType, resourceId, targetType, targetId);
    const { data, error } = await supabase.from('ledger_context_links').upsert({ workspace_id: workspaceId, ...canonical, created_by: req.authUser.id }, { onConflict: 'workspace_id,resource_a_type,resource_a_id,resource_b_type,resource_b_id' }).select('id, resource_a_type, resource_a_id, resource_b_type, resource_b_id, created_at').single();
    if (error) throw error;
    res.json(data);
  } catch (error) { return respondWithError(res, error); }
});

app.delete('/api/context-links/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const { error } = await supabase.from('ledger_context_links').delete().eq('workspace_id', workspaceId).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) { return respondWithError(res, error); }
});

app.get('/api/today', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceIds = await resolveTodayWorkspaceIds(req);

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

      const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});
      if (assignmentTarget.assigned_to_user_id) {
        const targetAllowed = await ensureWorkspaceMemberTarget(
          workspaceId,
          assignmentTarget.assigned_to_user_id
        );
        if (!targetAllowed) {
          return res.status(404).json({ error: 'Assigned user not found' });
        }
      }
      if (assignmentTarget.assigned_to_team_id) {
        const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }

      const milestoneId = req.body?.milestone_id ? String(req.body.milestone_id) : null;
      if (milestoneId) {
        const { data: milestone, error: milestoneError } = await supabase
          .from('project_milestones')
          .select('id, project_id, workspace_id')
          .eq('id', milestoneId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (milestoneError) throw milestoneError;
        if (!milestone) {
          return res.status(404).json({ error: 'Milestone not found' });
        }
        if (projectId && milestone.project_id !== projectId) {
          return res.status(400).json({ error: 'Milestone must belong to the task project' });
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
      const requestedTaskHorizon = req.body?.task_horizon;
      const taskHorizon =
        requestedTaskHorizon === undefined
          ? undefined
          : String(requestedTaskHorizon).trim().toLowerCase() === 'today'
          ? 'today'
          : 'long_term';
      const source = normalizeCaptureSource(req.body?.source);
      const sourcePlatform = normalizeCaptureSourcePlatform(req.body?.source_platform);
      const nowIso = new Date().toISOString();
      const assignedFields = buildAssignmentPersistenceFields(assignmentTarget, req.authUser.id, nowIso);

      const insertAttempts = [
        { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: true },
        { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: false },
        { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: true },
        { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: false },
        { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: true },
        { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: false },
        { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: true },
        { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: false },
      ];

      for (const attempt of insertAttempts) {
        const payload = {
          workspace_id: workspaceId,
          project_id: projectId,
          milestone_id: milestoneId,
          title,
          description,
          notes,
          due_date: dueDate,
          due_time: dueTime,
          status: req.body?.status ? String(req.body.status) : 'todo',
          priority: req.body?.priority ? String(req.body.priority) : 'medium',
          ...assignedFields,
          tags,
          source,
          source_platform: sourcePlatform,
          ...(attempt.includeTaskHorizon && taskHorizon !== undefined
            ? { task_horizon: taskHorizon }
            : {}),
        };

        if (attempt.includeShowInToday) {
          payload.show_in_today = showInToday;
        }
        if (attempt.includeIsTodayFocus) {
          payload.is_today_focus = isTodayFocus;
        }

        const { data, error } = await supabase
          .from('tasks')
          .insert(payload)
          .select(buildTaskSelectColumns(attempt))
          .single();

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
      .select('id, status, completed_at, project_id')
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
    if (
      req.body?.assigned_to !== undefined ||
      req.body?.assigned_to_user_id !== undefined ||
      req.body?.assigned_to_team_id !== undefined ||
      req.body?.assigned_team_id !== undefined
    ) {
      const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});
      if (assignmentTarget.assigned_to_user_id) {
        const targetAllowed = await ensureWorkspaceMemberTarget(
          workspaceId,
          assignmentTarget.assigned_to_user_id
        );
        if (!targetAllowed) {
          return res.status(404).json({ error: 'Assigned user not found' });
        }
      }
      if (assignmentTarget.assigned_to_team_id) {
        const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      Object.assign(update, buildAssignmentPersistenceFields(assignmentTarget, req.authUser.id, new Date().toISOString()));
    }
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
    if (req.body?.milestone_id !== undefined) {
      const nextMilestoneId = req.body.milestone_id ? String(req.body.milestone_id) : null;
      if (nextMilestoneId) {
        const { data: milestone, error: milestoneError } = await supabase
          .from('project_milestones')
          .select('id, project_id, workspace_id')
          .eq('id', nextMilestoneId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (milestoneError) throw milestoneError;
        if (!milestone) {
          return res.status(404).json({ error: 'Milestone not found' });
        }
        const nextProjectId =
          update.project_id !== undefined ? update.project_id : existingTask?.project_id ?? null;
        if (nextProjectId && milestone.project_id !== nextProjectId) {
          return res.status(400).json({ error: 'Milestone must belong to the task project' });
        }
      }
      update.milestone_id = nextMilestoneId;
    }
    if (req.body?.task_horizon !== undefined) {
      const normalizedTaskHorizon = String(req.body.task_horizon).trim().toLowerCase();
      update.task_horizon = normalizedTaskHorizon === 'today' ? 'today' : 'long_term';
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
      { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: true },
      { includeTaskHorizon: true, includeShowInToday: true, includeIsTodayFocus: false },
      { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: true },
      { includeTaskHorizon: true, includeShowInToday: false, includeIsTodayFocus: false },
      { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: true },
      { includeTaskHorizon: false, includeShowInToday: true, includeIsTodayFocus: false },
      { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: true },
      { includeTaskHorizon: false, includeShowInToday: false, includeIsTodayFocus: false },
    ];

    for (const attempt of updateAttempts) {
      const nextUpdate = { ...update };

      if (attempt.includeShowInToday && requestedTodayFields.show_in_today !== undefined) {
        nextUpdate.show_in_today = requestedTodayFields.show_in_today;
      }
      if (attempt.includeIsTodayFocus && requestedTodayFields.is_today_focus !== undefined) {
        nextUpdate.is_today_focus = requestedTodayFields.is_today_focus;
      }

      const { data, error } = await supabase
        .from('tasks')
        .update(nextUpdate)
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
        .select(buildTaskSelectColumns(attempt))
        .single();

      if (!error) {
        if (String(req.body?.status ?? '').toLowerCase() === 'completed') {
          const resolved = await supabase.from('github_attention_signals').update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso }).eq('workspace_id', workspaceId).eq('target_type', 'task').eq('target_id', req.params.id).eq('status', 'active');
          if (resolved.error && !isMissingRelationError(resolved.error, 'github_attention_signals')) throw resolved.error;
        }
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
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const resolved = await supabase.from('github_attention_signals').update({ status: 'resolved', resolved_at: now, updated_at: now }).eq('workspace_id', workspaceId).eq('target_type', 'task').eq('target_id', req.params.id).eq('status', 'active');
    if (resolved.error && !isMissingRelationError(resolved.error, 'github_attention_signals')) throw resolved.error;
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
    const projectId = normalizeNullableText(req.query?.projectId);
    if (projectId && !isUuidLike(projectId)) {
      return res.status(400).json({ error: 'Invalid projectId' });
    }
    let query = supabase
      .from('events')
      .select(eventSelectColumns)
      .in('workspace_id', workspaceIds);
    if (projectId) {
      query = query.eq('project_id', projectId);
    }

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

    const { data: futureData, error: futureError } = await supabase
      .from('events')
      .select(eventSelectColumns)
      .in('workspace_id', workspaceIds)
      .gte('start_at', now.toISOString())
      .lte('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(20);

    if (futureError) throw futureError;

    const { data: ongoingData, error: ongoingError } = await supabase
      .from('events')
      .select(eventSelectColumns)
      .in('workspace_id', workspaceIds)
      .lt('start_at', now.toISOString())
      .gt('end_at', now.toISOString())
      .order('end_at', { ascending: true })
      .limit(20);

    if (ongoingError) throw ongoingError;

    const rowsById = new Map();
    for (const row of [...(Array.isArray(futureData) ? futureData : []), ...(Array.isArray(ongoingData) ? ongoingData : [])]) {
      if (!row?.id) continue;
      if (String(row.status ?? '') === 'done') continue;
      const endAt = new Date(row.end_at ?? row.start_at ?? 0).getTime();
      if (!Number.isFinite(endAt) || endAt <= now.getTime()) continue;
      rowsById.set(String(row.id), row);
    }

    const rows = Array.from(rowsById.values()).sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
    const workspaceIdsForRows = Array.from(new Set(rows.map((event) => event.workspace_id).filter(Boolean)));
    const projectIdsForRows = Array.from(new Set(rows.map((event) => event.project_id).filter(Boolean)));
    const noteIdsForRows = Array.from(new Set(rows.map((event) => event.note_id).filter(Boolean)));
    const calendarIdsForRows = Array.from(new Set(rows.map((event) => event.calendar_id).filter(Boolean)));
    const { data: workspaceData, error: workspaceError } = workspaceIdsForRows.length
      ? await supabase.from('workspaces').select('id, name, color').in('id', workspaceIdsForRows)
      : { data: [] };
    if (workspaceError) throw workspaceError;
    const { data: projectData, error: projectError } = projectIdsForRows.length
      ? await supabase.from('projects').select('id, name').in('id', projectIdsForRows)
      : { data: [] };
    if (projectError) throw projectError;
    const { data: noteData, error: noteError } = noteIdsForRows.length
      ? await supabase.from('notes').select('id, title').in('id', noteIdsForRows)
      : { data: [] };
    if (noteError) throw noteError;
    const { data: calendarData, error: calendarError } = calendarIdsForRows.length
      ? await supabase.from('calendars').select('id, name').in('id', calendarIdsForRows)
      : { data: [] };
    if (calendarError) throw calendarError;
    const workspaceById = new Map((workspaceData || []).map((workspace) => [workspace.id, workspace]));
    const projectById = new Map((projectData || []).map((project) => [project.id, project]));
    const noteById = new Map((noteData || []).map((note) => [note.id, note]));
    const calendarById = new Map((calendarData || []).map((calendar) => [calendar.id, calendar]));
    const filtered = rows;

    res.json(
      filtered.map((event) => ({
        ...event,
        workspace_name: workspaceById.get(event.workspace_id)?.name ?? null,
        workspace_color: workspaceById.get(event.workspace_id)?.color ?? null,
        project_name: event.project_id ? projectById.get(event.project_id)?.name ?? null : null,
        note_title: event.note_id ? noteById.get(event.note_id)?.title ?? null : null,
        calendar_name: event.calendar_id ? calendarById.get(event.calendar_id)?.name ?? null : null,
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
      let calendarColor = null;
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
        calendarColor = calendar.color ?? null;
      } else {
        const personalCalendar = await getPersonalCalendar(workspaceId, req.authUser.id);
        calendarId = personalCalendar.id;
        calendarColor = personalCalendar.color ?? null;
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
      const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});
      if (assignmentTarget.assigned_to_user_id) {
        const targetAllowed = await ensureWorkspaceMemberTarget(
          workspaceId,
          assignmentTarget.assigned_to_user_id
        );
        if (!targetAllowed) {
          return res.status(404).json({ error: 'Assigned user not found' });
        }
      }
      if (assignmentTarget.assigned_to_team_id) {
        const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
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
      const source = normalizeCaptureSource(req.body?.source);
      const sourcePlatform = normalizeCaptureSourcePlatform(req.body?.source_platform);
      const isSpecificDates = recurrenceRule === SPECIFIC_DATES_SERIES_TYPE || specificDates.length > 0;
      if (isSpecificDates && specificDates.length === 0) {
        return res.status(400).json({ error: 'specific_dates is required for specific date events' });
      }
      const seriesId = isSpecificDates ? crypto.randomUUID() : null;
      const nowIso = new Date().toISOString();
      const basePayload = {
        workspace_id: workspaceId,
        calendar_id: calendarId,
        created_by: req.authUser.id,
        updated_by: req.authUser.id,
        title,
        color: req.body?.color || calendarColor || '#93C5FD',
        status: req.body?.status || 'planned',
        visibility: normalizeEventVisibility(req.body?.visibility),
        recurrence_rule: isSpecificDates ? null : recurrenceRule,
        notes: req.body?.notes || null,
        location: req.body?.location || null,
        all_day: Boolean(req.body?.all_day ?? false),
        project_id: projectId || null,
        linked_project_id: projectId || null,
        note_id: noteId || null,
        ...buildEventAssignmentPersistenceFields(assignmentTarget, req.authUser.id, nowIso),
        series_id: seriesId,
        series_type: isSpecificDates ? SPECIFIC_DATES_SERIES_TYPE : null,
        source,
        source_platform: sourcePlatform,
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
        .select(eventSelectColumns);

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
        .select(eventSelectColumns)
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
    const requestedKeys = Object.keys(req.body ?? {}).filter((key) => req.body?.[key] !== undefined);
    const isStatusOnlyUpdate = requestedKeys.length === 1 && requestedKeys[0] === 'status';
    const requestedStatus = String(req.body?.status ?? '').toLowerCase();
    const isPastStatusUpdate = isPastEvent && isStatusOnlyUpdate && requestedStatus === 'done';
    const requestedEnd = req.body?.end_at ? new Date(req.body.end_at) : null;
    const isFutureReschedule =
      Boolean(requestedEnd) &&
      !Number.isNaN(requestedEnd.getTime()) &&
      requestedEnd.getTime() > Date.now();
    if (isPastEvent && !isPastStatusUpdate && !isFutureReschedule) {
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
    const hasAssignmentTarget =
      req.body?.assigned_to !== undefined ||
      req.body?.assigned_to_user_id !== undefined ||
      req.body?.assigned_to_team_id !== undefined ||
      req.body?.assigned_team_id !== undefined;
    const assignmentTarget = hasAssignmentTarget ? normalizeAssignmentTarget(req.body ?? {}) : null;
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
    if (assignmentTarget?.assigned_to_user_id) {
      const targetAllowed = await ensureWorkspaceMemberTarget(
        targetWorkspaceId,
        assignmentTarget.assigned_to_user_id
      );
      if (!targetAllowed) {
        return res.status(404).json({ error: 'Assigned user not found' });
      }
    }
    if (assignmentTarget?.assigned_to_team_id) {
      const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, targetWorkspaceId);
      if (!teamAllowed) {
        return res.status(404).json({ error: 'Team not found' });
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
    if (assignmentTarget) {
      Object.assign(
        update,
        buildEventAssignmentPersistenceFields(assignmentTarget, req.authUser.id, new Date().toISOString())
      );
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
      .select(eventSelectColumns)
      .single();

    if (error) throw error;
    await syncLegacyCalendarContextLinks(eventWorkspaceId, 'event', existingEvent.id, effectiveProjectId, effectiveNoteId, req.authUser.id);
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
    const nowIso = new Date().toISOString();
    await supabase
      .from('note_smart_links')
      .update({
        linked_event_id: null,
        updated_by: req.authUser.id,
        updated_at: nowIso,
      })
      .eq('workspace_id', workspaceId)
      .eq('linked_event_id', req.params.id);
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
      const combined = await searchWorkspaceContent({ workspaceId, rawQuery });

      res.json(combined);
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);

async function searchWorkspaceContent({
  workspaceId,
  rawQuery,
  workspaceName = null,
}) {
  const like = `%${rawQuery}%`;
  const normalizedQuery = normalizeSearchTerm(rawQuery);

  const [notesResult, projectsResult, tasksResult, eventsResult, remindersResult, inboxResult, teamsResult, membersResult, workspaceResult, githubReferencesResult] = await Promise.all([
    supabase
      .from('notes')
      .select('id, title, preview, mode, updated_at, created_at')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${like},content.ilike.${like},content_html.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('projects')
      .select('id, name, description, status, completeness, start_date, end_date, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .or(`name.ilike.${like},description.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('tasks')
      .select('id, project_id, title, description, due_date, due_time, status, priority, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('events')
      .select('id, title, start_at, end_at, status, color, created_at, updated_at, notes, project_id, note_id, assigned_to_team_id')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${like},notes.ilike.${like}`)
      .order('start_at', { ascending: true })
      .limit(25),
    supabase
      .from('reminders')
      .select('id, title, body, remind_at, status, project_id, note_id, created_at, updated_at, assigned_to_team_id')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${like},body.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('inbox_items')
      .select(inboxItemSelectColumns)
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${like},body.ilike.${like},source.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('workspace_teams')
      .select('id, name, identifier, description, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .or(`name.ilike.${like},identifier.ilike.${like},description.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId),
    supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle(),
    supabase
      .from('external_references')
      .select('id, external_type, external_url, normalized_url, metadata, access_status, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'github')
      .order('updated_at', { ascending: false })
      .limit(100),
  ]);

  if (notesResult.error) throw notesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (tasksResult.error) throw tasksResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (remindersResult.error) throw remindersResult.error;
  if (inboxResult.error) throw inboxResult.error;
  if (teamsResult.error) throw teamsResult.error;
  if (membersResult.error) throw membersResult.error;
  if (workspaceResult.error) throw workspaceResult.error;
  if (githubReferencesResult.error) throw githubReferencesResult.error;

  const memberUserIds = [
    ...new Set([
      ...(membersResult.data ?? []).map((row) => row.user_id).filter(Boolean),
      workspaceResult.data?.owner_id,
    ].filter(Boolean)),
  ];
  const usersResult = memberUserIds.length > 0
    ? await supabase
        .from('users')
        .select('id, email, full_name')
        .in('id', memberUserIds)
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .limit(25)
    : { data: [], error: null };
  if (usersResult.error) throw usersResult.error;

  const notes = (notesResult.data ?? []).map((row) => {
    const preview = truncatePreview(String(row.preview ?? ''), 80);
    return {
      type: 'note',
      id: row.id,
      title: row.title,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'note',
      source_id: row.id,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'FileText',
      score: scoreSearchResult(
        row.title,
        normalizedQuery,
        preview,
        normalizeSearchTerm(row.preview || '').includes(normalizedQuery)
      ),
    };
  });

  const projects = (projectsResult.data ?? []).map((row) => {
    const preview = truncatePreview(
      `Status: ${String(row.status ?? 'Not started')} · ${Math.max(0, Math.min(100, Number(row.completeness) || 0))}% complete`,
      80
    );
    return {
      type: 'project',
      id: row.id,
      title: row.name,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'project',
      source_id: row.id,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'Briefcase',
      score: scoreSearchResult(row.name, normalizedQuery, preview, false),
    };
  });

  const tasks = (tasksResult.data ?? []).map((row) => {
    const preview = truncatePreview(
      row.description?.trim() || `Due ${row.due_date ?? 'not set'}${row.due_time ? ` · ${row.due_time}` : ''}`,
      80
    );
    return {
      type: 'task',
      id: row.id,
      title: row.title,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'task',
      source_id: row.id,
      project_id: row.project_id ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'Check',
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
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'calendar_event',
      source_id: row.id,
      project_id: row.project_id ?? null,
      note_id: row.note_id ?? null,
      starts_at: row.start_at ?? null,
      ends_at: row.end_at ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'Calendar',
      score: scoreSearchResult(row.title, normalizedQuery, preview, false),
    };
  });

  const reminders = (remindersResult.data ?? []).map((row) => {
    const preview = truncatePreview(
      row.body?.trim() ||
        `Remind ${row.remind_at ? new Date(row.remind_at).toLocaleString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }) : 'not set'}`,
      80
    );
    return {
      type: 'reminder',
      id: row.id,
      title: row.title,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'reminder',
      source_id: row.id,
      project_id: row.project_id ?? null,
      note_id: row.note_id ?? null,
      remind_at: row.remind_at ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'Bell',
      score: scoreSearchResult(
        row.title,
        normalizedQuery,
        preview,
        normalizeSearchTerm(row.body ?? '').includes(normalizedQuery)
      ),
    };
  });

  const people = (usersResult.data ?? []).map((row) => ({
    type: 'person',
    id: row.id,
    title: row.full_name?.trim() || row.email || 'Workspace member',
    preview: row.email ?? 'Workspace member',
    snippet: row.email ?? 'Workspace member',
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    source_type: 'person',
    source_id: row.id,
    updated_at: null,
    icon: 'Briefcase',
    score: scoreSearchResult(row.full_name ?? row.email ?? '', normalizedQuery, row.email ?? '', false),
  }));

  const teams = (teamsResult.data ?? []).map((row) => {
    const preview = row.identifier ? `Team · ${row.identifier}` : 'Workspace team';
    return {
      type: 'team',
      id: row.id,
      title: row.name,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'team',
      source_id: row.id,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'Briefcase',
      score: scoreSearchResult(row.name, normalizedQuery, `${row.identifier ?? ''} ${row.description ?? ''}`, false),
    };
  });

  const intake = (inboxResult.data ?? []).map((row) => {
    const preview = truncatePreview(
      htmlToPlainText(row.body ?? '') || titleCaseLabel(row.source ?? 'Intake item'),
      80
    );
    return {
      type: 'intake',
      id: row.id,
      title: row.title,
      preview,
      snippet: preview,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'intake',
      source_id: row.id,
      provider: row.source_provider ?? row.source ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      icon: 'FileText',
      score: scoreSearchResult(row.title, normalizedQuery, `${row.body ?? ''} ${row.source ?? ''}`, false),
    };
  });

  const githubExternal = (githubReferencesResult.data ?? []).filter((row) => {
    const metadata = row.metadata ?? {};
    return [metadata.title, metadata.repositoryFullName, metadata.ownerLogin, metadata.number, row.normalized_url].some((value) => normalizeSearchTerm(value).includes(normalizedQuery));
  }).slice(0, 20).map((row) => {
    const metadata = row.metadata ?? {};
    const kind = row.external_type === 'pullRequest' ? 'Pull request' : row.external_type === 'issue' ? 'Issue' : 'Repository';
    const title = String(metadata.title ?? (row.external_type === 'repository' ? metadata.repositoryFullName ?? metadata.fullName ?? metadata.name ?? 'GitHub repository' : `${kind} #${metadata.number ?? ''}`));
    return {
      type: 'github',
      id: row.id,
      title,
      preview: `${kind} · ${metadata.repositoryFullName ?? ''}${metadata.number ? ` · #${metadata.number}` : ''}`,
      snippet: `${kind} · ${metadata.repositoryFullName ?? ''}`,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      source_type: 'external_reference',
      source_id: row.id,
      provider: 'github',
      external_url: row.normalized_url ?? row.external_url,
      external_type: row.external_type,
      icon: 'Github',
      score: scoreSearchResult(title, normalizedQuery, `${metadata.repositoryFullName ?? ''} ${metadata.number ?? ''}`, false),
    };
  });

  return [...notes, ...projects, ...tasks, ...events, ...reminders, ...people, ...teams, ...intake, ...githubExternal]
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return String(left.title).localeCompare(String(right.title));
    })
    .slice(0, 20);
}

app.get('/api/mobile/search', async (req, res) => {
  try {
    const user = await requireAuth(req);
    const rawQuery = String(req.query?.q ?? '').trim();
    if (rawQuery.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const requestedWorkspaceId = normalizeNullableText(req.query?.workspace_id) || 'all';
    const [workspaces, activeWorkspaceId] = await Promise.all([
      getUserWorkspaces(user.id),
      getUserActiveWorkspaceId(user.id),
    ]);

    const accessibleWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const resolvedWorkspaceId =
      requestedWorkspaceId === 'all'
        ? 'all'
        : accessibleWorkspaceIds.has(requestedWorkspaceId)
        ? requestedWorkspaceId
        : null;

    if (!resolvedWorkspaceId) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (resolvedWorkspaceId !== 'all') {
      const allowed = await isWorkspaceAccessibleToUser(user.id, resolvedWorkspaceId);
      if (!allowed) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      const workspace = workspaces.find((entry) => entry.id === resolvedWorkspaceId) ?? null;
      await setUserActiveWorkspaceId(user.id, resolvedWorkspaceId);
      return res.json(
        await searchWorkspaceContent({
          workspaceId: resolvedWorkspaceId,
          workspaceName: workspace?.name ?? null,
          rawQuery,
        })
      );
    }

    const searchableWorkspaces = workspaces.filter((workspace) => workspace.id && workspace.id !== 'all');
    const searchResults = await Promise.all(
      searchableWorkspaces.map((workspace) =>
        searchWorkspaceContent({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rawQuery,
        }).catch((error) => {
          console.error('[mobile search] workspace search failed', {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        })
      )
    );

    if (activeWorkspaceId && accessibleWorkspaceIds.has(activeWorkspaceId)) {
      await setUserActiveWorkspaceId(user.id, activeWorkspaceId);
    }

    res.json(
      searchResults
        .flat()
        .sort((left, right) => {
          if (left.score !== right.score) return left.score - right.score;
          return String(left.title).localeCompare(String(right.title));
        })
        .slice(0, 20)
    );
  } catch (error) {
    return respondWithMobileError(res, error);
  }
});

const loadRemindersForWorkspaces = async ({
  workspaceIds,
  statusFilter = 'default',
  from = null,
  to = null,
  linkedType = null,
  linkedId = null,
  projectId = null,
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
  if (projectId) query = query.eq('project_id', projectId);
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
    const projectId = normalizeNullableText(req.query?.projectId);
    if (linkedId && !isUuidLike(linkedId)) {
      return res.status(400).json({ error: 'Invalid linked_id' });
    }
    if (projectId && !isUuidLike(projectId)) {
      return res.status(400).json({ error: 'Invalid projectId' });
    }

    const reminders = await loadRemindersForWorkspaces({
      workspaceIds,
      statusFilter,
      from,
      to,
      linkedType,
      linkedId,
      projectId,
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
      let calendarColor = null;
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
        calendarColor = calendar.color ?? null;
      } else {
        const personalCalendar = await getPersonalCalendar(workspaceId, req.authUser.id);
        calendarId = personalCalendar.id;
        calendarColor = personalCalendar.color ?? null;
      }

      const linkedType = normalizeReminderLinkedType(req.body?.linked_type);
      const linkedId = normalizeNullableText(req.body?.linked_id);
      const recurrenceRuleRaw = normalizeNullableText(req.body?.recurrence_rule);
      const recurrenceRule = recurrenceRuleRaw ? recurrenceRuleRaw.toLowerCase() : null;
      const specificDates = normalizeDateKeyList(req.body?.specific_dates);
      const source = normalizeCaptureSource(req.body?.source);
      const sourcePlatform = normalizeCaptureSourcePlatform(req.body?.source_platform);
      const assignmentTarget = normalizeAssignmentTarget(req.body ?? {});

      if (linkedId && !isUuidLike(linkedId)) {
        return res.status(400).json({ error: 'Invalid linked_id' });
      }
      if ((linkedType === null || linkedType === 'none') && linkedId) {
        return res.status(400).json({ error: 'linked_type is required when linked_id is provided' });
      }
      if (assignmentTarget.assigned_to_user_id) {
        const targetAllowed = await ensureWorkspaceMemberTarget(
          workspaceId,
          assignmentTarget.assigned_to_user_id
        );
        if (!targetAllowed) {
          return res.status(404).json({ error: 'Assigned user not found' });
        }
      }
      if (assignmentTarget.assigned_to_team_id) {
        const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, workspaceId);
        if (!teamAllowed) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }

      await validateReminderLink({ workspaceId, linkedType, linkedId });

      const status = 'active';
      const isSpecificDates = recurrenceRule === SPECIFIC_DATES_SERIES_TYPE || specificDates.length > 0;
      if (isSpecificDates && specificDates.length === 0) {
        return res.status(400).json({ error: 'specific_dates is required for specific date reminders' });
      }
      const seriesId = isSpecificDates ? crypto.randomUUID() : null;
      const nowIso = new Date().toISOString();
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
        color: req.body?.color || calendarColor || '#F59E0B',
        linked_type: linkedType,
        linked_id: linkedId,
        ...buildEventAssignmentPersistenceFields(assignmentTarget, req.authUser.id, nowIso),
        completed_at: null,
        dismissed_at: null,
        snoozed_until: null,
        source,
        source_platform: sourcePlatform,
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
    const hasAssignmentTarget =
      req.body?.assigned_to !== undefined ||
      req.body?.assigned_to_user_id !== undefined ||
      req.body?.assigned_to_team_id !== undefined ||
      req.body?.assigned_team_id !== undefined;
    const assignmentTarget = hasAssignmentTarget ? normalizeAssignmentTarget(req.body ?? {}) : null;

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
    if (assignmentTarget?.assigned_to_user_id) {
      const targetAllowed = await ensureWorkspaceMemberTarget(
        targetWorkspaceId,
        assignmentTarget.assigned_to_user_id
      );
      if (!targetAllowed) {
        return res.status(404).json({ error: 'Assigned user not found' });
      }
    }
    if (assignmentTarget?.assigned_to_team_id) {
      const teamAllowed = await ensureWorkspaceTeam(assignmentTarget.assigned_to_team_id, targetWorkspaceId);
      if (!teamAllowed) {
        return res.status(404).json({ error: 'Team not found' });
      }
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
    if (assignmentTarget) {
      Object.assign(
        updatePayload,
        buildEventAssignmentPersistenceFields(assignmentTarget, req.authUser.id, new Date().toISOString())
      );
    }

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
    await syncLegacyCalendarContextLinks(reminder.workspace_id, 'reminder', reminder.id, data?.project_id ?? null, data?.note_id ?? null, req.authUser.id);
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
    const nowIso = new Date().toISOString();
    await supabase
      .from('note_smart_links')
      .update({
        linked_reminder_id: null,
        updated_by: req.authUser.id,
        updated_at: nowIso,
      })
      .eq('workspace_id', reminder.workspace_id)
      .eq('linked_reminder_id', req.params.id);

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
      .select(noteSummarySelectColumns)
      .eq('workspace_id', workspaceId)
      .limit(500);

    if (error) throw error;
    const mapped = data ?? [];
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

app.get('/api/notes/:id/smart-links', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const noteAllowed = await ensureWorkspaceResource('notes', req.params.id, workspaceId);
    if (!noteAllowed) {
      return res.status(404).json({ error: 'Note not found.' });
    }

    const { data, error } = await supabase
      .from('note_smart_links')
      .select(noteSmartLinkSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('note_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ links: Array.isArray(data) ? data : [] });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/notes/:id/smart-links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const noteId = String(req.params.id ?? '').trim();
    const noteAllowed = await ensureWorkspaceResource('notes', noteId, workspaceId);
    if (!noteAllowed) {
      return res.status(404).json({ error: 'Note not found.' });
    }

    const sourceKey = String(req.body?.source_key ?? '').trim();
    const sourceText = String(req.body?.source_text ?? '').trim();
    if (!sourceKey) {
      return res.status(400).json({ error: 'source_key is required' });
    }
    if (!sourceText) {
      return res.status(400).json({ error: 'source_text is required' });
    }

    const linkedEventId = normalizeNullableText(req.body?.linked_event_id);
    const linkedReminderId = normalizeNullableText(req.body?.linked_reminder_id);
    if (linkedEventId && linkedReminderId) {
      return res.status(400).json({ error: 'Only one linked object can be set' });
    }

    if (linkedEventId) {
      const eventAllowed = await ensureWorkspaceResource('events', linkedEventId, workspaceId);
      if (!eventAllowed) {
        return res.status(404).json({ error: 'Event not found.' });
      }
    }

    if (linkedReminderId) {
      const reminderAllowed = await ensureWorkspaceResource('reminders', linkedReminderId, workspaceId);
      if (!reminderAllowed) {
        return res.status(404).json({ error: 'Reminder not found.' });
      }
    }

    const payload = {
      workspace_id: workspaceId,
      note_id: noteId,
      source_key: sourceKey,
      source_text: sourceText,
      source_start_offset:
        req.body?.source_start_offset !== undefined
          ? toNonNegativeInt(req.body.source_start_offset, null)
          : null,
      source_end_offset:
        req.body?.source_end_offset !== undefined
          ? toNonNegativeInt(req.body.source_end_offset, null)
          : null,
      linked_event_id: linkedEventId || null,
      linked_reminder_id: linkedReminderId || null,
      dismissed_at: normalizeNullableText(req.body?.dismissed_at),
      created_by: req.authUser.id,
      updated_by: req.authUser.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('note_smart_links')
      .upsert(payload, { onConflict: 'workspace_id,note_id,source_key' })
      .select(noteSmartLinkSelectColumns)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.get('/api/notes/:id/person-links', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const noteAllowed = await ensureWorkspaceResource('notes', req.params.id, workspaceId);
    if (!noteAllowed) return res.status(404).json({ error: 'Note not found.' });

    const { data, error } = await supabase
      .from('note_person_links')
      .select(notePersonLinkSelectColumns)
      .eq('workspace_id', workspaceId)
      .eq('note_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ links: Array.isArray(data) ? data : [] });
  } catch (error) {
    return respondWithError(res, error);
  }
});

app.post('/api/notes/:id/person-links', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req);
    const noteId = String(req.params.id ?? '').trim();
    const noteAllowed = await ensureWorkspaceResource('notes', noteId, workspaceId);
    if (!noteAllowed) return res.status(404).json({ error: 'Note not found.' });

    const personUserId = String(req.body?.person_user_id ?? '').trim();
    const sourceKey = String(req.body?.source_key ?? '').trim();
    const sourceText = String(req.body?.source_text ?? '').trim();
    if (!personUserId || !sourceKey || !sourceText) {
      return res.status(400).json({ error: 'person_user_id, source_key, and source_text are required' });
    }

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', personUserId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) {
      const { data: owner, error: ownerError } = await supabase
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .eq('owner_id', personUserId)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner) return res.status(404).json({ error: 'Person is no longer available in this workspace.' });
    }

    const payload = {
      workspace_id: workspaceId,
      note_id: noteId,
      person_user_id: personUserId,
      source_key: sourceKey,
      source_text: sourceText,
      created_by: req.authUser.id,
      updated_by: req.authUser.id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('note_person_links')
      .upsert(payload, { onConflict: 'workspace_id,note_id,person_user_id,source_key' })
      .select(notePersonLinkSelectColumns)
      .single();
    if (error) throw error;
    res.json(data);
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
      const sourcePlatform = normalizeCaptureSourcePlatform(req.body?.source_platform);
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
          source_platform: sourcePlatform,
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
      const sourcePlatform = normalizeCaptureSourcePlatform(req.body?.source_platform);
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
          source_platform: sourcePlatform,
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
        'id, name, description, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
      )
      .eq('workspace_id', workspaceId);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query
      .order('usage_count', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    const { data: preferences } = await supabase
      .from('note_template_preferences')
      .select('template_id, pinned')
      .eq('user_id', req.authUser.id)
      .eq('pinned', true);
    const pinned = new Set((preferences ?? []).map((row) => row.template_id));
    res.json(
      (data ?? [])
        .filter((template) => template.is_system || template.visibility === 'workspace' || template.created_by === req.authUser.id)
        .map((template) => ({ ...template, pinned: pinned.has(template.id) }))
    );
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
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
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
    const visibility = String(req.body?.visibility ?? 'mine').toLowerCase();

    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }
    if (!['mine', 'workspace'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid template visibility' });
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
        visibility,
        icon: normalizeNullableText(req.body?.icon),
        color: normalizeNullableText(req.body?.color),
        suggested_section_id: req.body?.suggested_section_id || null,
        title_pattern: normalizeNullableText(req.body?.title_pattern),
      })
      .select(
        'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
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
        .select('id, created_by, is_system, visibility')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system) {
        return res.status(403).json({ error: 'Cannot edit system templates' });
      }
      const access = await getWorkspaceAccess(req.authUser.id, workspaceId);
      if (existing.created_by !== req.authUser.id && !(existing.visibility === 'workspace' && access && roleAtLeast(access.role, 'admin'))) {
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
      if (req.body?.visibility !== undefined) {
        const nextVisibility = String(req.body.visibility).toLowerCase();
        if (!['mine', 'workspace'].includes(nextVisibility)) return res.status(400).json({ error: 'Invalid template visibility' });
        update.visibility = nextVisibility;
      }
      for (const field of ['icon', 'color', 'title_pattern', 'suggested_section_id']) {
        if (req.body?.[field] !== undefined) update[field] = normalizeNullableText(req.body[field]);
      }

      update.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('note_templates')
        .update(update)
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
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
        .select('created_by, is_system, visibility')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system)
        return res.status(403).json({ error: 'Cannot delete system templates' });
      const access = await getWorkspaceAccess(req.authUser.id, workspaceId);
      if (existing.created_by !== req.authUser.id && !(existing.visibility === 'workspace' && access && roleAtLeast(access.role, 'admin'))) {
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
        .select('name, description, content_html, category, visibility, icon, color, suggested_section_id, title_pattern')
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
          visibility: ['mine', 'workspace'].includes(String(req.body?.visibility ?? '').toLowerCase()) ? String(req.body.visibility).toLowerCase() : 'mine',
          icon: original.icon,
          color: original.color,
          suggested_section_id: original.suggested_section_id,
          title_pattern: original.title_pattern,
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
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
        .select('id, name, content_html, title_pattern, suggested_section_id')
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
        await supabase
          .from('note_templates')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', templateId);
      })();

      // Create note from template
      const content_html = template.content_html;
      const content_plain = htmlToPlainText(content_html);
      const date = new Date().toISOString().slice(0, 10);
      const titlePattern = template.title_pattern || template.name;
      const title = titlePattern
        .replace(/\{\{date\}\}/g, date)
        .replace(/\{\{week_start\}\}/g, date)
        .replace(/\{\{project\}\}|\{\{team\}\}|\{\{person\}\}|\{\{topic\}\}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || template.name;

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
          title,
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
      const visibility = String(req.body?.visibility ?? 'mine').toLowerCase();
      if (!['mine', 'workspace'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid template visibility' });
      }

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
          visibility,
          icon: normalizeNullableText(req.body?.icon),
          color: normalizeNullableText(req.body?.color),
          suggested_section_id: req.body?.suggested_section_id || null,
          title_pattern: normalizeNullableText(req.body?.title_pattern),
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by, visibility, icon, color, suggested_section_id, title_pattern, last_used_at'
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

// Personal curation is separate from shared template metadata.
app.patch(
  '/api/templates/:id([0-9a-fA-F-]{36})/pin',
  authMiddleware,
  rateLimit('write'),
  async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);
      const pinned = Boolean(req.body?.pinned);
      const { data: template, error: templateError } = await supabase
        .from('note_templates')
        .select('id')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (templateError) throw templateError;
      if (!template) return res.status(404).json({ error: 'Template not found' });
      const { data, error } = await supabase
        .from('note_template_preferences')
        .upsert({ template_id: templateId, user_id: req.authUser.id, pinned, updated_at: new Date().toISOString() })
        .select('template_id, pinned')
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
  setInterval(() => {
    void runSlackEventDeliveryWorker();
  }, 10_000);
});
