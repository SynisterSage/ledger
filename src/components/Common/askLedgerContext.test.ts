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

test('Notes Home Ask Ledger handoff preserves workspace-wide scope', () => {
  const encoded = encodeAskLedgerContext({
    resourceType: 'note',
    resourceId: 'notes-home:workspace-a',
    title: 'Notes workspace',
    contextType: 'notes_home',
    workspaceId: 'workspace-a',
    origin: 'notes_home',
    initialQuestion: 'What did I write recently?',
  });

  assert.equal(decodeAskLedgerContext(encoded)?.contextType, 'notes_home');
  assert.equal(decodeAskLedgerContext(encoded)?.origin, 'notes_home');
});
