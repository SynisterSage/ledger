import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotesHomeAskContext } from './notesHomeAskContext.ts';
import { routeAskLedgerMessage } from '../../types/askLedgerResponseMode.ts';

test('creates a workspace-wide Notes Home context without using the visible list as an anchor', () => {
  const context = createNotesHomeAskContext(
    'workspace-a',
    'What did I write about mobile recently?'
  );

  assert.deepEqual(context, {
    resourceType: 'note',
    resourceId: 'notes-home:workspace-a',
    title: 'Notes workspace',
    contextType: 'notes_home',
    workspaceId: 'workspace-a',
    origin: 'notes_home',
    initialQuestion: 'What did I write about mobile recently?',
  });
});

test('does not create an unscoped Notes Home context', () => {
  assert.equal(createNotesHomeAskContext(null, 'Find the pricing note.'), null);
  assert.equal(createNotesHomeAskContext('workspace-a', '   '), null);
});

test('Notes Home context forces grounded workspace retrieval', () => {
  const context = createNotesHomeAskContext('workspace-a', 'Summarize my recent meeting notes.');
  assert.ok(context);
  const route = routeAskLedgerMessage('Summarize my recent meeting notes.', {
    explicitContext: context,
  });
  assert.equal(route.retrievalRequired, true);
  assert.equal(route.mode, 'workspace_grounded');
});
