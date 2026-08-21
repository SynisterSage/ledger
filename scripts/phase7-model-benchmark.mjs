import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';
import { createLocalAIService } from '../electron/localAIService.ts';

const runtime = process.env.LEDGER_LLAMA_SERVER_PATH || (await import('../electron/localAIAssets.ts')).resolveLocalAIRuntime();
const q8Path = process.env.LEDGER_LOCAL_AI_BALANCED_MODEL_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/ministral-3-3b-instruct-2512-q8-0/Ministral-3-3B-Instruct-2512-Q8_0.gguf';
const q4Path = process.env.LEDGER_PHASE7_MINISTRAL_Q4_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/ministral-3-3b-instruct-2512-q4-k-m/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf';
const qwenPath = process.env.LEDGER_PHASE7_QWEN_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/qwen3-4b-thinking-2507-q6-k/Qwen_Qwen3-4B-Thinking-2507-Q6_K.gguf';
const qwen35Path = process.env.LEDGER_PHASE7_QWEN35_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/qwen3.5-4b-q4-k-m/Qwen_Qwen3.5-4B-Q4_K_M.gguf';
const qwenRegularPath = process.env.LEDGER_PHASE7_QWEN_REGULAR_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/qwen3-4b-q4-k-m/qwen3-4b-q4_k_m.gguf';
const workspaceId = 'phase7-model-benchmark';
const repeats = Number(process.env.LEDGER_PHASE7_REPEATS || 2);
const interRequestMs = Number(process.env.LEDGER_PHASE7_INTER_REQUEST_MS || 500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const estimateTokens = (value) => Math.ceil(String(value ?? '').length / 4);
const words = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const documents = [
  { workspaceId, resourceType: 'project', resourceId: 'project-release', title: 'Ledger release', content: 'The Ledger release is In progress and 40% complete. The next priority is validating local AI performance.', status: 'In progress', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-runtime', title: 'Validate runtime configuration', content: 'Compare the current 8K four-slot runtime with the 4K single-slot candidate on the same workloads.', status: 'In progress', dueAt: '2026-08-22T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-memory', title: 'Measure memory pressure', content: 'Check unified memory, swap, and whether embedding and generation runtimes can remain resident safely.', status: 'Not started', dueAt: '2026-08-23T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'task-quality', title: 'Compare answer quality', content: 'Verify grounding, completeness, contradiction handling, and truncation under both runtime configurations.', status: 'Not started', dueAt: '2026-08-24T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'event-review', title: 'Runtime review', content: 'Review A/B timings and decide the safe 8 GB production configuration.', timestamp: '2026-08-21T15:00:00Z', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'note-baseline', title: 'Phase 4 baseline', content: 'Normal grounded visible time was about 7.9 seconds and total time about 28.9 seconds. Plan my week visible time was about 6.3 seconds and total time about 50.8 seconds.', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'milestone', resourceId: 'milestone-config', title: 'Choose 8 GB runtime', content: 'Select current, candidate, or hybrid context sizing after repeated performance and memory measurements.', status: 'Not started', dueAt: '2026-08-25T12:00:00Z', projectId: 'project-release', projectName: 'Ledger release', updatedAt: '2026-08-20T12:00:00Z' },
];
const fixtureFor = (types) => {
  const selected = documents.filter((item) => types.includes(item.resourceType));
  return { workspaceId, documents: selected, lexicalResults: selected.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: 'phase7-fixture' })) };
};
const cases = [
  { id: 'normal-grounded', question: 'What is the current status of the Ledger release?', ...fixtureFor(['project']), expected: ['In progress', '40%'], kind: 'normal' },
  { id: 'short-grounded', question: 'What is blocked?', ...fixtureFor(['task']), expected: ['runtime configuration'], kind: 'normal' },
  { id: 'plan-my-week', question: 'Plan my week.', ...fixtureFor(['task', 'milestone', 'event']), skillId: 'plan_my_week', skillDefinition: getAskLedgerSkill('plan_my_week'), expected: ['runtime', 'memory'], kind: 'skill' },
  { id: 'multi-resource', question: 'Assess the release across its project, tasks, milestone, event, and notes. What matters next?', ...fixtureFor(['project', 'task', 'milestone', 'event', 'note']), expected: ['release', 'next'], kind: 'normal' },
];
const models = [
  { id: 'ministral-3b-q8', label: 'Ministral 3B Q8', family: 'Ministral 3', path: q8Path, reasoning: false },
  { id: 'ministral-3b-q4-k-m', label: 'Ministral 3B Q4_K_M', family: 'Ministral 3', path: q4Path, reasoning: false },
  { id: 'qwen3-4b-thinking-2507-q6-k', label: 'Qwen3-4B-Thinking-2507 Q6_K', family: 'Qwen3', path: qwenPath, reasoning: true },
  { id: 'qwen3.5-4b-q4-k-m', label: 'Qwen3.5 4B Q4_K_M', family: 'Qwen3.5', path: qwen35Path, reasoning: false },
  { id: 'qwen3-4b-q4-k-m', label: 'Qwen3 4B Q4_K_M', family: 'Qwen3', path: qwenRegularPath, reasoning: false },
  { id: 'qwen3-4b-q4-k-m-thinking-mode', label: 'Qwen3 4B Q4_K_M Thinking mode', family: 'Qwen3', path: qwenRegularPath, reasoning: true },
];
const requestedModelIds = process.env.LEDGER_PHASE7_MODEL_IDS?.split(',').map((value) => value.trim()).filter(Boolean);
const benchmarkModels = requestedModelIds?.length ? models.filter((model) => requestedModelIds.includes(model.id)) : models;
if (!benchmarkModels.length) throw new Error(`No Phase 7 models matched LEDGER_PHASE7_MODEL_IDS=${requestedModelIds?.join(',')}`);

const memorySample = (port) => {
  let freePercent = null; let swapUsedMiB = null; let runtimeRssMiB = null;
  try { const output = execFileSync('memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }); freePercent = Number(output.match(/free percentage:\s*(\d+)%/i)?.[1] ?? NaN) || null; } catch {}
  try { const output = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8', timeout: 2000 }); swapUsedMiB = Number(output.match(/used\s*=\s*([\d.]+)M/i)?.[1] ?? NaN) || null; } catch {}
  try { const output = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8', timeout: 2000 }); const rss = output.split('\n').filter((line) => new RegExp(`llama-server.*${port}`).test(line)).map((line) => Number(line.trim().split(/\s+/, 1)[0])).filter(Number.isFinite); if (rss.length) runtimeRssMiB = rss.reduce((sum, value) => sum + value, 0) / 1024; } catch {}
  return { freePercent, swapUsedMiB, runtimeRssMiB };
};

const parseDiagnostics = (text) => {
  const offload = text.match(/offloaded\s+(\d+)\/(\d+)\s+layers/i);
  const metal = text.match(/MTL0.*?\|\s*\d+\s*=\s*\d+\s*\+\s*\(\s*(\d+)\s*=\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)/i);
  const kv = text.match(/MTL0 KV buffer size\s*=\s*([\d.]+)\s*MiB/i);
  return { metalConfirmed: /ggml_metal_init: found device/i.test(text), gpuLayersOffloaded: offload ? `${offload[1]}/${offload[2]}` : null, cpuFallbackDetected: offload ? Number(offload[1]) === 0 : null, metalMemoryMiB: metal ? Number(metal[1]) : null, modelMemoryMiB: metal ? Number(metal[2]) : null, contextMemoryMiB: metal ? Number(metal[3]) : null, computeMemoryMiB: metal ? Number(metal[4]) : null, kvMemoryMiB: kv ? Number(kv[1]) : null };
};
const waitForHealth = async (port, child, diagnostics) => { const started = performance.now(); while (performance.now() - started < 120_000) { if (child.exitCode !== null) throw new Error(`runtime exited with ${child.exitCode}: ${diagnostics()}`); try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) })).ok) return performance.now() - started; } catch {} await sleep(250); } throw new Error(`runtime startup timeout: ${diagnostics()}`); };

const streamRequest = async (port, prompt, maxTokens, reasoning) => {
  const started = performance.now(); let firstResponseByteMs = null; let firstReasoningMs = null; let firstVisibleMs = null; let lastDeltaMs = null; let reasoningText = ''; let visibleText = ''; let finishReason = null; let timings = null; let buffer = ''; let doneMarkerMs = null;
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, max_tokens: maxTokens, n_predict: maxTokens, temperature: 0.2, top_p: 0.95, top_k: 40, min_p: 0.05, messages: [{ role: 'user', content: `${prompt}\n${reasoning ? '/think' : '/no_think'}` }] }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    if (firstResponseByteMs === null) firstResponseByteMs = performance.now() - started;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { doneMarkerMs = performance.now() - started; continue; }
      try {
        const payload = JSON.parse(data); const choice = payload.choices?.[0];
        if (payload.timings) timings = payload.timings;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const reasoningDelta = choice?.delta?.reasoning_content ?? '';
        const visibleDelta = choice?.delta?.content ?? '';
        if (reasoningDelta) { if (firstReasoningMs === null) firstReasoningMs = performance.now() - started; reasoningText += reasoningDelta; lastDeltaMs = performance.now() - started; }
        if (visibleDelta) { if (firstVisibleMs === null) firstVisibleMs = performance.now() - started; visibleText += visibleDelta; lastDeltaMs = performance.now() - started; }
      } catch {}
    }
  }
  const bodyCloseMs = performance.now() - started;
  return { firstResponseByteMs, firstReasoningMs, firstVisibleMs, lastDeltaMs, doneMarkerMs, bodyCloseMs, reasoningText, visibleText, reasoningTokens: words(reasoningText), visibleTokens: words(visibleText), finishReason, timings };
};

const runModel = async (model, prepared) => {
  const port = Number(process.env.LEDGER_PHASE7_PORT_BASE || 39500) + models.indexOf(model); const args = ['--model', model.path, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '4096', '--parallel', '1', '--jinja', '--n-gpu-layers', 'all', '--no-mmproj', '--verbosity', '4', ...(model.reasoning ? ['--reasoning', 'on', '--reasoning-format', 'deepseek'] : ['--reasoning', 'off'])];
  const child = spawn(runtime, args, { stdio: ['ignore', 'pipe', 'pipe'] }); const exitPromise = new Promise((resolve) => child.once('exit', resolve)); let diagnostics = ''; const collect = (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-40000); }; child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const startupStarted = performance.now();
  try {
    const startupMs = await waitForHealth(port, child, () => diagnostics.slice(-4000)); const results = [];
    for (const benchmarkCase of cases) {
      for (let run = 1; run <= repeats; run += 1) {
        const prompt = prepared.get(benchmarkCase.id); const budget = benchmarkCase.kind === 'skill' ? 512 : 384; const before = memorySample(port); const result = await streamRequest(port, prompt, budget, model.reasoning); const after = memorySample(port); const expected = benchmarkCase.expected.map((value) => value.toLowerCase()); const answerLower = result.visibleText.toLowerCase(); const grounded = expected.filter((value) => answerLower.includes(value)).length / expected.length; results.push({ model: model.id, caseId: benchmarkCase.id, run, cold: run === 1 && results.length === 0, modelReasoningEnabled: model.reasoning, metrics: { startupMs: run === 1 && results.length === 0 ? startupMs : 0, firstResponseByteMs: result.firstResponseByteMs, firstReasoningMs: result.firstReasoningMs, firstVisibleMs: result.firstVisibleMs, bodyCloseMs: result.bodyCloseMs, promptTokens: result.timings?.prompt_n ?? estimateTokens(prompt), promptEvalMs: result.timings?.prompt_ms, promptTokensPerSecond: result.timings?.prompt_per_second, generationMs: result.timings?.predicted_ms, generationTokensPerSecond: result.timings?.predicted_per_second, generatedTokens: result.timings?.predicted_n, visibleTokens: result.visibleTokens, reasoningTokens: model.reasoning ? result.reasoningTokens : 0, finishReason: result.finishReason, doneToCloseMs: result.doneMarkerMs === null ? null : result.bodyCloseMs - result.doneMarkerMs }, memory: { before, after, peakRuntimeRssMiB: Math.max(before.runtimeRssMiB ?? 0, after.runtimeRssMiB ?? 0) || null, swapDeltaMiB: before.swapUsedMiB === null || after.swapUsedMiB === null ? null : after.swapUsedMiB - before.swapUsedMiB }, quality: { grounding: grounded, expectedFacts: benchmarkCase.expected.length, visibleAnswerChars: result.visibleText.length, answerPresent: result.visibleText.trim().length > 0 }, output: result.visibleText, reasoning: model.reasoning ? result.reasoningText : '' });
        await sleep(interRequestMs);
      }
    }
    const fileStat = await (await import('node:fs/promises')).stat(model.path);
    return { model: { ...model, fileSizeBytes: fileStat.size }, runtime: parseDiagnostics(diagnostics), startupMs, results };
  } catch (error) {
    return { model: { ...model, fileSizeBytes: (await (await import('node:fs/promises')).stat(model.path)).size }, runtime: parseDiagnostics(diagnostics), error: error instanceof Error ? error.message : String(error) };
  } finally { child.kill('SIGTERM'); await exitPromise; }
};

if (!runtime) throw new Error('Bundled llama-server runtime unavailable.');
for (const model of benchmarkModels) { const stat = await (await import('node:fs/promises')).stat(model.path).catch(() => null); if (!stat) throw new Error(`Missing required model: ${model.path}`); }
const assets = new LocalAIAssetManager(); const prepAI = createLocalAIService(assets, { contextSize: 4096, runtimeArgs: ['--n-gpu-layers', 'all', '--no-mmproj', '--reasoning', 'off', '--parallel', '1'] }); const askLedger = createAskLedgerService(prepAI, assets); const prepared = new Map();
for (const benchmarkCase of cases) { const frozen = await askLedger.prepareBenchmarkCase(benchmarkCase); if (!frozen.contextItems.length) throw new Error(`Benchmark fixture produced empty evidence for ${benchmarkCase.id}`); prepared.set(benchmarkCase.id, frozen.prompt); }
await prepAI.shutdown();
const reports = []; for (const model of benchmarkModels) { console.error(`[phase7] benchmarking ${model.label}`); reports.push(await runModel(model, prepared)); }
const summary = reports.map((report) => {
  if (report.error) return { model: report.model.id, fileSizeBytes: report.model.fileSizeBytes, error: report.error, runtime: report.runtime };
  const entries = report.results;
  const numeric = (selector) => average(entries.map(selector).filter((value) => typeof value === 'number'));
  const finishReasons = entries.reduce((map, entry) => {
    const key = entry.metrics.finishReason ?? 'unknown';
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map());
  return {
    model: report.model.id,
    fileSizeBytes: report.model.fileSizeBytes,
    metalMemoryMiB: report.runtime.metalMemoryMiB,
    kvMemoryMiB: report.runtime.kvMemoryMiB,
    coldStartupMs: report.startupMs,
    warmTTFTMs: numeric((entry) => entry.cold ? null : entry.metrics.firstVisibleMs),
    promptTokensPerSecond: numeric((entry) => entry.metrics.promptTokensPerSecond),
    generationTokensPerSecond: numeric((entry) => entry.metrics.generationTokensPerSecond),
    visibleAnswerMs: numeric((entry) => entry.metrics.firstVisibleMs),
    visibleTokens: numeric((entry) => entry.metrics.visibleTokens),
    reasoningTokens: numeric((entry) => entry.metrics.reasoningTokens),
    averageGrounding: numeric((entry) => entry.quality.grounding),
    finishReasons: Object.fromEntries(finishReasons),
    peakRuntimeRssMiB: Math.max(...entries.map((entry) => entry.memory.peakRuntimeRssMiB ?? 0)) || null,
  };
});
console.log(JSON.stringify({ phase: 7, frozenRuntime: { contextSize: 4096, parallel: 1, gpuLayers: 'all', mmproj: false }, repeats, cases: cases.map((benchmarkCase) => ({ id: benchmarkCase.id, kind: benchmarkCase.kind, estimatedPromptTokens: estimateTokens(prepared.get(benchmarkCase.id)) })), reports, summary }, null, 2));
