import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeAskLedgerSessions,
  newestAskLedgerSessionForResource,
  sessionMatchesAskLedgerResource,
} from './askLedgerSessionRestore.ts';

const session = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt,
  ...extra,
});

test('merges duplicate cloud/local records using the newest update', () => {
  const merged = mergeAskLedgerSessions([
    session('same', '2026-09-12T10:00:00.000Z', { value: 'old' }),
    session('same', '2026-09-12T11:00:00.000Z', { value: 'new' }),
  ]);
  assert.deepEqual(merged, [session('same', '2026-09-12T11:00:00.000Z', { value: 'new' })]);
});

test('matches a resource anchor and local-file attachment fallback', () => {
  assert.equal(
    sessionMatchesAskLedgerResource(
      session('note-chat', '2026-09-12T10:00:00.000Z', {
        initialContext: { resourceType: 'note', resourceId: 'note-1' },
      }),
      { resourceType: 'note', resourceId: 'note-1' }
    ),
    true
  );
  assert.equal(
    sessionMatchesAskLedgerResource(
      session('file-chat', '2026-09-12T10:00:00.000Z', {
        messages: [{ attachments: [{ kind: 'file', attachment: { localFileId: 'file-1' } }] }],
      }),
      { resourceType: 'attachment', resourceId: 'file-1' }
    ),
    true
  );
});

test('selects the newest matching resource session', () => {
  const selected = newestAskLedgerSessionForResource(
    [
      session('other', '2026-09-12T12:00:00.000Z', {
        initialContext: { resourceType: 'note', resourceId: 'note-2' },
      }),
      session('target', '2026-09-12T11:00:00.000Z', {
        initialContext: { resourceType: 'note', resourceId: 'note-1' },
      }),
    ],
    { resourceType: 'note', resourceId: 'note-1' }
  );
  assert.equal(selected?.id, 'target');
});
