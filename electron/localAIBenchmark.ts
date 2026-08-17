import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import type { AskLedgerSkillDefinition, AskLedgerSkillId } from '../src/types/askLedgerSkills.ts';
import { buildSkillResult, getAskLedgerSkill } from './askLedgerSkills.ts';
import type { AskLedgerBenchmarkCaseRequest, AskLedgerService, PreparedAskLedgerBenchmarkCase } from './askLedgerService.ts';
import type { GenerationTier, LocalAIAssetManager } from './localAIAssets.ts';
import { LocalAIService, type LocalAIStreamEvent } from './localAIService.ts';

export type BenchmarkExpectation = {
  requiredFacts?: string[];
  forbiddenClaims?: string[];
  requiredSections?: string[];
  expectAbstention?: boolean;
};

export type LocalAIBenchmarkCase = AskLedgerBenchmarkCaseRequest & {
  id: string;
  category: string;
  expectation?: BenchmarkExpectation;
};

export type LocalAIBenchmarkResult = {
  caseId: string;
  category: string;
  tier: GenerationTier;
  model: { id: string; version: string; fileName: string; quantization?: string; fileSizeBytes: number | null };
  promptTokens: number;
  sources: Array<{ resourceType: string; resourceId: string; title: string }>;
  output: string;
  metrics: { coldStartupMs?: number; warmStartupMs?: number; firstTokenMs?: number; totalMs?: number; tokensPerSecond?: number; processRssDeltaBytes?: number };
  score: { factualCorrectness: number | null; unsupportedClaims: number; abstentionCorrect: boolean | null; requiredStructure: number | null; actionSchemaValid: boolean | null; passed: boolean | null };
  error?: { code?: string; message: string };
};

export type LocalAIBenchmarkReport = {
  schemaVersion: 1;
  generatedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  runtimeVersion: string;
  cases: Array<{ id: string; category: string; promptTokens: number; sources: PreparedAskLedgerBenchmarkCase['sources'] }>;
  results: LocalAIBenchmarkResult[];
  summary: Record<GenerationTier, { tested: number; passed: number; averageFirstTokenMs: number | null; averageTokensPerSecond: number | null; averageTotalMs: number | null; averageProcessRssDeltaBytes: number | null; fileSizeBytes: number | null }>;
};

const contains = (output: string, value: string) => output.toLocaleLowerCase().includes(value.toLocaleLowerCase());
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export const scoreBenchmarkOutput = (output: string, expectation: BenchmarkExpectation = {}, actionSchemaValid: boolean | null = null) => {
  const requiredFacts = expectation.requiredFacts ?? [];
  const factualCorrectness = requiredFacts.length ? requiredFacts.filter((fact) => contains(output, fact)).length / requiredFacts.length : null;
  const unsupportedClaims = (expectation.forbiddenClaims ?? []).filter((claim) => contains(output, claim)).length;
  const abstentionCorrect = expectation.expectAbstention === undefined ? null : expectation.expectAbstention === contains(output, "I don't have enough Ledger context to answer that.");
  const requiredStructure = expectation.requiredSections?.length
    ? expectation.requiredSections.filter((section) => contains(output, section)).length / expectation.requiredSections.length
    : null;
  const checks = [factualCorrectness, abstentionCorrect === null ? null : abstentionCorrect ? 1 : 0, requiredStructure, actionSchemaValid === null ? null : actionSchemaValid ? 1 : 0, unsupportedClaims === 0 ? 1 : 0].filter((value): value is number => value !== null);
  return { factualCorrectness, unsupportedClaims, abstentionCorrect, requiredStructure, actionSchemaValid, passed: checks.length ? checks.every((value) => value >= 1) : null };
};

const waitForCompletion = (events: LocalAIStreamEvent[]) => new Promise<void>((resolve) => {
  if (events.some((event) => event.type === 'done' || event.type === 'error')) { resolve(); return; }
  const timer = setInterval(() => {
    if (events.some((event) => event.type === 'done' || event.type === 'error')) { clearInterval(timer); resolve(); }
  }, 10);
});

export class LocalAIBenchmarkHarness {
  private readonly askLedger: AskLedgerService;
  private readonly localAI: LocalAIService;
  private readonly assets: LocalAIAssetManager;

  constructor(askLedger: AskLedgerService, localAI: LocalAIService, assets: LocalAIAssetManager) {
    this.askLedger = askLedger;
    this.localAI = localAI;
    this.assets = assets;
  }

  async run(cases: LocalAIBenchmarkCase[], tiers: GenerationTier[] = ['fast', 'balanced', 'powerful']): Promise<LocalAIBenchmarkReport> {
    const originalTier = this.assets.getSelectedGenerationTier();
    const prepared = new Map<string, PreparedAskLedgerBenchmarkCase>();
    const results: LocalAIBenchmarkResult[] = [];
    try {
      for (const benchmarkCase of cases) prepared.set(benchmarkCase.id, await this.askLedger.prepareBenchmarkCase(benchmarkCase));
      for (const tier of tiers) {
        const model = this.assets.getAvailableGenerationModels().find((entry) => entry.tier === tier);
        if (!model) continue;
        const status = this.assets.getGenerationModelStatus(model.id);
        if (!status.installed) {
          for (const benchmarkCase of cases) results.push({ caseId: benchmarkCase.id, category: benchmarkCase.category, tier, model: { id: model.id, version: model.version, fileName: model.fileName, quantization: model.fileName.includes('q4_k_m') ? 'Q4_K_M' : undefined, fileSizeBytes: status.installedBytes || null }, promptTokens: prepared.get(benchmarkCase.id)?.estimatedTokens ?? 0, sources: [], output: '', metrics: {}, score: { factualCorrectness: null, unsupportedClaims: 0, abstentionCorrect: null, requiredStructure: null, actionSchemaValid: null, passed: null }, error: { code: 'model_not_installed', message: 'Model is not installed; benchmark skipped.' } });
          continue;
        }
        const switchResult = await this.localAI.switchGenerationTier(tier);
        if (!switchResult.ok) throw new Error(`Could not prepare ${tier}: ${switchResult.state}`);
        for (const benchmarkCase of cases) {
          const frozen = prepared.get(benchmarkCase.id)!;
          const events: LocalAIStreamEvent[] = [];
          const rssBefore = process.memoryUsage().rss;
          let peakRss = rssBefore;
          const memorySampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
          const requestId = randomUUID();
          this.localAI.start({ question: benchmarkCase.question, context: frozen.prompt }, { onEvent: (event) => events.push(event) }, requestId);
          await waitForCompletion(events);
          clearInterval(memorySampler);
          const done = events.find((event) => event.type === 'done');
          const error = events.find((event) => event.type === 'error');
          const output = events.filter((event) => event.type === 'delta').map((event) => event.text ?? '').join('').trim();
          const skill = benchmarkCase.skillDefinition ?? getAskLedgerSkill(benchmarkCase.skillId);
          const actionSchemaValid = skill ? buildSkillResult(skill, output, benchmarkCase.explicitContext).actionProposals.every((proposal) => typeof proposal.type === 'string' && typeof proposal.payload === 'object' && typeof proposal.sourceMessageId === 'string') : null;
          const score = error ? { factualCorrectness: null, unsupportedClaims: 0, abstentionCorrect: null, requiredStructure: null, actionSchemaValid: null, passed: null } : scoreBenchmarkOutput(output, benchmarkCase.expectation, actionSchemaValid);
          results.push({ caseId: benchmarkCase.id, category: benchmarkCase.category, tier, model: { id: model.id, version: model.version, fileName: model.fileName, quantization: model.fileName.includes('q4_k_m') ? 'Q4_K_M' : undefined, fileSizeBytes: status.installedBytes || null }, promptTokens: frozen.estimatedTokens, sources: frozen.sources.map(({ resourceType, resourceId, title }) => ({ resourceType, resourceId, title })), output, metrics: { coldStartupMs: switchResult.startupMs, warmStartupMs: done?.metrics?.startupMs, firstTokenMs: done?.metrics?.firstTokenMs, totalMs: done?.metrics?.totalMs, tokensPerSecond: done?.metrics?.tokensPerSecond, processRssDeltaBytes: Math.max(0, peakRss - rssBefore) }, score, error: error?.error });
        }
      }
    } finally {
      if (this.assets.getGenerationModelStatus(this.assets.getSelectedGenerationModel().id).installed) await this.localAI.switchGenerationTier(originalTier).catch(() => undefined);
    }
    const summary = Object.fromEntries((['fast', 'balanced', 'powerful'] as GenerationTier[]).map((tier) => {
      const tierResults = results.filter((result) => result.tier === tier && !result.error);
      return [tier, { tested: tierResults.length, passed: tierResults.filter((result) => result.score.passed === true).length, averageFirstTokenMs: average(tierResults.map((result) => result.metrics.firstTokenMs).filter((value): value is number => value !== undefined)), averageTokensPerSecond: average(tierResults.map((result) => result.metrics.tokensPerSecond).filter((value): value is number => value !== undefined)), averageTotalMs: average(tierResults.map((result) => result.metrics.totalMs).filter((value): value is number => value !== undefined)), averageProcessRssDeltaBytes: average(tierResults.map((result) => result.metrics.processRssDeltaBytes).filter((value): value is number => value !== undefined)), fileSizeBytes: tierResults[0]?.model.fileSizeBytes ?? null }];
    })) as LocalAIBenchmarkReport['summary'];
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, runtimeVersion: process.env.LEDGER_LLAMA_RUNTIME_VERSION?.trim() || 'unknown', cases: cases.map((benchmarkCase) => { const item = prepared.get(benchmarkCase.id)!; return { id: benchmarkCase.id, category: benchmarkCase.category, promptTokens: item.estimatedTokens, sources: item.sources }; }), results, summary };
  }

  async writeReport(report: LocalAIBenchmarkReport, outputPath: string) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  }
}

export const benchmarkSkillDefinition = (skillId: AskLedgerSkillId): AskLedgerSkillDefinition | undefined => getAskLedgerSkill(skillId);
export type BenchmarkFixtureContext = AskLedgerContextItem;
