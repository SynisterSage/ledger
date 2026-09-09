import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('calendar import provenance migration adds scoped batch and series indexes', async () => {
  const migration = await readFile(
    new URL('../migrations/137_calendar_import_provenance.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS import_batch_id UUID/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS import_series_key TEXT/);
  assert.match(migration, /workspace_id, import_batch_id/);
  assert.match(migration, /workspace_id, calendar_id, import_series_key/);
});

test('ICS import preserves UID-derived series identity and one batch identity', async () => {
  const source = await readFile(
    new URL('../src/components/Calendar/CalendarWindow.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(source.includes('const importSeriesKey = props.UID?.[0]?.trim() || undefined'));
  assert.ok(source.includes('const importBatchId = crypto.randomUUID()'));
  assert.ok(source.includes('import_batch_id: importBatchId'));
  assert.ok(source.includes('import_series_key: evt.importSeriesKey ?? null'));
});

test('event API selects and persists imported provenance', async () => {
  const source = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  assert.match(source, /import_batch_id, import_series_key, source, source_platform/);
  assert.ok(source.includes('const importBatchId = normalizeNullableText(item?.import_batch_id)'));
  assert.ok(
    source.includes('const importSeriesKey = normalizeNullableText(item?.import_series_key)')
  );
});
