import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAskLedgerProductKnowledge } from './askLedgerProductKnowledge.ts';
import { routeAskLedgerMessage } from './askLedgerResponseMode.ts';

test('selects one canonical node for common product questions', () => {
  const cases = [
    ['What does GitHub integration do?', 'integrations.github'],
    ['What features does Calendar have?', 'calendar.overview'],
    ['How do Notes work?', 'notes.overview'],
    ['How does smart date capture work?', 'notes.smart_dates'],
  ] as const;
  for (const [question, nodeId] of cases) {
    const selection = selectAskLedgerProductKnowledge(question);
    assert.deepEqual(selection.nodes.map((node) => node.id), [nodeId]);
    assert.ok(selection.tokenCount > 0);
    assert.match(selection.context, /LEDGER PRODUCT KNOWLEDGE/);
  }
});

test('uses the previous product area for a more specific follow-up', () => {
  const selection = selectAskLedgerProductKnowledge('What about slash commands?', {
    previousQuestion: 'What does Notes do?',
    previousExecutionMode: 'ledger_product_help',
  });
  assert.deepEqual(selection.nodes.map((node) => node.id), ['notes.slash_commands']);
  assert.equal(selection.resolutionConfidence, 0.96);

  const dateFollowUp = selectAskLedgerProductKnowledge('What about the date stuff?', {
    previousQuestion: 'What does Notes do?',
    previousProductArea: 'notes',
    previousProductFeature: undefined,
  });
  assert.deepEqual(dateFollowUp.nodes.map((node) => node.id), ['notes.smart_dates']);
  assert.equal(dateFollowUp.resolutionReason, 'intent_match + previous_product_context');
  assert.equal(dateFollowUp.resolutionConfidence, 0.91);
});

test('resolves deeper implemented integrations without workspace records', () => {
  for (const [question, nodeId] of [
    ['What does Google Drive do in Ledger?', 'integrations.google_drive'],
    ['How does Figma work?', 'integrations.figma'],
    ['What can Apple Calendar do?', 'integrations.apple_calendar'],
    ['What about Apple Reminders?', 'integrations.apple_reminders'],
    ['How does the Browser Extension work?', 'integrations.browser_extension'],
    ['What are MCP connections?', 'integrations.mcp'],
  ] as const) {
    const selection = selectAskLedgerProductKnowledge(question);
    assert.deepEqual(selection.nodes.map((node) => node.id), [nodeId], question);
    assert.ok(selection.resolutionConfidence >= 0.9, question);
  }
});

test('expands comprehensive area questions without injecting the whole registry', () => {
  const selection = selectAskLedgerProductKnowledge('Walk me through everything Notes can do');
  assert.ok(selection.nodes.length > 1);
  assert.ok(selection.nodes.length < 20);
  assert.ok(selection.nodes.every((node) => node.area === 'notes'));
});

test('missing product knowledge stays bounded and does not fall back to workspace', () => {
  const selection = selectAskLedgerProductKnowledge('What is the Notes automation graph feature?');
  assert.equal(selection.nodes.length, 0);
  assert.ok(selection.missingTopic);
  assert.match(selection.context, /No authoritative Ledger product knowledge/);

  const route = routeAskLedgerMessage('What is the Notes automation graph feature?');
  assert.equal(route.executionMode, 'ledger_product_help');
  assert.equal(route.retrievalRequired, false);
});

test('paired GitHub, Calendar, and Notes questions keep product and workspace intent separate', () => {
  const productCases = [
    'What does GitHub integration do?',
    'What features does Calendar have?',
    'How do Notes work?',
  ];
  const workspaceCases = [
    'What GitHub issues do I have?',
    'Show my GitHub issues.',
    "What's on my calendar today?",
    'Show my latest notes',
  ];
  for (const question of productCases) {
    const route = routeAskLedgerMessage(question);
    assert.equal(route.executionMode, 'ledger_product_help', question);
    assert.equal(route.retrievalRequired, false, question);
  }
  for (const question of workspaceCases) {
    const route = routeAskLedgerMessage(question);
    assert.notEqual(route.executionMode, 'ledger_product_help', question);
    assert.equal(route.retrievalRequired, true, question);
  }
  const capability = routeAskLedgerMessage('Can my GitHub issues appear in Ledger?');
  assert.equal(capability.executionMode, 'ledger_product_help');
  assert.equal(capability.retrievalRequired, false);
});

test('covers product/workspace collisions across the major Ledger areas', () => {
  const productQuestions = [
    'What does Projects do?',
    'What can I do in Tasks?',
    'What are Meetings?',
    'What does Slack integration do?',
    'What does Google Drive do in Ledger?',
    'What is the Figma integration?',
    'What can Apple Calendar do?',
    'What can Apple Reminders do?',
  ];
  const workspaceQuestions = [
    'Show my projects.',
    'What tasks are due?',
    'What meetings do I have Friday?',
    'Show my Slack issues.',
    'Show my latest Drive captures.',
    'What Figma items are linked to my project?',
    'What is on my Apple Calendar today?',
    'Show my Apple Reminders for tomorrow.',
  ];
  for (const question of productQuestions) {
    const route = routeAskLedgerMessage(question);
    assert.equal(route.executionMode, 'ledger_product_help', question);
    assert.equal(route.retrievalRequired, false, question);
  }
  for (const question of workspaceQuestions) {
    const route = routeAskLedgerMessage(question);
    assert.notEqual(route.executionMode, 'ledger_product_help', question);
    assert.equal(route.retrievalRequired, true, question);
  }
});

test('resolves ambiguous product follow-ups from the previous topic', () => {
  const cases = [
    ['What about that?', 'How does GitHub work?', 'integrations.github'],
    ['Can it do that?', 'What does Notes do?', 'notes.overview'],
    ['What about issues?', 'How does GitHub work?', 'integrations.github'],
    ['How does sync work?', 'What does Calendar do?', 'calendar.sync'],
    ['Does that show up there?', 'What does Calendar do?', 'calendar.overview'],
  ] as const;
  for (const [question, previousQuestion, nodeId] of cases) {
    const selection = selectAskLedgerProductKnowledge(question, {
      previousQuestion,
      previousExecutionMode: 'ledger_product_help',
    });
    assert.deepEqual(selection.nodes.map((node) => node.id), [nodeId], question);
  }
  const switched = routeAskLedgerMessage('Okay, show me my issues.', {
    previousQuestion: 'How does GitHub work?',
    previousExecutionMode: 'ledger_product_help',
  });
  assert.notEqual(switched.executionMode, 'ledger_product_help');
  assert.equal(switched.retrievalRequired, true);
});
