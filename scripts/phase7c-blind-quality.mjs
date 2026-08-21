import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';
import { createLocalAIService } from '../electron/localAIService.ts';

const runtime = process.env.LEDGER_LLAMA_SERVER_PATH || (await import('../electron/localAIAssets.ts')).resolveLocalAIRuntime();
const q8Path = process.env.LEDGER_LOCAL_AI_BALANCED_MODEL_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/ministral-3-3b-instruct-2512-q8-0/Ministral-3-3B-Instruct-2512-Q8_0.gguf';
const q4Path = process.env.LEDGER_PHASE7_MINISTRAL_Q4_PATH || '/Users/lex/Library/Application Support/ledger/ai/models/generation/ministral-3-3b-instruct-2512-q4-k-m/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf';
const workspaceId = 'phase7c-blind-quality';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const words = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;

const documents = [
  { workspaceId, resourceType: 'project', resourceId: 'atlas', title: 'Atlas launch', content: 'Atlas launch is In progress at 65%. Goal: ship the new onboarding flow by September 12. Owner: Maya. Risk: analytics events are not yet verified.', status: 'In progress', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'project', resourceId: 'migration', title: 'Workspace migration', content: 'Workspace migration is Paused at 30%. Goal: move legacy workspaces by October 1. Owner: Jordan. It depends on the permissions audit.', status: 'Paused', updatedAt: '2026-08-19T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'analytics', title: 'Verify Atlas analytics events', content: 'Verify signup_completed and invite_sent events in production. Assigned to Maya. Due August 27. Blocked until the staging event names are reconciled.', status: 'Blocked', dueAt: '2026-08-27T12:00:00Z', projectId: 'atlas', projectName: 'Atlas launch', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'copy', title: 'Approve onboarding copy', content: 'Approve the welcome, invite, and empty-state copy. Assigned to Priya. Due August 25. Status: In progress.', status: 'In progress', dueAt: '2026-08-25T12:00:00Z', projectId: 'atlas', projectName: 'Atlas launch', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'permissions', title: 'Complete permissions audit', content: 'Review role inheritance and guest access before migration. Assigned to Jordan. Due September 3. Status: Not started.', status: 'Not started', dueAt: '2026-09-03T12:00:00Z', projectId: 'migration', projectName: 'Workspace migration', updatedAt: '2026-08-19T12:00:00Z' },
  { workspaceId, resourceType: 'task', resourceId: 'vendor', title: 'Confirm vendor security review', content: 'Send the final data-processing questionnaire to Northstar. Assigned to Lex. Due August 29. Status: Completed.', status: 'Completed', dueAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-18T12:00:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'demo', title: 'Atlas customer demo', content: 'Customer demo for Atlas onboarding. Maya presents the flow; Priya covers copy. August 28 at 2:00 PM.', timestamp: '2026-08-28T14:00:00Z', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'event', resourceId: 'audit', title: 'Permissions audit review', content: 'Review migration permissions findings with Jordan. September 4 at 11:00 AM.', timestamp: '2026-09-04T11:00:00Z', updatedAt: '2026-08-19T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'decision', title: 'Launch decision notes', content: 'The team agreed analytics verification is a launch gate. Copy can ship with minor follow-up edits after the demo. The September 12 target is still preferred, but not committed.', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'conflict', title: 'Conflicting dates', content: 'The project brief says September 12. A later meeting note mentions September 19 as a fallback. No decision changed the preferred target.', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'note', resourceId: 'retro', title: 'Last retro', content: 'The last retro identified unclear ownership and late instrumentation as recurring problems. The next review should assign one owner per launch gate.', updatedAt: '2026-08-17T12:00:00Z' },
  { workspaceId, resourceType: 'milestone', resourceId: 'launch-gate', title: 'Atlas launch readiness', content: 'Launch readiness review is due September 5. Required gates: analytics verified, copy approved, and demo completed.', status: 'Not started', dueAt: '2026-09-05T12:00:00Z', projectId: 'atlas', projectName: 'Atlas launch', updatedAt: '2026-08-20T12:00:00Z' },
  { workspaceId, resourceType: 'reminder', resourceId: 'followup', title: 'Follow up on Northstar', content: 'Follow up with Northstar if the security questionnaire has not been acknowledged by August 30.', dueAt: '2026-08-30T09:00:00Z', updatedAt: '2026-08-18T12:00:00Z' },
];
const fixtureFor = (types) => { const selected = documents.filter((item) => types.includes(item.resourceType)); const corpus = documents; const anchor = selected[0]; return { workspaceId, documents: corpus, lexicalResults: corpus.map((item) => ({ type: item.resourceType, id: item.resourceId, title: item.title, match_source: types.includes(item.resourceType) ? 'phase7c-target-resource' : 'phase7c-frozen-fixture' })), explicitContext: anchor ? { resourceType: anchor.resourceType, resourceId: anchor.resourceId, title: anchor.title } : undefined }; };
const cases = [
  ['facts-status', 'What is the current status of Atlas launch?', ['project'], ['65%', 'In progress'], 'direct facts'],
  ['facts-blocker', 'What is blocking Atlas launch?', ['project', 'task', 'note'], ['analytics', 'staging'], 'direct facts'],
  ['meeting-synthesis', 'Summarize the Atlas customer demo and who is responsible for it.', ['event', 'task'], ['Maya', 'Priya'], 'meeting synthesis'],
  ['project-status', 'Compare Atlas launch and Workspace migration status.', ['project'], ['65%', '30%', 'Paused'], 'project status'],
  ['dependency', 'What must happen before the Atlas launch readiness review?', ['milestone', 'task'], ['analytics', 'copy', 'demo'], 'dependency reasoning'],
  ['conflict', 'What date should we plan around for Atlas, and what uncertainty remains?', ['project', 'note'], ['September 12', 'September 19'], 'conflicting evidence'],
  ['timeline', 'Give me the important dates for Atlas and migration in chronological order.', ['project', 'task', 'event', 'milestone'], ['August 25', 'August 28', 'September 5', 'September 12'], 'timeline'],
  ['weekly-plan', 'Plan my week around the Atlas launch and migration work.', ['project', 'task', 'event', 'milestone'], ['analytics', 'permissions', 'August 28'], 'weekly planning', 'skill'],
  ['missing', 'Who owns the migration launch decision?', ['project', 'task'], ['Jordan'], 'missing evidence'],
  ['cross-resource', 'What is the highest-risk relationship across projects, tasks, notes, and events?', ['project', 'task', 'note', 'event'], ['analytics', 'launch gate'], 'cross-resource research'],
  ['quality', 'Which task is completed, and what should happen next afterward?', ['task', 'reminder'], ['vendor', 'Northstar'], 'direct facts'],
  ['synthesis', 'Turn the launch readiness information into a concise executive update.', ['project', 'task', 'note', 'milestone'], ['65%', 'September 12', 'analytics'], 'multi-resource synthesis'],
  ['contradiction', 'Is September 12 committed or only preferred?', ['project', 'note'], ['preferred', 'not committed'], 'contradiction handling'],
  ['review', 'What should the next review explicitly assign?', ['note', 'task'], ['one owner', 'launch gate'], 'usefulness'],
  ['followup', 'What follow-ups are due soon and who owns them?', ['task', 'reminder'], ['August 27', 'August 30', 'Maya'], 'follow-ups'],
  ['improvement', 'What recurring process problem should Ledger help prevent here?', ['note', 'task'], ['ownership', 'instrumentation'], 'synthesis'],
].map(([id, question, types, expected, category, kind]) => ({ id, question, expected, category, kind, ...fixtureFor(types), ...(kind === 'skill' ? { skillId: 'plan_my_week', skillDefinition: getAskLedgerSkill('plan_my_week') } : {}) }));

const models = [
  { id: 'ministral-3b-q8', path: q8Path },
  { id: 'ministral-3b-q4-k-m', path: q4Path },
];
const waitForHealth = async (port, child) => { const start = performance.now(); while (performance.now() - start < 120000) { if (child.exitCode !== null) throw new Error(`runtime exited with ${child.exitCode}`); try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) })).ok) return performance.now() - start; } catch {} await sleep(250); } throw new Error('runtime startup timeout'); };
const answer = async (port, prompt, budget) => { const start = performance.now(); const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: false, max_tokens: budget, n_predict: budget, temperature: 0.2, top_p: 0.95, top_k: 40, min_p: 0.05, messages: [{ role: 'user', content: prompt }] }) }); const json = await response.json(); const choice = json.choices?.[0]; const visible = choice?.message?.content ?? ''; return { text: visible, elapsedMs: performance.now() - start, tokens: words(visible), finishReason: choice?.finish_reason ?? null, timings: json.timings ?? null }; };
const shuffle = (items, seed) => items.map((value, index) => ({ value, sort: (seed * 9301 + index * 49297) % 233280 })).sort((a, b) => a.sort - b.sort).map(({ value }) => value);

const assets = new LocalAIAssetManager();
const prepAI = createLocalAIService(assets, { contextSize: 4096, runtimeArgs: ['--n-gpu-layers', 'all', '--no-mmproj', '--reasoning', 'off', '--parallel', '1'] });
const askLedger = createAskLedgerService(prepAI, assets);
const prepared = new Map();
for (const item of cases) { const frozen = await askLedger.prepareBenchmarkCase(item); if (!frozen.contextItems.length) throw new Error(`Empty frozen evidence for ${item.id}`); prepared.set(item.id, frozen.prompt); }
await prepAI.shutdown();

const outputs = new Map();
for (const model of models) {
  const port = model.id.endsWith('q4-k-m') ? 39501 : 39500;
  const child = spawn(runtime, ['--model', model.path, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '4096', '--parallel', '1', '--jinja', '--n-gpu-layers', 'all', '--no-mmproj', '--verbosity', '1', '--reasoning', 'off'], { stdio: 'ignore' });
  try { await waitForHealth(port, child); const modelOutputs = new Map(); for (const item of cases) { modelOutputs.set(item.id, await answer(port, prepared.get(item.id), item.kind === 'skill' ? 512 : 384)); await sleep(300); } outputs.set(model.id, modelOutputs); } finally { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
}

const blind = shuffle(cases, 731).map((item, index) => { const q8First = index % 2 === 0; const a = outputs.get(q8First ? models[0].id : models[1].id).get(item.id); const b = outputs.get(q8First ? models[1].id : models[0].id).get(item.id); return { reviewId: `P7C-${String(index + 1).padStart(2, '0')}`, category: item.category, question: item.question, expectedFacts: item.expected, answerA: a.text, answerB: b.text, timingA: a.elapsedMs, timingB: b.elapsedMs, _key: { answerA: q8First ? 'Q8' : 'Q4', answerB: q8First ? 'Q4' : 'Q8' } }; });
const review = blind.map(({ _key, ...item }) => `## ${item.reviewId} — ${item.category}\n\n**Question:** ${item.question}\n\n### Answer A\n${item.answerA || '_(no visible answer)_'}\n\n### Answer B\n${item.answerB || '_(no visible answer)_'}\n\nScore each answer 1–5: grounding, completeness, depth, synthesis, hallucination control, usefulness.\n\n**Preferred:** A / B / tie\n\n**Notes:**\n\n---`).join('\n\n');
const output = { phase: '7C', runtime: process.env.LEDGER_LLAMA_SERVER_PATH || 'configured runtime', promptCount: blind.length, frozenRuntime: { contextSize: 4096, parallel: 1, gpuLayers: 'all', mmproj: false, reasoning: 'off' }, cases: blind, answerKey: Object.fromEntries(blind.map((item) => [item.reviewId, item._key])), objective: blind.map((item) => ({ reviewId: item.reviewId, expectedFacts: item.expectedFacts, answerAWords: words(item.answerA), answerBWords: words(item.answerB), answerAContainsExpected: item.expectedFacts.filter((fact) => item.answerA.toLowerCase().includes(fact.toLowerCase())), answerBContainsExpected: item.expectedFacts.filter((fact) => item.answerB.toLowerCase().includes(fact.toLowerCase())) })) };
await writeFile('artifacts/phase7c-blind-quality.json', JSON.stringify(output, null, 2));
await writeFile('artifacts/phase7c-blind-review.md', `# Phase 7C blind quality review\n\nDo not inspect the answer key until all answers are scored. Score grounding, completeness, depth, synthesis, hallucination control, and usefulness from 1–5, then mark which answer you would rather receive in Ledger.\n\n${review}\n\n## Decision\n\nPreferred overall model: Q4 / Q8 / tie\n\nWould you switch Balanced to Q4? yes / no\n\nReason:\n`);
console.log(JSON.stringify({ phase: '7C', promptCount: blind.length, reviewFile: 'artifacts/phase7c-blind-review.md', resultsFile: 'artifacts/phase7c-blind-quality.json' }, null, 2));
