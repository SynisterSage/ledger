import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeAskLedgerActions } from '../src/components/Common/askLedgerActions.ts';

test('proposes a task without inventing optional fields', () => {
  const actions = proposeAskLedgerActions({
    question: 'Create a task to test the Windows runtime.',
    answer: 'Testing the Windows runtime is the next step.',
    sourceMessageId: 'assistant-1',
  });
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].payload, { title: 'test the Windows runtime' });
});

test('extracts a clean title from a note request phrased for the user', () => {
  const actions = proposeAskLedgerActions({
    question: 'Can you make a note for me brainstorming UI/UX ideas for me?',
    answer: 'I prepared a note for your review.',
    sourceMessageId: 'assistant-note-1',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].payload.title, 'brainstorming UI/UX ideas');
});

test('uses the previous answer when a follow-up asks to note this content', () => {
  const actions = proposeAskLedgerActions({
    question: 'Can you make a note of this content?',
    answer: 'The note is prepared and ready for your review.',
    previousAnswer: 'Phase 1: audit the tools. Phase 2: fix deterministic failures.',
    sourceMessageId: 'assistant-note-follow-up-1',
  });
  assert.equal(actions[0].payload.title, 'Ask Ledger notes');
  assert.equal(actions[0].payload.content, 'Phase 1: audit the tools. Phase 2: fix deterministic failures.');
});

test('uses the previous answer when a follow-up asks to note this', () => {
  const actions = proposeAskLedgerActions({
    question: 'Ok can you make a note of this?',
    answer: 'Yes, a note is ready for review.',
    previousAnswer: 'The complete brainstorm plan belongs in the note.',
    sourceMessageId: 'assistant-note-this-1',
  });
  assert.equal(actions[0].payload.title, 'Ask Ledger notes');
  assert.equal(actions[0].payload.content, 'The complete brainstorm plan belongs in the note.');
});

test('proposes a dated reminder with a confirmation payload', () => {
  const actions = proposeAskLedgerActions({
    question: 'Remind me to send the draft on Friday.',
    answer: 'I prepared a reminder for your review.',
    sourceMessageId: 'assistant-reminder-1',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'create_reminder');
  assert.equal(actions[0].payload.title, 'send the draft');
  assert.match(String(actions[0].payload.remind_at), /^20\d\d-/);
});

test('proposes a task status update only with selected task context', () => {
  const actions = proposeAskLedgerActions({
    question: 'Mark this done.',
    answer: 'The task is ready to be completed.',
    initialContext: { resourceType: 'task', resourceId: 'task-1', title: 'Review draft' },
    sourceMessageId: 'assistant-status-1',
  });
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].payload, { task_id: 'task-1', status: 'completed' });
});

test('turns grounded bullets into bounded task proposals with explicit project context', () => {
  const actions = proposeAskLedgerActions({
    question: 'Turn these into tasks.',
    answer: 'I found three action items.',
    previousAnswer: '- Finalize catalog layout\n- Send files for review\n- Schedule follow-up',
    initialContext: { resourceType: 'project', resourceId: 'project-1', title: 'Catalog' },
    sourceMessageId: 'assistant-2',
  });
  assert.deepEqual(actions.map((action) => action.payload), [
    { title: 'Finalize catalog layout', project_id: 'project-1' },
    { title: 'Send files for review', project_id: 'project-1' },
    { title: 'Schedule follow-up', project_id: 'project-1' },
  ]);
});

test('does not propose a mutation for ordinary grounded questions', () => {
  assert.deepEqual(proposeAskLedgerActions({
    question: 'What is blocking the Local AI project?',
    answer: 'The semantic retrieval index has not started.',
    sourceMessageId: 'assistant-3',
  }), []);
});
