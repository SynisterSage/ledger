const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  allDayDate,
  escapeICalText,
  foldICalLine,
  nextAllDayDate,
  recurrenceRuleValue,
  safeTimezone,
  toICalDateTime,
  toZonedICalDateTime,
} = require('./ical-format');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_TIMEZONE = process.env.ICAL_DEFAULT_TIMEZONE || 'UTC';
const DEEP_LINK_BASE = String(process.env.LEDGER_DEEP_LINK_BASE || '').replace(/\/$/, '');
const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'ledger-ical' });
});

function sequenceFor(item) {
  const timestamp = new Date(item.updated_at || item.created_at || 0).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp / 1000)) : 0;
}

function itemUrl(type, id) {
  if (!DEEP_LINK_BASE) return null;
  return `${DEEP_LINK_BASE}/calendar/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function resolveSubscription(token) {
  const hashed = hashToken(token);
  const { data: subscription, error: subscriptionError } = await supabase
    .from('calendar_subscriptions')
    .select('id, user_id, workspace_id, enabled, include_events, include_reminders, include_tasks, include_milestones, include_project_deadlines, include_completed, updated_at')
    .eq('token_hash', hashed)
    .maybeSingle();
  if (subscriptionError) {
    // Before the Phase 2 migration is deployed, retain the legacy feed path.
    if (!/relation .*calendar_subscriptions.*does not exist/i.test(subscriptionError.message || '')) {
      throw new Error(`Subscription lookup failed: ${subscriptionError.message}`);
    }
  }

  if (subscription) {
    if (!subscription.enabled) return { disabled: true, subscription, calendarIds: [] };
    const { data: links, error: linksError } = await supabase
      .from('calendar_subscription_calendars')
      .select('calendar_id')
      .eq('subscription_id', subscription.id);
    if (linksError) throw new Error(`Subscription calendar lookup failed: ${linksError.message}`);
    return { subscription, calendarIds: (links || []).map((link) => link.calendar_id) };
  }

  const { data: legacy, error: legacyError } = await supabase
    .from('calendar_sync_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();
  if (legacyError) throw new Error(`Token lookup failed: ${legacyError.message}`);
  if (!legacy) return null;
  return {
    subscription: {
      user_id: legacy.user_id,
      workspace_id: null,
      enabled: true,
      include_events: true,
      include_reminders: false,
      include_tasks: false,
      include_milestones: false,
      include_project_deadlines: false,
      include_completed: true,
    },
    calendarIds: null,
    legacy: true,
  };
}

async function userCanAccessWorkspace(userId, workspaceId) {
  const { data: owner, error: ownerError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (owner) return true;
  const { data: member, error: memberError } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (memberError) throw memberError;
  return Boolean(member);
}

function timedDate(dateValue, timeValue) {
  return new Date(`${dateValue}T${String(timeValue).slice(0, 8)}Z`);
}

function itemLines(item) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${item.uid}`,
    `DTSTAMP:${toICalDateTime(item.updated_at || item.created_at || `${item.date}T00:00:00Z`)}`,
    `CREATED:${toICalDateTime(item.created_at || item.updated_at || `${item.date}T00:00:00Z`)}`,
    `LAST-MODIFIED:${toICalDateTime(item.updated_at || item.created_at || `${item.date}T00:00:00Z`)}`,
    `SEQUENCE:${sequenceFor(item)}`,
  ];
  if (item.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${allDayDate(item.date)}`, `DTEND;VALUE=DATE:${nextAllDayDate(item.date)}`);
  } else {
    const timezone = safeTimezone(item.timezone);
    lines.push(`DTSTART;TZID=${timezone}:${toZonedICalDateTime(item.start_at, timezone)}`);
    if (item.end_at) lines.push(`DTEND;TZID=${timezone}:${toZonedICalDateTime(item.end_at, timezone)}`);
  }
  lines.push(`SUMMARY:${escapeICalText(item.title)}`, `STATUS:${item.status || 'CONFIRMED'}`);
  if (item.recurrence) lines.push(`RRULE:${item.recurrence}`);
  if (item.description) lines.push(`DESCRIPTION:${escapeICalText(item.description)}`);
  if (item.location) lines.push(`LOCATION:${escapeICalText(item.location)}`);
  if (item.url) lines.push(`URL:${escapeICalText(item.url)}`);
  lines.push('END:VEVENT');
  return lines.flatMap(foldICalLine);
}

function addAllDayItem(lines, item) {
  lines.push(...itemLines({ ...item, allDay: true }));
}

function addTimedItem(lines, item) {
  lines.push(...itemLines({ ...item, allDay: false }));
}

async function fetchSubscriptionItems(resolved) {
  const { subscription, calendarIds, legacy } = resolved;
  let workspaceIds = legacy ? [] : [subscription.workspace_id];
  if (legacy) {
    const { data: workspaces, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_id', subscription.user_id);
    if (error) throw new Error(`Workspace lookup failed: ${error.message}`);
    workspaceIds = (workspaces || []).map((workspace) => workspace.id);
  }
  const accessibleWorkspaceIds = [];
  for (const workspaceId of workspaceIds) {
    if (await userCanAccessWorkspace(subscription.user_id, workspaceId)) accessibleWorkspaceIds.push(workspaceId);
  }
  if (accessibleWorkspaceIds.length === 0) return { events: [], reminders: [], tasks: [], milestones: [], projects: [], accessDenied: true };

  const calendarFilter = (query) =>
    calendarIds === null ? query : query.in('calendar_id', calendarIds.length ? calendarIds : ['00000000-0000-0000-0000-000000000000']);
  const requests = [];
  if (subscription.include_events) {
    requests.push(calendarFilter(supabase.from('events').select('id, workspace_id, calendar_id, title, notes, location, start_at, end_at, status, updated_at, created_at, all_day, timezone, recurrence_rule, recurrence_until, series_id, series_type, source, source_platform').in('workspace_id', accessibleWorkspaceIds)));
  } else requests.push(null);
  if (subscription.include_reminders) {
    requests.push(calendarFilter(supabase.from('reminders').select('id, workspace_id, calendar_id, user_id, created_by, title, notes, remind_at, is_done, status, updated_at, created_at, recurrence_rule, series_id, series_type, source, source_platform').in('workspace_id', accessibleWorkspaceIds).or(`user_id.eq.${subscription.user_id},created_by.eq.${subscription.user_id}`)));
  } else requests.push(null);
  if (subscription.include_tasks) {
    requests.push(supabase.from('tasks').select('id, workspace_id, title, due_date, due_time, status, updated_at, created_at, assigned_to, assigned_to_user_id, project_id').in('workspace_id', accessibleWorkspaceIds).or(`assigned_to_user_id.eq.${subscription.user_id},assigned_to.eq.${subscription.user_id}`).not('due_date', 'is', null));
  } else requests.push(null);
  if (subscription.include_milestones) {
    requests.push(supabase.from('project_milestones').select('id, workspace_id, project_id, title, milestone_date, completed, updated_at, created_at').in('workspace_id', accessibleWorkspaceIds).not('milestone_date', 'is', null));
  } else requests.push(null);
  if (subscription.include_project_deadlines) {
    requests.push(supabase.from('projects').select('id, workspace_id, name, status, end_date, updated_at, created_at').in('workspace_id', accessibleWorkspaceIds).not('end_date', 'is', null));
  } else requests.push(null);

  const results = await Promise.all(requests.map((request) => request || Promise.resolve({ data: [], error: null })));
  for (const result of results) if (result.error) throw new Error(`Subscription data lookup failed: ${result.error.message}`);
  const events = (results[0].data || []).filter((event) => {
    const provider = `${event.source || ''} ${event.source_platform || ''}`.toLowerCase();
    return !['google', 'outlook', 'apple', 'caldav', 'external'].some((marker) => provider.includes(marker));
  });
  return { events, reminders: results[1].data || [], tasks: results[2].data || [], milestones: results[3].data || [], projects: results[4].data || [] };
}

function buildExportRecords(items, resolved) {
  const includeCompleted = Boolean(resolved.subscription.include_completed);
  const records = [];
  const statusFor = (status, done = false) => {
    if (String(status || '').toLowerCase() === 'cancelled' || String(status || '').toLowerCase() === 'dismissed') return 'CANCELLED';
    if (done) return 'COMPLETED';
    return 'CONFIRMED';
  };
  for (const event of items.events || []) {
    records.push({
      uid: `event-${event.id}@ledger.app`, itemType: 'event', itemId: event.id,
      title: event.title || 'Untitled event', description: event.notes || '', location: event.location || '',
      start_at: event.start_at, end_at: event.end_at, date: event.start_at, allDay: Boolean(event.all_day),
      timezone: event.timezone, status: statusFor(event.status), created_at: event.created_at, updated_at: event.updated_at,
      recurrence: recurrenceRuleValue(event.recurrence_rule, event.recurrence_until),
      recurrence_until: event.recurrence_until, url: itemUrl('event', event.id),
    });
  }
  for (const reminder of items.reminders || []) {
    const done = Boolean(reminder.is_done) || ['completed', 'dismissed'].includes(String(reminder.status || '').toLowerCase());
    if (done && !includeCompleted) continue;
    records.push({
      uid: `reminder-${reminder.id}@ledger.app`, itemType: 'reminder', itemId: reminder.id,
      title: `Reminder: ${reminder.title || 'Untitled reminder'}`, description: reminder.notes || '',
      start_at: reminder.remind_at, end_at: new Date(new Date(reminder.remind_at).getTime() + 15 * 60 * 1000),
      timezone: DEFAULT_TIMEZONE, status: statusFor(reminder.status, done), created_at: reminder.created_at, updated_at: reminder.updated_at,
      recurrence: recurrenceRuleValue(reminder.recurrence_rule), url: itemUrl('reminder', reminder.id),
    });
  }
  for (const task of items.tasks || []) {
    const done = ['completed', 'done', 'cancelled'].includes(String(task.status || '').toLowerCase());
    if (done && !includeCompleted) continue;
    records.push({
      uid: `task-${task.id}@ledger.app`, itemType: 'task', itemId: task.id,
      title: `Task: ${task.title || 'Untitled task'}`, date: task.due_date,
      start_at: task.due_time ? timedDate(task.due_date, task.due_time) : null,
      end_at: task.due_time ? new Date(timedDate(task.due_date, task.due_time).getTime() + 30 * 60 * 1000) : null,
      timezone: DEFAULT_TIMEZONE, allDay: !task.due_time, status: statusFor(task.status, done),
      created_at: task.created_at, updated_at: task.updated_at, url: itemUrl('task', task.id),
    });
  }
  for (const milestone of items.milestones || []) {
    if (milestone.completed && !includeCompleted) continue;
    records.push({
      uid: `milestone-${milestone.id}@ledger.app`, itemType: 'milestone', itemId: milestone.id,
      title: `Milestone: ${milestone.title || 'Untitled milestone'}`, date: milestone.milestone_date,
      status: statusFor(null, Boolean(milestone.completed)), description: 'Ledger project milestone',
      created_at: milestone.created_at, updated_at: milestone.updated_at, url: itemUrl('milestone', milestone.id),
    });
  }
  for (const project of items.projects || []) {
    const done = String(project.status || '').toLowerCase() === 'completed';
    if (done && !includeCompleted) continue;
    records.push({
      uid: `project-deadline-${project.id}@ledger.app`, itemType: 'project_deadline', itemId: project.id,
      title: `Deadline: ${project.name || 'Untitled project'}`, date: project.end_date,
      status: statusFor(null, done), description: `Project: ${project.name || 'Untitled project'}\nStatus: ${project.status || 'planned'}`,
      created_at: project.created_at, updated_at: project.updated_at, url: itemUrl('project', project.id),
    });
  }
  return records;
}

async function reconcileFeedItems(tokenHash, records) {
  const now = Date.now();
  const currentUids = new Set(records.map((record) => record.uid));
  const existing = await supabase.from('calendar_subscription_feed_items').select('uid, item_type, item_id, tombstoned_at').eq('token_hash', tokenHash);
  if (existing.error) {
    if (/relation .*calendar_subscription_feed_items.*does not exist/i.test(existing.error.message || '')) return [];
    throw existing.error;
  }
  const missing = (existing.data || []).filter((row) => !currentUids.has(row.uid) && !row.tombstoned_at);
  if (missing.length) {
    const updated = await supabase.from('calendar_subscription_feed_items').update({ tombstoned_at: new Date(now).toISOString() }).eq('token_hash', tokenHash).in('uid', missing.map((row) => row.uid));
    if (updated.error) throw updated.error;
  }
  if (records.length) {
    const upserted = await supabase.from('calendar_subscription_feed_items').upsert(records.map((record) => ({ token_hash: tokenHash, item_type: record.itemType, item_id: record.itemId, uid: record.uid, last_seen_at: new Date(now).toISOString(), tombstoned_at: null })), { onConflict: 'token_hash,uid' });
    if (upserted.error) throw upserted.error;
  }
  return (existing.data || []).filter((row) => row.tombstoned_at && now - new Date(row.tombstoned_at).getTime() <= TOMBSTONE_RETENTION_MS);
}

function tombstoneLines(row) {
  return ['BEGIN:VEVENT', `UID:${row.uid}`, `DTSTAMP:${toICalDateTime(row.tombstoned_at)}`, 'SEQUENCE:1', 'STATUS:CANCELLED', 'END:VEVENT'].flatMap(foldICalLine);
}

app.get('/ical/:token.ics', async (req, res) => {
  const { token } = req.params;
  let resolved = null;

  try {
    resolved = await resolveSubscription(token);
    if (!resolved) {
      return res.status(404).type('text/plain').send('Invalid or inactive calendar token.');
    }
    if (resolved.disabled) {
      return res.status(410).type('text/plain').send('This calendar subscription is disabled.');
    }
    const items = await fetchSubscriptionItems(resolved);
    if (items.accessDenied) {
      if (resolved.subscription.id) {
        await supabase.from('calendar_subscriptions').update({ enabled: false, updated_at: new Date().toISOString(), last_error_at: new Date().toISOString(), last_error: 'Workspace access removed.' }).eq('id', resolved.subscription.id);
      }
      return res.status(410).type('text/plain').send('This calendar subscription is no longer available.');
    }
    const tokenHash = hashToken(token);
    const records = buildExportRecords(items, resolved);
    const tombstones = await reconcileFeedItems(tokenHash, records);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ledger//Calendar Subscription//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Ledger',
      `X-WR-TIMEZONE:${safeTimezone(DEFAULT_TIMEZONE)}`,
    ];

    for (const record of records) {
      try {
        lines.push(...itemLines(record));
      } catch (recordError) {
        console.warn(`[ical] Skipping invalid ${record.itemType}:${record.itemId}: ${recordError.message}`);
      }
    }
    for (const tombstone of tombstones) lines.push(...tombstoneLines(tombstone));

    lines.push('END:VCALENDAR');
    const body = `${lines.join('\r\n')}\r\n`;
    const etag = `"${crypto.createHash('sha256').update(body).digest('hex')}"`;
    const timestamps = [
      resolved.subscription.updated_at,
      ...records.flatMap((record) => [record.updated_at, record.created_at]),
      ...tombstones.map((row) => row.tombstoned_at),
    ]
      .map((value) => new Date(value || 0).getTime())
      .filter((value) => Number.isFinite(value) && value > 0);
    const lastModified = new Date(timestamps.length ? Math.max(...timestamps) : 0);
    const ifNoneMatch = String(req.headers['if-none-match'] || '');
    const ifModifiedSince = Date.parse(String(req.headers['if-modified-since'] || ''));
    const notModifiedByEtag = ifNoneMatch.split(',').map((value) => value.trim()).includes(etag);
    const notModifiedByDate = !ifNoneMatch && Number.isFinite(ifModifiedSince) && lastModified.getTime() > 0 && ifModifiedSince >= lastModified.getTime();
    res
      .status(notModifiedByEtag || notModifiedByDate ? 304 : 200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=300, must-revalidate')
      .setHeader('ETag', etag)
      .setHeader('Last-Modified', lastModified.toUTCString());
    if (resolved.subscription.id) {
      await supabase.from('calendar_subscriptions').update({ last_accessed_at: new Date().toISOString(), last_generated_at: new Date().toISOString(), last_error: null, last_error_at: null }).eq('id', resolved.subscription.id);
    }
    if (!notModifiedByEtag && !notModifiedByDate) res.send(body);
    else res.end();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ical] Feed generation failed: ${msg}`);
    if (resolved?.subscription?.id) {
      await supabase.from('calendar_subscriptions').update({ last_error_at: new Date().toISOString(), last_error: String(msg).slice(0, 500) }).eq('id', resolved.subscription.id);
    }
    res.status(500).type('text/plain').send('Calendar feed temporarily unavailable.');
  }
});

app.post('/sync-tokens', async (req, res) => {
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const existing = await supabase
      .from('calendar_sync_tokens')
      .select('token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.token) return res.status(200).json({ token: existing.data.token });

    const token = crypto.randomBytes(24).toString('hex');

    const { data, error } = await supabase
      .from('calendar_sync_tokens')
      .insert({
        user_id: userId,
        token,
        is_active: true,
      })
      .select('token')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: error?.message || 'Failed to create token' });
    }

    return res.status(201).json({ token: data.token });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`ledger-ical service running on port ${PORT}`);
});
