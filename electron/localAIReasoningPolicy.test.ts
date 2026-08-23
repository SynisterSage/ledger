import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQwenReasoningControl, resolveGenerationBudgets, resolveReasoningDecision } from './localAIReasoningPolicy.ts';
import { parseThinkingChunk, type ParsedThinkingStream } from './localAIService.ts';

const decide = (question: string, overrides: Record<string, unknown> = {}) => resolveReasoningDecision('balanced', 'auto', { question, ...overrides });

test('keeps direct and transformation requests out of Thinking', () => {
  for (const question of ["What's due today?", 'Summarize this meeting.', 'What did Sarah say?', 'Show my recent notes.', "What's a mutex?"]) assert.equal(decide(question).enabled, false, question);
  assert.equal(decide('What changed this week?').enabled, false);
});

test('selects Thinking for explicit and genuinely analytical requests', () => {
  for (const question of ['Think deeply about why Atlas keeps slipping.', 'Compare the two launch plans and tell me which one you recommend.', 'Work through these conflicting updates and tell me what is most likely true.', 'Help me prioritize these projects based on urgency, dependencies, and impact.']) {
    assert.equal(decide(question).enabled, true, question);
    assert.equal(decide(question).mode, 'thinking');
  }
  assert.equal(decide('Summarize my last three meetings.', { skillReasoningPolicy: 'preferred' }).enabled, true);
  assert.equal(decide('Plan my week.', { skillReasoningPolicy: 'optional' }).enabled, false);
});

test('Fast and explicit off policies never enable Thinking', () => {
  assert.equal(resolveReasoningDecision('fast', 'auto', { question: 'Think deeply about this.' }).enabled, false);
  assert.equal(resolveReasoningDecision('balanced', 'off', { question: 'Analyze the dependencies.' }).enabled, false);
});

test('Qwen control is per request and hides reasoning from other families', () => {
  assert.match(applyQwenReasoningControl('Qwen3', false, 'prompt'), /\/no_think$/);
  assert.match(applyQwenReasoningControl('Qwen3', true, 'prompt'), /\/think$/);
  assert.equal(applyQwenReasoningControl('Ministral 3', true, 'prompt'), 'prompt');
});

test('parses reasoning deltas separately from visible content', () => {
  const state: ParsedThinkingStream = { visibleText: '', reasoningContentObserved: false, finishReason: null, reasoningChunks: 0, contentChunks: 0, reasoningTokens: 0 };
  assert.equal(parseThinkingChunk({ choices: [{ delta: { reasoning_content: 'private reasoning' } }] }, state), '');
  assert.equal(state.reasoningContentObserved, true);
  assert.equal(parseThinkingChunk({ choices: [{ delta: { content: 'final answer' }, finish_reason: 'stop' }] }, state), 'final answer');
  assert.equal(state.finishReason, 'stop');
});

test('separates bounded reasoning and visible-answer budgets', () => {
  assert.deepEqual(resolveGenerationBudgets('balanced', 512, 4096, { question: 'Summarize this.' }), { initial: 512, retry: 512, reasoning: 0, visible: 512 });
  assert.deepEqual(resolveGenerationBudgets('balanced', 512, 4096, { question: 'Think deeply about this.' }), { initial: 896, retry: 896, reasoning: 384, visible: 512 });
  assert.deepEqual(resolveGenerationBudgets('balanced', 640, 4096, { question: 'Think deeply about this.' }), { initial: 1024, retry: 1024, reasoning: 384, visible: 640 });
  assert.deepEqual(resolveGenerationBudgets('fast', 768, 4096, { question: 'Build my week.', hasSkill: true }), { initial: 768, retry: 768, reasoning: 0, visible: 768 });
  assert.deepEqual(resolveGenerationBudgets('fast', 768, 4096, { question: 'Normal answer.' }), { initial: 640, retry: 640, reasoning: 0, visible: 640 });
});
