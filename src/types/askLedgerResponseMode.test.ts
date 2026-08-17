import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAskLedgerMessage } from './askLedgerResponseMode.ts';

const groundedSession = {
  previousQuestion: 'What is blocking Project A?',
  previousAnswer: 'The launch checklist is waiting on approval.',
  previousSources: [{ resourceType: 'project', resourceId: 'project-a', title: 'Project A' }],
};

test('routes non-workspace conversation without retrieval', () => {
  for (const message of [
    'hey',
    'thanks',
    'what can you do?',
    'make that shorter',
    'explain that more simply',
  ]) {
    const route = routeAskLedgerMessage(message, groundedSession);
    assert.equal(
      route.mode,
      ['make that shorter', 'explain that more simply'].includes(message)
        ? 'follow_up'
        : 'conversational'
    );
    assert.equal(route.retrievalRequired, false);
  }
  assert.equal(routeAskLedgerMessage('hey').mode, 'conversational');
});

test('routes workspace facts through grounding', () => {
  for (const message of [
    'What is blocking Project A?',
    'Is Task X done?',
    'What did we decide in the meeting?',
  ]) {
    const route = routeAskLedgerMessage(message);
    assert.equal(route.mode, 'workspace_grounded');
    assert.equal(route.retrievalRequired, true);
  }
});

test('distinguishes factual and transformation follow-ups', () => {
  const factual = routeAskLedgerMessage('What about the mobile side?', groundedSession);
  assert.equal(factual.mode, 'follow_up');
  assert.equal(factual.retrievalRequired, true);

  const transformation = routeAskLedgerMessage('Explain that more simply.', groundedSession);
  assert.equal(transformation.mode, 'follow_up');
  assert.equal(transformation.retrievalRequired, false);
  assert.equal(transformation.reusePreviousGroundedContext, true);
});

test('prefers grounding for ambiguous references', () => {
  const route = routeAskLedgerMessage("What's happening with that?", groundedSession);
  assert.equal(route.mode, 'follow_up');
  assert.equal(route.retrievalRequired, true);
});

test('selected skills, attachments, and explicit context force grounding', () => {
  assert.equal(routeAskLedgerMessage('thanks', { hasSelectedSkill: true }).retrievalRequired, true);
  assert.equal(routeAskLedgerMessage('hey', { attachmentCount: 1 }).retrievalRequired, true);
  assert.equal(
    routeAskLedgerMessage('hello', {
      explicitContext: { resourceType: 'project', resourceId: 'p1', title: 'Project A' },
    }).retrievalRequired,
    true
  );
});

test('routes capability questions as trusted conversational requests', () => {
  for (const message of [
    'What can you help me with?',
    'Can you read PDFs?',
    'Can you create tasks?',
    'What are Skills?',
  ]) {
    const route = routeAskLedgerMessage(message);
    assert.equal(route.mode, 'conversational');
    assert.equal(route.retrievalRequired, false);
    assert.equal(route.reason, 'capability_question');
  }
});

test('infers adaptive depth independently of the response route', () => {
  assert.equal(routeAskLedgerMessage('Is Task X done?').answerDepth, 'brief');
  assert.equal(routeAskLedgerMessage("What's blocking Project A?").answerDepth, 'standard');
  assert.equal(
    routeAskLedgerMessage('Explain in detail why Project A is blocked.').answerDepth,
    'detailed'
  );
  assert.equal(routeAskLedgerMessage('Make that shorter.', groundedSession).answerDepth, 'brief');
  assert.equal(routeAskLedgerMessage('Why?', groundedSession).answerDepth, 'detailed');
  assert.equal(routeAskLedgerMessage('What came out of the meeting?').answerDepth, 'standard');
});
