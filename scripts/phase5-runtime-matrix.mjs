import { spawn } from 'node:child_process';
import { resolveLocalAIRuntime } from '../electron/localAIAssets.ts';

const runtime = resolveLocalAIRuntime();
const model = process.env.LEDGER_LOCAL_AI_BALANCED_MODEL_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/ministral-3-3b-instruct-2512-q8-0/Ministral-3-3B-Instruct-2512-Q8_0.gguf';
const prompt = `Use only the Ledger context below. Answer briefly in three concise bullets.\n\nLedger context:\nProject: Ledger release. Status: In progress. Progress: 40%.\nTask: Measure runtime startup. Status: Blocked. Due: 2026-08-22.\nTask: Run grounded scenarios. Status: Not started. Due: 2026-08-23.\nEvent: Release review. Time: 2026-08-21 15:00.\n\nQuestion: What is the current status, blocker, and next step?`;
const variants = [
  { id: 'current-defaults', args: ['--ctx-size', '8192'] },
  { id: 'single-slot-4k', args: ['--ctx-size', '4096', '--parallel', '1'] },
  { id: 'single-slot-4k-flash-on', args: ['--ctx-size', '4096', '--parallel', '1', '--flash-attn', 'on'] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const health = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } };
const parseRuntime = (text) => {
  const offload = text.match(/offloaded\s+(\d+)\/(\d+)\s+layers/i);
  const metal = text.match(/MTL0.*?\|\s*\d+\s*=\s*\d+\s*\+\s*\(\s*(\d+)\s*=\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)/i);
  const kv = text.match(/MTL0 KV buffer size\s*=\s*([\d.]+)\s*MiB/i);
  const flashSetting = text.match(/flash_attn\s*=\s*([^,\s]+)/i)?.[1];
  return {
    metalConfirmed: /ggml_metal_init: found device/i.test(text),
    gpuLayersOffloaded: offload ? `${offload[1]}/${offload[2]}` : undefined,
    cpuFallbackDetected: offload ? Number(offload[1]) === 0 : undefined,
    metalMemoryMiB: metal ? Number(metal[1]) : undefined,
    modelBufferMiB: metal ? Number(metal[2]) : undefined,
    contextBufferMiB: metal ? Number(metal[3]) : undefined,
    computeBufferMiB: metal ? Number(metal[4]) : undefined,
    kvBufferMiB: kv ? Number(kv[1]) : undefined,
    flashAttentionSetting: flashSetting,
    flashAttention: /Flash Attention enabled/i.test(text) || flashSetting === 'on',
    threads: text.match(/threadpool init, n_threads\s*=\s*(\d+)/i)?.[1],
    parallelSlots: text.match(/n_parallel.*?n_parallel\s*=\s*(\d+)/i)?.[1],
  };
};

const runVariant = async (variant, index) => {
  const port = 39400 + index;
  const args = ['--model', model, '--host', '127.0.0.1', '--port', String(port), '--jinja', '--n-gpu-layers', 'all', '--no-mmproj', '--reasoning', 'off', '--verbosity', '4', ...variant.args];
  const child = spawn(runtime, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const exitPromise = new Promise((resolve) => child.once('exit', resolve));
  let diagnostics = '';
  const collect = (chunk) => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-30000); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const started = performance.now();
  try {
    while (!(await health(port))) {
      if (child.exitCode !== null) throw new Error(`runtime exited with ${child.exitCode}`);
      if (performance.now() - started > 90_000) throw new Error('runtime startup timeout');
      await sleep(250);
    }
    const readyMs = performance.now() - started;
    const runs = [];
    const runCount = variant.id === 'current-defaults' ? 2 : 1;
    for (let run = 0; run < runCount; run += 1) {
      const requestStarted = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: false, max_tokens: 128, n_predict: 128, temperature: 0, seed: 42, top_p: 0.95, top_k: 40, min_p: 0.05, messages: [{ role: 'user', content: prompt }] }),
      });
      const firstByteMs = performance.now() - requestStarted;
      const payload = await response.json();
      const totalMs = performance.now() - requestStarted;
      const timings = payload.timings ?? {};
      runs.push({ run: run + 1, firstByteMs, totalMs, promptTokens: timings.prompt_n, promptEvalMs: timings.prompt_ms, promptTokensPerSecond: timings.prompt_per_second, generatedTokens: timings.predicted_n, generationMs: timings.predicted_ms, tokensPerSecond: timings.predicted_per_second, cacheTokens: timings.cache_n });
    }
    return {
      variant: variant.id, readyMs, runs,
      runtime: parseRuntime(diagnostics),
    };
  } finally {
    child.kill('SIGTERM');
    await exitPromise;
  }
};

if (!runtime) throw new Error('Bundled llama-server runtime is unavailable.');
for (let index = 0; index < variants.length; index += 1) {
  try { console.log(JSON.stringify(await runVariant(variants[index], index))); }
  catch (error) { console.log(JSON.stringify({ variant: variants[index].id, error: error instanceof Error ? error.message : String(error) })); }
}
