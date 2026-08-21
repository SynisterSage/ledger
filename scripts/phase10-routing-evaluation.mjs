import fs from 'node:fs/promises';
import path from 'node:path';
import { routeAskLedgerMessage } from '../src/types/askLedgerResponseMode.ts';

const grounded = {
  previousQuestion: 'Why is Project Atlas delayed?',
  previousAnswer: 'Approval is pending and the implementation task is blocked.',
  previousSources: [{ resourceType: 'project', resourceId: 'atlas', title: 'Project Atlas' }, { resourceType: 'task', resourceId: 'atlas-task', title: 'Implementation' }],
};
const cases = [
  ['conversation-01', "what's a mutex?", 'conversation', false], ['conversation-02', 'why would someone do that?', 'conversation', false], ['conversation-03', 'what do you think?', 'conversation', false], ['conversation-04', 'lol yeah', 'conversation', false], ['conversation-05', 'explain that differently', 'conversation', false], ['conversation-06', "what's OAuth?", 'conversation', false], ['conversation-07', "what's the difference between RAM and storage?", 'conversation', false], ['conversation-08', 'what is a project manager?', 'conversation', false], ['conversation-09', 'how do meetings usually work?', 'conversation', false], ['conversation-10', 'tell me more about that idea', 'conversation', false],
  ['lookup-01', "what's due today?", 'workspace_lookup', true], ['lookup-02', 'how many overdue tasks do I have?', 'workspace_lookup', true], ['lookup-03', "when is my next meeting?", 'workspace_lookup', true], ['lookup-04', "what meetings are tomorrow?", 'workspace_lookup', true], ['lookup-05', 'when is Atlas due?', 'workspace_lookup', true], ['lookup-06', 'who owns this task?', 'workspace_lookup', true], ['lookup-07', 'show my last three notes', 'workspace_lookup', true], ['lookup-08', 'what reminders are active?', 'workspace_lookup', true], ['lookup-09', 'did Sarah respond?', 'workspace_lookup', true], ['lookup-10', 'what should I do today?', 'workspace_lookup', true],
  ['synthesis-01', 'summarize my last three meeting notes', 'workspace_synthesis', true], ['synthesis-02', 'what happened with Atlas this week?', 'workspace_synthesis', true], ['synthesis-03', 'summarize the last three launch meetings', 'workspace_synthesis', true], ['synthesis-04', 'review my project status and explain the next steps', 'workspace_synthesis', true], ['synthesis-05', 'what patterns do you see across the last few meetings?', 'workspace_synthesis', true], ['synthesis-06', 'plan my week', 'workspace_synthesis', true], ['synthesis-07', 'what did we decide about the launch?', 'workspace_synthesis', true], ['synthesis-08', 'compare this week with last week', 'workspace_synthesis', true], ['synthesis-09', 'summarize my recent notes about Atlas', 'workspace_synthesis', true], ['synthesis-10', 'give me a concise project review', 'workspace_synthesis', true],
  ['research-01', 'look across Atlas and tell me what is blocking launch', 'workspace_research', true], ['research-02', 'what patterns do you see across all the meetings?', 'workspace_research', true], ['research-03', 'connect the project, tasks, and calendar and find conflicts', 'workspace_research', true], ['research-04', 'look across the workspace and tell me what actually matters', 'workspace_research', true], ['research-05', 'analyze dependencies across Atlas', 'workspace_research', true], ['research-06', 'where does the project really stand?', 'workspace_research', true], ['research-07', 'compare the evidence and identify contradictions', 'workspace_research', true], ['research-08', 'find what is keeping launch from moving', 'workspace_research', true], ['research-09', 'tell me the biggest cross-resource risks', 'workspace_research', true], ['research-10', 'what is actually blocking us?', 'workspace_research', true],
  ['followup-01', 'what happened?', 'workspace_lookup', true, grounded], ['followup-02', 'what about that?', 'workspace_lookup', true, grounded], ['followup-03', 'why?', 'conversation', false, grounded], ['followup-04', 'did she respond?', 'workspace_lookup', true, grounded], ['followup-05', 'when is that due?', 'workspace_lookup', true, grounded], ['followup-06', "that's kind of ridiculous", 'conversation', false, grounded], ['followup-07', 'why do you think that happened?', 'conversation', false, grounded], ['followup-08', 'explain that more simply', 'conversation', false, grounded], ['followup-09', 'what did we say about memory?', 'workspace_lookup', true, grounded], ['followup-10', "what's memory?", 'conversation', false, grounded],
  ['ambiguous-01', 'what should we do about this?', 'conversation', false], ['ambiguous-02', 'what happened?', 'conversation', false], ['ambiguous-03', 'when is that due?', 'conversation', false], ['ambiguous-04', 'what is Atlas?', 'conversation', false],
];

const rows = cases.map(([id, question, expectedMode, retrievalExpected, context]) => {
  const route = routeAskLedgerMessage(question, context);
  return { id, question, expectedMode, actualMode: route.executionMode, retrievalExpected, retrievalActual: route.retrievalRequired, passed: route.executionMode === expectedMode && route.retrievalRequired === retrievalExpected, diagnostics: route.diagnostics, reason: route.reason };
});
const byMode = Object.fromEntries(['conversation', 'workspace_lookup', 'workspace_synthesis', 'workspace_research'].map((mode) => {
  const subset = rows.filter((row) => row.expectedMode === mode);
  return [mode, { total: subset.length, correct: subset.filter((row) => row.actualMode === mode).length, accuracy: subset.length ? subset.filter((row) => row.actualMode === mode).length / subset.length : 1 }];
}));
const conversationRows = rows.filter((row) => row.expectedMode === 'conversation');
const retrievalExpectedRows = rows.filter((row) => row.retrievalExpected);
const retrievalNotExpectedRows = rows.filter((row) => !row.retrievalExpected);
const report = {
  phase: 10,
  status: 'static_router_evaluation',
  total: rows.length,
  passed: rows.filter((row) => row.passed).length,
  accuracy: rows.filter((row) => row.passed).length / rows.length,
  byMode,
  conversationAccuracy: conversationRows.filter((row) => row.actualMode === 'conversation').length / conversationRows.length,
  falseRetrievalRate: retrievalNotExpectedRows.filter((row) => row.retrievalActual).length / retrievalNotExpectedRows.length,
  missedRetrievalRate: retrievalExpectedRows.filter((row) => !row.retrievalActual).length / retrievalExpectedRows.length,
  rows,
};
const outputPath = process.env.LEDGER_PHASE10_ROUTING_OUTPUT || path.join(process.cwd(), 'artifacts', 'phase10-live', 'routing-evaluation.json');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, total: report.total, passed: report.passed, accuracy: report.accuracy, falseRetrievalRate: report.falseRetrievalRate, missedRetrievalRate: report.missedRetrievalRate }, null, 2));
