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
