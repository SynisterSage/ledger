const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function escapeICalText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toICalDateTime(dateLike) {
  const iso = new Date(dateLike).toISOString();
  return iso.replace(/[-:]/g, '').replace('.000', '');
}

function foldICalLine(line) {
  if (line.length <= 74) return [line];
  const out = [];
  let remaining = line;
  while (remaining.length > 74) {
    out.push(remaining.slice(0, 74));
    remaining = ` ${remaining.slice(74)}`;
  }
  out.push(remaining);
  return out;
}

async function resolveUserFromToken(token) {
  const { data, error } = await supabase
    .from('calendar_sync_tokens')
    .select('user_id')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Token lookup failed: ${error.message}`);
  }

  return data?.user_id ?? null;
}

async function fetchEventsForUser(userId) {
  const { data: workspaces, error: workspaceErr } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId);

  if (workspaceErr) {
    throw new Error(`Workspace lookup failed: ${workspaceErr.message}`);
  }

  const workspaceIds = (workspaces || []).map((w) => w.id);
  if (workspaceIds.length === 0) return [];

  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, title, notes, location, start_at, end_at, status, updated_at, created_at, all_day')
    .in('workspace_id', workspaceIds)
    .order('start_at', { ascending: true });

  if (eventsErr) {
    throw new Error(`Events lookup failed: ${eventsErr.message}`);
  }

  return events || [];
}

app.get('/ical/:token.ics', async (req, res) => {
  const { token } = req.params;

  try {
    const userId = await resolveUserFromToken(token);
    if (!userId) {
      return res.status(404).type('text/plain').send('Invalid or inactive calendar token.');
    }

    const events = await fetchEventsForUser(userId);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ledger//Accountability Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Ledger',
      'X-WR-TIMEZONE:UTC',
    ];

    for (const event of events) {
      const uid = `${event.id}@ledger`;
      const dtStamp = toICalDateTime(event.updated_at || event.created_at || event.start_at);
      const dtStart = toICalDateTime(event.start_at);
      const dtEnd = toICalDateTime(event.end_at);

      const summary = escapeICalText(event.title || 'Untitled Event');
      const description = escapeICalText(event.notes || '');
      const location = escapeICalText(event.location || '');
      const statusMap = {
        planned: 'CONFIRMED',
        done: 'CONFIRMED',
        missed: 'CANCELLED',
        cancelled: 'CANCELLED',
      };
      const icalStatus = statusMap[event.status] || 'CONFIRMED';

      const eventLines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${summary}`,
        `STATUS:${icalStatus}`,
      ];

      if (description) eventLines.push(`DESCRIPTION:${description}`);
      if (location) eventLines.push(`LOCATION:${location}`);
      eventLines.push('END:VEVENT');

      for (const ln of eventLines) {
        lines.push(...foldICalLine(ln));
      }
    }

    lines.push('END:VCALENDAR');

    res
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(lines.join('\r\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).type('text/plain').send(`iCal generation failed: ${msg}`);
  }
});

app.post('/sync-tokens', async (req, res) => {
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    await supabase
      .from('calendar_sync_tokens')
      .delete()
      .eq('user_id', userId);

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
