import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAskLedgerContext, encodeAskLedgerContext } from './askLedgerContext.ts';

test('project Ask Ledger handoff preserves the workspace and project anchor', () => {
  const encoded = encodeAskLedgerContext({ resourceType: 'project', resourceId: 'project-a', title: 'Watercolor Exhibition', contextType: 'project', workspaceId: 'workspace-a', projectId: 'project-a', origin: 'projects', initialQuestion: 'What should I know right now?' });
  assert.deepEqual(decodeAskLedgerContext(encoded), {
    resourceType: 'project',
    resourceId: 'project-a',
    title: 'Watercolor Exhibition',
    contextType: 'project',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    origin: 'projects',
    initialQuestion: 'What should I know right now?',
  });
});
