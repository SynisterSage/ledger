import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAskLedgerContext, encodeAskLedgerContext } from './askLedgerContext.ts';

test('preserves bounded Overview Focus handoff context through the existing Ask Ledger route', () => {
  const encoded = encodeAskLedgerContext({
    resourceType: 'project',
    resourceId: 'project-alfa',
    title: 'Alfa 2026 Catalog',
    handoff: {
      kind: 'overview_focus',
      workspaceId: 'workspace-a',
      overviewDate: '2026-08-18',
      insights: [{ title: 'Needs attention', summary: 'Past its due date.' }],
      resourceRefs: [{ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa 2026 Catalog' }],
    },
  });
  assert.deepEqual(decodeAskLedgerContext(encoded), {
    resourceType: 'project',
    resourceId: 'project-alfa',
    title: 'Alfa 2026 Catalog',
    handoff: {
      kind: 'overview_focus',
      workspaceId: 'workspace-a',
      overviewDate: '2026-08-18',
      insights: [{ title: 'Needs attention', summary: 'Past its due date.' }],
      resourceRefs: [{ resourceType: 'project', resourceId: 'project-alfa', title: 'Alfa 2026 Catalog' }],
    },
  });
});
