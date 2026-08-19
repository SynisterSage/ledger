import test from 'node:test';
import assert from 'node:assert/strict';
import { createAskLedgerEvaluationCases, createAskLedgerEvaluationDocuments, ASK_LEDGER_EVALUATION_CASE_COUNT } from './askLedgerEvaluationFixtures.ts';
import { classifyAskLedgerEvaluationFailures, evaluateAskLedgerFixtureCase, scoreAskLedgerEvaluationAnswer, summarizeAskLedgerEvaluation } from './askLedgerEvaluation.ts';

test('loads the canonical evaluation fixture with the intended breadth', () => {
  const cases = createAskLedgerEvaluationCases();
  const categories = new Set(cases.map((evaluationCase) => evaluationCase.category));
  assert.equal(cases.length, ASK_LEDGER_EVALUATION_CASE_COUNT);
  assert.equal(createAskLedgerEvaluationDocuments().length >= 20, true);
  assert.equal(categories.size, 8);
  assert.ok(categories.has('simple_facts'));
  assert.ok(categories.has('missing_uncertain_evidence'));
});

test('deterministic answer grading separates facts, forbidden claims, synthesis, and usefulness', () => {
  const result = scoreAskLedgerEvaluationAnswer({ answer: 'Overall, the Alfa project is still blocked because final writing is outstanding. The open task is Review Final Proof. The immediate next step is proof review. This is the current priority.', expectation: { requiredAnswerFacts: ['final writing'], requiredCoverage: ['projects', 'tasks'], forbiddenClaims: ['owner is'] }, evidencePackage: {} as never, validationPassed: true });
  assert.equal(result.completeness, 2);
  assert.equal(result.groundedness, 2);
  assert.equal(result.synthesisQuality, 2);
  assert.equal(result.usefulness, 2);
});

test('classifies pipeline failures without embedding evaluation questions into production logic', () => {
  const failures = classifyAskLedgerEvaluationFailures({ expectation: { primaryResourceKeys: ['project:project-alfa'], contextResourceKeys: ['task:task-review-proof'] }, retrievedKeys: [], evidenceKeys: [], answer: 'The project is in progress.', score: { retrievalCorrectness: 0, contextCoverage: 0, evidenceQuality: 0, answerCompleteness: 0, groundedness: 0, synthesisQuality: 0, usefulness: 0, passed: false }, validationPassed: false, repairAttempted: true, repairSucceeded: false });
  assert.deepEqual(failures, ['wrong_seed', 'missing_relationship_context', 'missing_requested_category', 'unsupported_claim', 'repair_failed']);
});

test('runs a deterministic fixture through retrieval, orchestration, evidence, and validation stages', async () => {
  const evaluationCase = createAskLedgerEvaluationCases().find((candidate) => candidate.id === 'research-tying-summary')!;
  const result = await evaluateAskLedgerFixtureCase(evaluationCase, 'Alfa includes the Final Production milestone and Review Final Proof task.');
  assert.equal(result.caseId, 'research-tying-summary');
  assert.equal(result.stages.route.mode, 'research');
  assert.ok(result.stages.route.objectives.length > 1);
  assert.ok(result.stages.retrieval.candidates > 0);
  assert.ok(result.stages.evidence.selected > 0);
  assert.ok(result.latencyMs.total >= result.latencyMs.retrieval);
});

test('summarizes pass rate, category performance, latency, evidence efficiency, and failures', () => {
  const results = [
    { caseId: 'a', category: 'simple_facts' as const, question: '', score: { retrievalCorrectness: 2 as const, contextCoverage: 2 as const, evidenceQuality: 2 as const, answerCompleteness: 2 as const, groundedness: 2 as const, synthesisQuality: 2 as const, usefulness: 2 as const, passed: true }, failures: [], stages: { route: { mode: 'quick' as const, objectives: [] }, retrieval: { candidates: 1, selectedSeeds: [], primary: [] }, graph: { expandedResources: 0, paths: 0 }, evidence: { retrieved: 1, selected: 1, tokens: 20, selectedKeys: [] }, generation: { depth: 'quick' as const, answer: '', validationPassed: true, repairAttempted: false } }, latencyMs: { retrieval: 1, evidence: 1, validation: 1, total: 3 } },
  ];
  const summary = summarizeAskLedgerEvaluation(results);
  assert.equal(summary.totalCases, 1);
  assert.equal(summary.passRate, 1);
  assert.equal(summary.averageEvidenceResources, 1);
  assert.deepEqual(summary.worstCases, []);
});
