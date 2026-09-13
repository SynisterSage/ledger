import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAskLedgerQueryPlan } from './askLedgerQueryPlan.ts';

test('builds one compound plan for project, actions, events, and syllabus evidence', () => {
  const plan = buildAskLedgerQueryPlan('For my History of Photo project, what are the next actions, what events do I have, and what does the syllabus PDF say?');
  assert.deepEqual(plan.categories, ['projects', 'tasks', 'events', 'attachments']);
  assert.equal(plan.operation, 'plan');
  assert.equal(plan.entity?.name, 'History of Photo');
  assert.equal(plan.attachment?.kind, 'syllabus');
  assert.equal(plan.ambiguity.detected, false);
});

test('marks unresolved references instead of pretending they identify one resource', () => {
  const plan = buildAskLedgerQueryPlan('What about that?');
  assert.equal(plan.followUp.likely, true);
  assert.equal(plan.ambiguity.detected, true);
  assert.ok(plan.ambiguity.reasons.includes('unresolved_reference'));
});

test('treats next class and upcoming meeting wording as event intent', () => {
  assert.deepEqual(buildAskLedgerQueryPlan('When is my next class?').categories, ['events']);
  assert.deepEqual(buildAskLedgerQueryPlan('What is my upcoming meeting?').categories, ['events']);
});
