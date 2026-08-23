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
    'HIII',
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
  const greeting = routeAskLedgerMessage('HIII', groundedSession);
  assert.equal(greeting.reason, 'casual_conversation');
  assert.equal(greeting.reusePreviousGroundedContext, false);
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

test('keeps meeting-planning requests grounded despite capability wording', () => {
  const route = routeAskLedgerMessage('Can you help me plan a meeting I have soon? Look through my recent notes and help me be detailed.');
  assert.equal(route.mode, 'workspace_grounded');
  assert.equal(route.retrievalRequired, true);
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

test('reuses grounded context when the user explicitly asks not to search again', () => {
  const route = routeAskLedgerMessage(
    'with this context and not really searching can you give me structure for my next workday meeting',
    groundedSession
  );
  assert.equal(route.mode, 'follow_up');
  assert.equal(route.retrievalRequired, false);
  assert.equal(route.reusePreviousGroundedContext, true);
  assert.equal(route.reason, 'grounded_context_reuse');
});

test('keeps explicit existing-resource requests as fresh retrieval', () => {
  const route = routeAskLedgerMessage('look through my last 3 notes in Workday meetings', groundedSession);
  assert.equal(route.retrievalRequired, true);
  assert.equal(route.reusePreviousGroundedContext, false);
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

test('routes direct Ledger capability wording without workspace retrieval', () => {
  const route = routeAskLedgerMessage('what does ledger do');
  assert.equal(route.reason, 'capability_question');
  assert.equal(route.retrievalRequired, false);
  assert.equal(route.mode, 'conversational');
});

test('routes Ledger product help separately from workspace data', () => {
  for (const message of [
    'What is Ledger?',
    'What does Ledger do?',
    'What does the Calendar page have?',
    'What features does Notes have?',
    'Can Ledger transcribe meetings?',
    'Does Ledger support GitHub?',
    'Does Calendar have a week view?',
  ]) {
    const route = routeAskLedgerMessage(message);
    assert.equal(route.executionMode, 'ledger_product_help', message);
    assert.equal(route.retrievalRequired, false, message);
    assert.equal(route.diagnostics.productHelpDetected, true, message);
    assert.equal(route.diagnostics.workspaceDataIntentDetected, false, message);
  }
  for (const message of [
    "What's on my calendar today?",
    'Show my notes from yesterday.',
    'What tasks are due?',
    'What meetings do I have Friday?',
  ]) {
    const route = routeAskLedgerMessage(message);
    assert.notEqual(route.executionMode, 'ledger_product_help', message);
    assert.equal(route.retrievalRequired, true, message);
  }
});

test('keeps general software questions in conversation', () => {
  for (const message of ["What's a calendar API?", "What's Markdown?", 'What is transcription?']) {
    const route = routeAskLedgerMessage(message);
    assert.equal(route.executionMode, 'conversation', message);
    assert.equal(route.retrievalRequired, false, message);
  }
});

test('preserves and switches product-help context naturally', () => {
  const product = routeAskLedgerMessage('What is Ledger?');
  assert.equal(routeAskLedgerMessage('What does it do though?', { previousQuestion: 'What is Ledger?', previousExecutionMode: product.executionMode }).executionMode, 'ledger_product_help');
  assert.equal(routeAskLedgerMessage('Who made it?', { previousQuestion: 'What does Ledger do?', previousExecutionMode: 'ledger_product_help' }).executionMode, 'ledger_product_help');
  assert.equal(routeAskLedgerMessage('What about slash commands?', { previousQuestion: 'What does Notes do?', previousExecutionMode: 'ledger_product_help' }).executionMode, 'ledger_product_help');
  const workspace = routeAskLedgerMessage('Show me my notes from yesterday.', { previousQuestion: 'What does Notes do?', previousExecutionMode: 'ledger_product_help' });
  assert.notEqual(workspace.executionMode, 'ledger_product_help');
  assert.equal(workspace.retrievalRequired, true);
  assert.equal(routeAskLedgerMessage('Does Calendar have a week view?', { previousQuestion: "What's on my calendar today?", previousExecutionMode: 'workspace_lookup' }).executionMode, 'ledger_product_help');
});

test('does not route project work questions to product help', () => {
  const route = routeAskLedgerMessage('Pigmented Perceptions: what is left to do? I have a meeting next week.', {
    previousExecutionMode: 'ledger_product_help',
    previousProductArea: 'projects',
    previousQuestion: 'What are Projects in Ledger?',
  });
  assert.notEqual(route.executionMode, 'ledger_product_help');
  assert.equal(route.retrievalRequired, true);
});

test('does not route other resource-state questions to product help', () => {
  for (const message of [
    'What tasks are left for the Alfa project?',
    'What is the status of my meeting follow-up?',
    'Which notes mention the next step?',
    'Are any reminders overdue?',
  ]) {
    const route = routeAskLedgerMessage(message, { previousExecutionMode: 'ledger_product_help', previousProductArea: 'projects' });
    assert.notEqual(route.executionMode, 'ledger_product_help', message);
    assert.equal(route.retrievalRequired, true, message);
  }
});

test('keeps linked team resources in workspace retrieval after a team answer', () => {
  const route = routeAskLedgerMessage('What are notes tied with this team?', {
    previousQuestion: 'How are my teamspaces? Does anyone in my circle have tasks?',
    previousAnswer: '## Teamspaces\n- Design — Sarah Daily, Lex Ferguson',
    previousSources: [{ resourceType: 'team', resourceId: 'design-team' }],
    previousExecutionMode: 'workspace_lookup',
  });
  assert.equal(route.executionMode, 'workspace_lookup');
  assert.equal(route.retrievalRequired, true);
  assert.equal(route.reusePreviousGroundedContext, false);
  assert.equal(route.reason, 'referential_workspace_follow_up');
});

test('routes teamspace questions to workspace retrieval even without prior context', () => {
  const linkedNotes = routeAskLedgerMessage('What notes are tied with this team?');
  assert.equal(linkedNotes.executionMode, 'workspace_lookup');
  assert.equal(linkedNotes.retrievalRequired, true);

  const teamspaces = routeAskLedgerMessage('How are my teamspaces? Does anyone in my circle have tasks?');
  assert.equal(teamspaces.executionMode, 'workspace_lookup');
  assert.equal(teamspaces.retrievalRequired, true);
});

test('follows multi-turn mode transitions instead of inheriting stale mode', () => {
  let context = { previousQuestion: '', previousAnswer: '', previousSources: [], previousExecutionMode: undefined as undefined | 'conversation' | 'ledger_product_help' | 'workspace_lookup' | 'workspace_synthesis' | 'workspace_research' | 'skills' };
  const turn = (question: string, extra: Record<string, unknown> = {}) => {
    const route = routeAskLedgerMessage(question, { ...context, ...extra } as never);
    context = { ...context, previousQuestion: question, previousExecutionMode: route.executionMode };
    return route;
  };

  assert.equal(turn('What does Notes do?').executionMode, 'ledger_product_help');
  assert.equal(turn('What about transcription?').executionMode, 'ledger_product_help');
  const transcript = turn('Summarize my latest transcript.');
  assert.equal(transcript.executionMode, 'workspace_synthesis');
  assert.equal(transcript.diagnostics.contextReset, true);
  assert.equal(transcript.diagnostics.transitionReason, 'explicit_workspace_data_request');
  assert.equal(turn('How does transcription work in Ledger?').executionMode, 'ledger_product_help');
  const project = turn('Show me the project connected to that meeting.');
  assert.equal(project.executionMode, 'workspace_lookup');
  assert.equal(project.diagnostics.contextReset, true);
});

test('keeps skills distinct from product questions and supports skill follow-ups', () => {
  const product = routeAskLedgerMessage('What does Plan My Week do?');
  assert.equal(product.executionMode, 'ledger_product_help');
  assert.equal(product.retrievalRequired, false);

  const skill = routeAskLedgerMessage('Plan my week.', { hasSelectedSkill: true });
  assert.equal(skill.executionMode, 'skills');
  assert.equal(skill.retrievalRequired, true);
  assert.equal(skill.diagnostics.selectedExecutionMode, 'skills');

  const skillFollowUp = routeAskLedgerMessage('How did you decide that?', {
    previousQuestion: 'Plan my week.',
    previousExecutionMode: 'skills',
    previousSkill: 'plan_my_week',
    previousSources: [{ resourceType: 'task', resourceId: 'task-1' }],
  });
  assert.equal(skillFollowUp.executionMode, 'skills');
  assert.equal(skillFollowUp.retrievalRequired, false);
  assert.equal(skillFollowUp.reusePreviousGroundedContext, true);

  const workspace = routeAskLedgerMessage('Show me my tasks.', {
    previousQuestion: 'Plan my week.',
    previousExecutionMode: 'skills',
    previousSkill: 'plan_my_week',
  });
  assert.equal(workspace.executionMode, 'workspace_lookup');
  assert.equal(workspace.diagnostics.contextReset, true);
});

test('does not retrieve for context-free ambiguous references', () => {
  for (const question of ['What about that?', 'Show me those.', 'What about mine?', 'Summarize it.']) {
    const route = routeAskLedgerMessage(question);
    assert.equal(route.executionMode, 'conversation', question);
    assert.equal(route.retrievalRequired, false, question);
  }
});

test('reports explicit product and workspace transition reasons', () => {
  const product = routeAskLedgerMessage('Does Calendar support tasks?', { previousExecutionMode: 'workspace_lookup', previousQuestion: "What's on my calendar today?" });
  assert.equal(product.executionMode, 'ledger_product_help');
  assert.equal(product.diagnostics.previousExecutionMode, 'workspace_lookup');
  assert.equal(product.diagnostics.contextReset, true);
  assert.equal(product.diagnostics.transitionReason, 'explicit_product_question');

  const workspace = routeAskLedgerMessage('Which tasks are on mine tomorrow?', { previousExecutionMode: 'ledger_product_help', previousQuestion: 'Does Calendar support tasks?' });
  assert.equal(workspace.executionMode, 'workspace_lookup');
  assert.equal(workspace.diagnostics.transitionReason, 'explicit_workspace_data_request');
});

test('routes informal capability questions conversationally', () => {
  const route = routeAskLedgerMessage('what do u do');
  assert.equal(route.mode, 'conversational');
  assert.equal(route.retrievalRequired, false);
  assert.equal(route.reason, 'capability_question');
});

test('uses positive workspace evidence instead of generic factual wording', () => {
  for (const message of ['lol yeah', 'what do you think?', 'why would someone do that?', "what's a mutex?", 'tell me more about that idea']) {
    const route = routeAskLedgerMessage(message);
    assert.equal(route.executionMode, 'conversation');
    assert.equal(route.retrievalRequired, false);
  }
  assert.equal(routeAskLedgerMessage('what tasks are due today?').executionMode, 'workspace_lookup');
  assert.equal(routeAskLedgerMessage('did Sarah respond?').executionMode, 'workspace_lookup');
  assert.equal(routeAskLedgerMessage('summarize my last three meeting notes').executionMode, 'workspace_synthesis');
  assert.equal(routeAskLedgerMessage('look across the project and tell me what is actually blocking us').executionMode, 'workspace_research');
});

test('reuses grounded context for conversational inertia but refreshes new facts', () => {
  const reused = routeAskLedgerMessage("that's kind of annoying", groundedSession);
  assert.equal(reused.executionMode, 'conversation');
  assert.equal(reused.retrievalRequired, false);
  assert.equal(reused.reusePreviousGroundedContext, true);
  const why = routeAskLedgerMessage('why do you think that happened?', groundedSession);
  assert.equal(why.retrievalRequired, false);
  const fresh = routeAskLedgerMessage('Did Sarah ever respond?', groundedSession);
  assert.equal(fresh.executionMode, 'workspace_lookup');
  assert.equal(fresh.retrievalRequired, true);
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
