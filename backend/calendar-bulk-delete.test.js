import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bulk deletion is routed through the atomic database function', async () => {
  const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  const migration = await readFile(
    new URL('../migrations/138_atomic_calendar_event_bulk_delete.sql', import.meta.url),
    'utf8'
  );
  assert.ok(server.includes("app.post('/api/events/bulk-delete'"));
  assert.ok(server.includes("supabase.rpc('bulk_delete_calendar_events'"));
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bulk_delete_calendar_events/);
  assert.match(migration, /DELETE FROM public\.events/);
  assert.match(migration, /Calendar event set changed before deletion/);
  assert.match(migration, /calendar_event_deleted = TRUE/);
});

test('bulk deletion requires reviewed IDs and blocks provider-backed events', async () => {
  const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('normalizeBulkEventIds(req.body?.event_ids)'));
  assert.ok(server.includes('isBulkDeleteEligibleCalendarEvent(row)'));
  assert.ok(server.includes('rows.length !== eventIds.length'));
});
