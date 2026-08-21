import assert from 'node:assert/strict';
import test from 'node:test';
import { ASK_LEDGER_PRODUCT_KNOWLEDGE, selectAskLedgerProductKnowledge } from './askLedgerProductKnowledge.ts';
import { routeAskLedgerMessage, type AskLedgerExecutionMode, type AskLedgerRoutingContext } from './askLedgerResponseMode.ts';

type EvaluationCase = {
  question: string;
  mode: AskLedgerExecutionMode;
  knowledgeId?: string;
};

const realLanguageCases: EvaluationCase[] = [
  { question: 'whats the notes page do', mode: 'ledger_product_help', knowledgeId: 'notes.overview' },
  { question: 'can i mention ppl in notes', mode: 'ledger_product_help', knowledgeId: 'notes.people_references' },
  { question: 'how does that date thing work', mode: 'ledger_product_help', knowledgeId: 'notes.smart_dates' },
  { question: 'does projects have milestones', mode: 'ledger_product_help', knowledgeId: 'projects.milestones' },
  { question: 'can github issues show in ledger', mode: 'ledger_product_help', knowledgeId: 'integrations.github' },
  { question: 'show me my github issues', mode: 'workspace_lookup' },
  { question: 'whats on my calendar tmrw', mode: 'workspace_lookup' },
  { question: 'does calendar have a month view', mode: 'ledger_product_help', knowledgeId: 'calendar.views' },
  { question: 'what dates did i put in my notes', mode: 'workspace_lookup' },
  { question: 'does Slack save messages to Ledger', mode: 'ledger_product_help', knowledgeId: 'integrations.slack' },
  { question: 'show my latest Slack messages', mode: 'workspace_lookup' },
  { question: 'what does Apple Calendar do', mode: 'ledger_product_help', knowledgeId: 'integrations.apple_calendar' },
  { question: 'which Apple reminders are due', mode: 'workspace_lookup' },
  { question: 'what does Drive integration do', mode: 'ledger_product_help', knowledgeId: 'integrations.google_drive' },
  { question: 'show files from Google Drive', mode: 'workspace_lookup' },
  { question: 'how does Figma work in Ledger', mode: 'ledger_product_help', knowledgeId: 'integrations.figma' },
  { question: 'show my Figma links', mode: 'workspace_lookup' },
  { question: 'can Ledger connect to MCP', mode: 'ledger_product_help', knowledgeId: 'integrations.mcp' },
  { question: 'what is a calendar API', mode: 'conversation' },
  { question: 'what is markdown', mode: 'conversation' },
  { question: 'what is transcription', mode: 'conversation' },
  { question: 'does Ledger have other planning skills', mode: 'ledger_product_help' },
  { question: 'what does Plan My Week do', mode: 'ledger_product_help' },
];

test('routes messy real-language product and workspace cases without semantic retrieval', () => {
  let productPasses = 0;
  let workspacePasses = 0;
  for (const evaluationCase of realLanguageCases) {
    const route = routeAskLedgerMessage(evaluationCase.question);
    assert.equal(route.executionMode, evaluationCase.mode, evaluationCase.question);
    if (evaluationCase.mode === 'ledger_product_help') {
      productPasses += 1;
      assert.equal(route.retrievalRequired, false, evaluationCase.question);
      if (evaluationCase.knowledgeId) {
        const selection = selectAskLedgerProductKnowledge(evaluationCase.question);
        assert.deepEqual(selection.nodes.map((node) => node.id), [evaluationCase.knowledgeId], evaluationCase.question);
        assert.ok(selection.resolutionConfidence >= 0.78, evaluationCase.question);
      }
    }
    if (evaluationCase.mode.startsWith('workspace_')) {
      workspacePasses += 1;
      assert.equal(route.retrievalRequired, true, evaluationCase.question);
    }
  }
  assert.equal(productPasses, 13);
  assert.equal(workspacePasses, 7);
});

test('keeps product and workspace minimal pairs separate across major areas', () => {
  const pairs: Array<[string, string]> = [
    ['Can GitHub issues appear in Ledger?', 'Which GitHub issues do I have?'],
    ['Can Notes recognize dates?', 'What dates did I put in my notes?'],
    ['Does Calendar support tasks?', 'Which tasks are on my calendar tomorrow?'],
    ['What does Projects do?', 'Show my projects.'],
    ['What does Meetings do?', 'Summarize my latest meeting.'],
    ['What does Slack do?', 'Show my saved Slack messages.'],
    ['What does Apple Calendar do?', 'What is on my Apple Calendar today?'],
    ['What does Apple Reminders do?', 'Which Apple reminders are due?'],
    ['What does Google Drive integration do?', 'Show my Drive files.'],
    ['What does Figma integration do?', 'Show my Figma context.'],
  ];
  for (const [productQuestion, workspaceQuestion] of pairs) {
    const product = routeAskLedgerMessage(productQuestion);
    const workspace = routeAskLedgerMessage(workspaceQuestion);
    assert.equal(product.executionMode, 'ledger_product_help', productQuestion);
    assert.equal(product.retrievalRequired, false, productQuestion);
    assert.ok(workspace.executionMode.startsWith('workspace_'), workspaceQuestion);
    assert.equal(workspace.retrievalRequired, true, workspaceQuestion);
  }
});

test('keeps a 12-turn conversation current while preserving only useful context', () => {
  let context: AskLedgerRoutingContext = {};
  const turns: Array<{ question: string; mode: AskLedgerExecutionMode; skill?: boolean }> = [
    { question: 'What does Notes do?', mode: 'ledger_product_help' },
    { question: 'What about slash commands?', mode: 'ledger_product_help' },
    { question: 'Show my latest notes.', mode: 'workspace_lookup' },
    { question: 'What did I write yesterday?', mode: 'workspace_lookup' },
    { question: 'How do smart dates work?', mode: 'ledger_product_help' },
    { question: 'What about projects?', mode: 'ledger_product_help' },
    { question: 'Plan my week.', mode: 'skills', skill: true },
    { question: 'How did you decide that?', mode: 'skills' },
    { question: 'Show me my tasks tomorrow.', mode: 'workspace_lookup' },
    { question: 'What does Ledger Search do?', mode: 'ledger_product_help' },
    { question: 'What do you think?', mode: 'conversation' },
    { question: 'Show me the project connected to that meeting.', mode: 'workspace_lookup' },
  ];
  for (const [index, turn] of turns.entries()) {
    const route = routeAskLedgerMessage(turn.question, { ...context, hasSelectedSkill: turn.skill });
    assert.equal(route.executionMode, turn.mode, `turn ${index + 1}: ${turn.question}`);
    if (turn.mode === 'ledger_product_help') assert.equal(route.retrievalRequired, false, turn.question);
    if (turn.mode.startsWith('workspace_') || (turn.mode === 'skills' && turn.question === 'Plan my week.')) assert.equal(route.retrievalRequired, true, turn.question);
    if (context.previousExecutionMode && context.previousExecutionMode !== route.executionMode) {
      assert.equal(route.diagnostics.contextReset, true, `turn ${index + 1}: ${turn.question}`);
    }
    context = {
      previousQuestion: turn.question,
      previousAnswer: 'bounded answer',
      previousExecutionMode: route.executionMode,
      previousProductArea: route.executionMode === 'ledger_product_help' ? route.diagnostics.productArea : undefined,
      previousProductFeature: route.executionMode === 'ledger_product_help' ? route.diagnostics.productFeature : undefined,
      previousSkill: turn.skill ? 'plan_my_week' : undefined,
      previousSources: route.executionMode.startsWith('workspace_') || route.executionMode === 'skills' ? [{ resourceType: 'task', resourceId: `task-${index}` }] : [],
    };
  }
});

test('bounds unknown product knowledge and avoids unrelated feature guesses', () => {
  const route = routeAskLedgerMessage('What is the Notes automation graph feature?');
  const selection = selectAskLedgerProductKnowledge('What is the Notes automation graph feature?');
  assert.equal(route.executionMode, 'ledger_product_help');
  assert.equal(route.retrievalRequired, false);
  assert.equal(selection.nodes.length, 0);
  assert.equal(selection.resolutionConfidence < 0.5, true);
  assert.equal(selection.missingTopic, 'What is the Notes automation graph feature?');
});

test('keeps normal product context small and comprehensive requests bounded', () => {
  const specific = selectAskLedgerProductKnowledge('How do slash commands work?');
  const overview = selectAskLedgerProductKnowledge('What does Notes do?');
  const comprehensive = selectAskLedgerProductKnowledge('Walk me through everything Notes can do');
  assert.equal(specific.nodes.length, 1);
  assert.equal(overview.nodes.length, 1);
  assert.ok(specific.tokenCount >= 40 && specific.tokenCount <= 150);
  assert.ok(overview.tokenCount >= 40 && overview.tokenCount <= 200);
  assert.ok(comprehensive.nodes.length > 1 && comprehensive.nodes.length < 12);
  assert.ok(comprehensive.tokenCount > overview.tokenCount);
});

test('keeps the registry canonical and compact', () => {
  const ids = ASK_LEDGER_PRODUCT_KNOWLEDGE.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ASK_LEDGER_PRODUCT_KNOWLEDGE.every((node) => node.summary.length > 0 && node.details.length > 0));
  assert.ok(ASK_LEDGER_PRODUCT_KNOWLEDGE.every((node) => node.aliases.length > 0));
  assert.ok(ASK_LEDGER_PRODUCT_KNOWLEDGE.filter((node) => node.feature === undefined).length >= 10);
});
