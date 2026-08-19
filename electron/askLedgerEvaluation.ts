import { performance } from 'node:perf_hooks';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { AskLedgerAnswerValidator } from './askLedgerAnswerValidator.ts';
import { compileAskLedgerEvidence } from './askLedgerEvidencePipeline.ts';
import { AskLedgerRetrievalOrchestrator, type AskLedgerOrchestrationResult } from './askLedgerRetrievalOrchestrator.ts';
import { EmbeddingIndexService, LedgerRetrievalService, type LexicalCandidate } from './ledgerRetrievalService.ts';
import { inferAskLedgerGenerationDepth } from '../src/types/askLedgerGenerationDepth.ts';
import type { AskLedgerEvidencePackage } from '../src/types/askLedgerResourceContract.ts';
import type { AskLedgerEvaluationCase, AskLedgerEvaluationCategory, AskLedgerEvaluationExpectation } from './askLedgerEvaluationFixtures.ts';
import { createAskLedgerEvaluationCases } from './askLedgerEvaluationFixtures.ts';

export type AskLedgerEvaluationScore = {
  retrievalCorrectness: 0 | 1 | 2;
  contextCoverage: 0 | 1 | 2;
  evidenceQuality: 0 | 1 | 2;
  answerCompleteness: 0 | 1 | 2;
  groundedness: 0 | 1 | 2;
  synthesisQuality: 0 | 1 | 2;
  usefulness: 0 | 1 | 2;
  passed: boolean;
};

export type AskLedgerEvaluationFailureCategory = 'wrong_seed' | 'missing_relationship_context' | 'missing_requested_category' | 'weak_evidence_selection' | 'context_budget_loss' | 'generation_omission' | 'unsupported_claim' | 'incorrect_structured_fact' | 'integration_unavailable' | 'answer_too_shallow' | 'answer_too_verbose' | 'repair_failed';

export type AskLedgerEvaluationResult = {
  caseId: string;
  category: AskLedgerEvaluationCategory;
  question: string;
  score: AskLedgerEvaluationScore;
  failures: AskLedgerEvaluationFailureCategory[];
  stages: {
    route: { mode: 'quick' | 'research'; objectives: string[] };
    retrieval: { candidates: number; selectedSeeds: string[]; primary: string[]; integration?: AskLedgerOrchestrationResult['integrationRetrieval'] };
    graph: { expandedResources: number; paths: number };
    evidence: { retrieved: number; selected: number; tokens: number; selectedKeys: string[] };
    generation: { depth: 'quick' | 'standard' | 'deep'; answer: string; validationPassed: boolean | null; repairAttempted: boolean };
  };
  latencyMs: { retrieval: number; evidence: number; validation: number; total: number };
};

const keyFor = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${item.resourceType}:${item.resourceId}`;
const includesAny = (value: string, needles: string[]) => needles.some((needle) => value.toLowerCase().includes(needle.toLowerCase()));
const score2 = (value: number, total: number): 0 | 1 | 2 => total === 0 ? 2 : value === total ? 2 : value > 0 ? 1 : 0;
const categoryAliases: Record<string, string[]> = { meetings: ['meeting', 'event'], projects: ['project'], milestones: ['milestone'], tasks: ['task', 'next action'], notes: ['note'], transcripts: ['transcript'], reminders: ['reminder'], activity: ['activity', 'changed'], notifications: ['notification', 'alert'], external: ['slack', 'github', 'figma', 'external'] };

const evidenceItems = (result: AskLedgerOrchestrationResult) => result.mode === 'research' ? result.items : result.items;

export const scoreAskLedgerEvaluationAnswer = (input: { answer: string; expectation: AskLedgerEvaluationExpectation; evidencePackage: AskLedgerEvidencePackage; validationPassed: boolean | null }) => {
  const answer = input.answer.toLowerCase();
  const facts = input.expectation.requiredAnswerFacts ?? [];
  const factHits = facts.filter((fact) => answer.includes(fact.toLowerCase())).length;
  const forbiddenHits = (input.expectation.forbiddenClaims ?? []).filter((claim) => answer.includes(claim.toLowerCase()));
  const coverage = input.expectation.requiredCoverage ?? [];
  const coverageHits = coverage.filter((category) => includesAny(answer, categoryAliases[category] ?? [category])).length;
  const completeness = score2(factHits + coverageHits, facts.length + coverage.length);
  const groundedness: 0 | 1 | 2 = input.validationPassed === true && forbiddenHits.length === 0 ? 2 : input.validationPassed === false || forbiddenHits.length ? 0 : 1;
  const sentenceCount = input.answer.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  const synthesisQuality: 0 | 1 | 2 = sentenceCount >= 4 && includesAny(answer, ['because', 'while', 'still', 'overall', 'next', 'blocked', 'immediate']) ? 2 : sentenceCount >= 2 ? 1 : 0;
  const usefulness: 0 | 1 | 2 = includesAny(answer, ['next', 'focus', 'due', 'blocked', 'open', 'priority', 'attention']) ? (sentenceCount >= 3 ? 2 : 1) : 0;
  return { completeness, groundedness, synthesisQuality, usefulness, forbiddenHits };
};

export const classifyAskLedgerEvaluationFailures = (input: { expectation: AskLedgerEvaluationExpectation; retrievedKeys: string[]; evidenceKeys: string[]; answer: string; score: AskLedgerEvaluationScore; validationPassed: boolean | null; repairAttempted: boolean; repairSucceeded?: boolean }): AskLedgerEvaluationFailureCategory[] => {
  const failures: AskLedgerEvaluationFailureCategory[] = [];
  const retrieved = new Set(input.retrievedKeys); const evidence = new Set(input.evidenceKeys);
  if ((input.expectation.primaryResourceKeys ?? []).some((key) => !retrieved.has(key))) failures.push('wrong_seed');
  if ((input.expectation.contextResourceKeys ?? []).some((key) => !evidence.has(key))) failures.push('missing_relationship_context');
  if (input.answer.trim().length > 0 && input.score.answerCompleteness === 0) failures.push('missing_requested_category');
  if (input.expectation.maxEvidenceResources !== undefined && evidence.size > input.expectation.maxEvidenceResources) failures.push('context_budget_loss');
  if (input.score.groundedness === 0) failures.push('unsupported_claim');
  if (input.answer.trim().length > 8000) failures.push('answer_too_verbose');
  if (input.answer.trim().length > 0 && input.score.synthesisQuality === 0 && (input.expectation.requiredCoverage?.length ?? 0) > 1) failures.push('answer_too_shallow');
  if (input.repairAttempted && input.repairSucceeded === false) failures.push('repair_failed');
  if (input.answer.trim().length > 0 && input.expectation.expectedUnavailable?.length && !includesAny(input.answer, input.expectation.expectedUnavailable.map((provider) => `${provider} unavailable`).concat(input.expectation.expectedUnavailable.map((provider) => `could not verify ${provider}`)))) failures.push('integration_unavailable');
  return [...new Set(failures)];
};

export const evaluateAskLedgerFixtureCase = async (evaluationCase: AskLedgerEvaluationCase, answer = ''): Promise<AskLedgerEvaluationResult> => {
  const totalStarted = performance.now();
  const index = new EmbeddingIndexService();
  const retrievalService = new LedgerRetrievalService(index);
  await retrievalService.indexWorkspace(evaluationCase.workspaceId, evaluationCase.documents);
  const orchestrator = new AskLedgerRetrievalOrchestrator(retrievalService);
  const retrievalStarted = performance.now();
  const retrieval = await orchestrator.retrieve(evaluationCase.workspaceId, evaluationCase.question, evaluationCase.lexicalResults as LexicalCandidate[], 20, { documents: evaluationCase.documents });
  const retrievalMs = performance.now() - retrievalStarted;
  const evidenceStarted = performance.now();
  const evidence = compileAskLedgerEvidence({ question: evaluationCase.question, result: retrieval, items: evidenceItems(retrieval) });
  const evidenceMs = performance.now() - evidenceStarted;
  const generationDepth = inferAskLedgerGenerationDepth({ question: evaluationCase.question, retrievalMode: retrieval.mode, orchestration: retrieval.orchestration });
  const validationStarted = performance.now();
  const validation = answer ? new AskLedgerAnswerValidator().validate({ question: evaluationCase.question, answer, evidencePackage: evidence.package, depth: generationDepth.depth }) : null;
  const validationMs = performance.now() - validationStarted;
  const scoreParts = scoreAskLedgerEvaluationAnswer({ answer, expectation: evaluationCase.expectation, evidencePackage: evidence.package, validationPassed: validation?.passed ?? null });
  const retrievedKeys = retrieval.items.map(keyFor);
  const primaryKeys = (retrieval.primaryItems?.length ? retrieval.primaryItems : retrieval.items).map(keyFor);
  const evidenceKeys = evidence.selectedItems.map(keyFor);
  const score: AskLedgerEvaluationScore = {
    retrievalCorrectness: score2((evaluationCase.expectation.primaryResourceKeys ?? []).filter((key) => retrievedKeys.includes(key)).length, evaluationCase.expectation.primaryResourceKeys?.length ?? 0),
    contextCoverage: score2((evaluationCase.expectation.contextResourceKeys ?? []).filter((key) => evidenceKeys.includes(key)).length, evaluationCase.expectation.contextResourceKeys?.length ?? 0),
    evidenceQuality: evidence.selectedItems.length <= (evaluationCase.expectation.maxEvidenceResources ?? 20) && evidence.package.stats.estimatedTokens <= 4200 ? 2 : 1,
    answerCompleteness: scoreParts.completeness,
    groundedness: scoreParts.groundedness,
    synthesisQuality: scoreParts.synthesisQuality,
    usefulness: scoreParts.usefulness,
    passed: Boolean((evaluationCase.expectation.primaryResourceKeys ?? []).every((key) => retrievedKeys.includes(key)) && (evaluationCase.expectation.contextResourceKeys ?? []).every((key) => evidenceKeys.includes(key)) && (validation?.passed ?? true) && scoreParts.forbiddenHits.length === 0),
  };
  const failures = classifyAskLedgerEvaluationFailures({ expectation: evaluationCase.expectation, retrievedKeys, evidenceKeys, answer, score, validationPassed: validation?.passed ?? null, repairAttempted: false });
  return { caseId: evaluationCase.id, category: evaluationCase.category, question: evaluationCase.question, score, failures, stages: { route: { mode: retrieval.mode, objectives: retrieval.orchestration.objectives.map((objective) => objective.id) }, retrieval: { candidates: retrieval.debug.length, selectedSeeds: retrieval.hybridRetrieval?.selectedSeeds?.length ? retrieval.hybridRetrieval.selectedSeeds : primaryKeys, primary: primaryKeys, integration: retrieval.integrationRetrieval }, graph: { expandedResources: retrieval.relatedItems?.length ?? 0, paths: retrieval.graphExpansion?.paths.length ?? 0 }, evidence: { retrieved: evidence.package.stats.retrieved, selected: evidence.package.stats.selected, tokens: evidence.package.stats.estimatedTokens, selectedKeys: evidenceKeys }, generation: { depth: generationDepth.depth, answer, validationPassed: validation?.passed ?? null, repairAttempted: false } }, latencyMs: { retrieval: retrievalMs, evidence: evidenceMs, validation: validationMs, total: performance.now() - totalStarted } };
};

export const summarizeAskLedgerEvaluation = (results: AskLedgerEvaluationResult[]) => {
  const categories = [...new Set(results.map((result) => result.category))];
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    totalCases: results.length,
    passed: results.filter((result) => result.score.passed).length,
    passRate: results.length ? results.filter((result) => result.score.passed).length / results.length : 0,
    byCategory: Object.fromEntries(categories.map((category) => { const group = results.filter((result) => result.category === category); return [category, { cases: group.length, passed: group.filter((result) => result.score.passed).length, passRate: group.filter((result) => result.score.passed).length / group.length }]; })),
    averageLatencyMs: average(results.map((result) => result.latencyMs.total)),
    averageEvidenceResources: average(results.map((result) => result.stages.evidence.selected)),
    averageEvidenceTokens: average(results.map((result) => result.stages.evidence.tokens)),
    failureCategories: Object.fromEntries([...new Set(results.flatMap((result) => result.failures))].map((failure) => [failure, results.filter((result) => result.failures.includes(failure)).length])),
    worstCases: [...results].filter((result) => result.failures.length > 0).sort((left, right) => Number(left.score.passed) - Number(right.score.passed) || left.score.groundedness - right.score.groundedness).slice(0, 5).map((result) => ({ caseId: result.caseId, category: result.category, failures: result.failures })),
  };
};

export const ASK_LEDGER_EVALUATION_THRESHOLDS: Partial<Record<AskLedgerEvaluationCategory, number>> = {
  simple_facts: 0.95,
  resource_understanding: 0.75,
  meeting_intelligence: 0.75,
  cross_resource_research: 0.7,
  task_intelligence: 0.85,
  attention: 0.75,
  integration_context: 0.75,
  missing_uncertain_evidence: 0.85,
};

export const evaluateAskLedgerRegressionThresholds = (summary: ReturnType<typeof summarizeAskLedgerEvaluation>, thresholds = ASK_LEDGER_EVALUATION_THRESHOLDS) => Object.fromEntries(Object.entries(thresholds).map(([category, threshold]) => [category, { threshold, actual: summary.byCategory[category]?.passRate ?? 0, passed: (summary.byCategory[category]?.passRate ?? 0) >= threshold }]));

export const runAskLedgerDeterministicEvaluation = async (cases = createAskLedgerEvaluationCases()) => {
  const results: AskLedgerEvaluationResult[] = [];
  for (const evaluationCase of cases) results.push(await evaluateAskLedgerFixtureCase(evaluationCase));
  const summary = summarizeAskLedgerEvaluation(results);
  return { schemaVersion: 1 as const, generatedAt: new Date().toISOString(), deterministic: true as const, cases: results, summary, thresholds: evaluateAskLedgerRegressionThresholds(summary) };
};

export const renderAskLedgerEvaluationMarkdown = (report: Awaited<ReturnType<typeof runAskLedgerDeterministicEvaluation>>) => {
  const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
  const categoryRows = Object.entries(report.summary.byCategory).map(([category, value]) => `| ${category} | ${value.cases} | ${value.passed} | ${percentage(value.passRate)} |`).join('\n');
  const failureRows = Object.entries(report.summary.failureCategories).sort(([, left], [, right]) => right - left).map(([failure, count]) => `| ${failure} | ${count} |`).join('\n') || '| None | 0 |';
  const worstRows = report.summary.worstCases.map((item) => `| ${item.caseId} | ${item.category} | ${item.failures.join(', ') || 'none'} |`).join('\n');
  return `# Ask Ledger evaluation report

Generated: ${report.generatedAt}

This CI-safe report evaluates the canonical fixture through routing, retrieval, graph/orchestration, and evidence compilation. It does not claim live Qwen answer quality; use the optional live tier run for that.

## Overall

- Cases: ${report.summary.totalCases}
- Deterministic pipeline pass rate: ${percentage(report.summary.passRate)} (${report.summary.passed}/${report.summary.totalCases})
- Average total fixture latency: ${report.summary.averageLatencyMs.toFixed(2)} ms
- Average selected evidence: ${report.summary.averageEvidenceResources.toFixed(1)} resources / ${report.summary.averageEvidenceTokens.toFixed(0)} estimated tokens

## By category

| Category | Cases | Passed | Pass rate |
| --- | ---: | ---: | ---: |
${categoryRows}

## Failure categories

| Failure | Cases |
| --- | ---: |
${failureRows}

## Worst cases

| Case | Category | Failures |
| --- | --- | --- |
${worstRows}

## Thresholds

${Object.entries(report.thresholds).map(([category, value]) => `- ${category}: ${percentage(value.actual)} actual vs ${percentage(value.threshold)} threshold — ${value.passed ? 'pass' : 'fail'}`).join('\n')}

## Live model comparison

Not run by the CI-safe command. Run the evaluation script with \`--live\` when the installed fast, balanced, and powerful model tiers are available.
`;
};
