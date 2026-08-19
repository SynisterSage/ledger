import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAskLedgerDeterministicEvaluation } from '../electron/askLedgerEvaluation.ts';
import { renderAskLedgerEvaluationMarkdown } from '../electron/askLedgerEvaluation.ts';

const live = process.argv.includes('--live');
const outputPath = process.argv.find((argument) => argument !== '--live' && argument !== process.argv[0] && argument !== process.argv[1]) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', 'ask-ledger-evaluation', 'report.json');
const report = await runAskLedgerDeterministicEvaluation();
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const markdownPath = outputPath.replace(/\.json$/i, '.md');
fs.writeFileSync(markdownPath, renderAskLedgerEvaluationMarkdown(report));
let liveModelBenchmark;
if (live) {
  const { createAskLedgerService } = await import('../electron/askLedgerService.ts');
  const { LocalAIBenchmarkHarness } = await import('../electron/localAIBenchmark.ts');
  const { LocalAIAssetManager } = await import('../electron/localAIAssets.ts');
  const { createLocalAIService } = await import('../electron/localAIService.ts');
  const { createAskLedgerEvaluationCases } = await import('../electron/askLedgerEvaluationFixtures.ts');
  const assets = new LocalAIAssetManager();
  const localAI = createLocalAIService(assets);
  const askLedger = createAskLedgerService(localAI, assets);
  const cases = createAskLedgerEvaluationCases().map(({ expectation, ...evaluationCase }) => ({
    ...evaluationCase,
    expectation: {
      requiredFacts: expectation.requiredAnswerFacts,
      forbiddenClaims: expectation.forbiddenClaims,
    },
  }));
  try {
    liveModelBenchmark = await new LocalAIBenchmarkHarness(askLedger, localAI, assets).run(cases);
  } finally {
    await askLedger.shutdown().catch(() => undefined);
  }
}
const combinedReport = liveModelBenchmark ? { ...report, liveModelBenchmark } : report;
fs.writeFileSync(outputPath, JSON.stringify(combinedReport, null, 2));
console.log(JSON.stringify({ outputPath, markdownPath, summary: report.summary, thresholds: report.thresholds, live: live ? liveModelBenchmark?.summary : 'not_run' }, null, 2));
