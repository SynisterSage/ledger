import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQwenReasoningControl, resolveGenerationBudgets, resolveReasoningDecision } from './localAIReasoningPolicy.ts';
import { parseThinkingChunk, type ParsedThinkingStream } from './localAIService.ts';

const decide = (question: string, overrides: Record<string, unknown> = {}) => resolveReasoningDecision('balanced', 'adaptive', { question, ...overrides });

test('keeps simple Balanced requests out of reasoning', () => {
  assert.equal(decide('Hello there').enabled, false);
  assert.equal(decide('What tasks are due?').reason, 'direct_lookup');
  assert.equal(decide('Summarize this note').reason, 'transformation');
  assert.equal(decide('Rewrite this in a warmer tone').reason, 'transformation');
});

test('enables Balanced reasoning for analytical requests', () => {
  assert.equal(decide('Why is the project blocked?').reason, 'dependency_reasoning');
  assert.equal(decide('Compare these conflicting project updates').reason, 'conflict_resolution');
  assert.equal(decide('Recommend what we should prioritize', { sourceCount: 4, retrievalRequired: true }).reason, 'multi_source_synthesis');
  assert.equal(decide('Review this attachment and identify dependencies', { attachmentCount: 1 }).enabled, true);
  assert.equal(decide('Give me a detailed analysis of this project', { answerDepth: 'detailed' }).reason, 'detailed_analytical_request');
  assert.equal(decide('Think carefully and reason through the tradeoffs').reason, 'explicit_reasoning_request');
});

test('model defaults remain isolated', () => {
  assert.equal(resolveReasoningDecision('fast', 'off', { question: 'Analyze this deeply' }).enabled, false);
  assert.equal(resolveReasoningDecision('powerful', 'on', { question: 'What time is the meeting?' }).enabled, true);
  assert.equal(resolveReasoningDecision('powerful', 'on', { question: 'Analyze the project dependencies.' }).enabled, true);
  assert.equal(resolveReasoningDecision('balanced', 'adaptive', { question: 'What time is the meeting?' }).enabled, false);
});

test('Qwen thinking control is per-request and never applied to other model families', () => {
  assert.match(applyQwenReasoningControl('Qwen3', false, 'prompt'), /\/no_think$/);
  assert.equal(applyQwenReasoningControl('Qwen3', true, 'prompt'), 'prompt');
  assert.equal(applyQwenReasoningControl('Ministral 3', false, 'prompt'), 'prompt');
  assert.equal(applyQwenReasoningControl('Qwen3', resolveReasoningDecision('powerful', 'on', { question: 'hi' }).enabled, 'prompt'), 'prompt');
});

test('parses Qwen reasoning deltas separately from visible content', () => {
  const state: ParsedThinkingStream = { visibleText: '', reasoningContentObserved: false, finishReason: null, reasoningChunks: 0, contentChunks: 0, reasoningTokens: 0 };
  assert.equal(parseThinkingChunk({ choices: [{ delta: { reasoning_content: 'private reasoning' } }] }, state), '');
  assert.equal(state.reasoningContentObserved, true);
  assert.equal(parseThinkingChunk({ choices: [{ delta: { content: 'final answer' }, finish_reason: 'stop' }] }, state), 'final answer');
  assert.equal(state.finishReason, 'stop');
});

test('keeps Deep generation budget independent from brief answer depth', () => {
  assert.deepEqual(resolveGenerationBudgets('powerful', 128, 8192, { question: 'hello', answerDepth: 'brief' }), { initial: 4096, retry: 7936, reasoning: 768 });
  assert.deepEqual(resolveGenerationBudgets('powerful', 128, 8192, { question: 'analyze this', answerDepth: 'detailed', sourceCount: 4 }), { initial: 4096, retry: 7936, reasoning: 2048 });
  assert.deepEqual(resolveGenerationBudgets('balanced', 512, 4096, { question: 'analyze this', answerDepth: 'standard', retrievalRequired: true }), { initial: 1536, retry: 3840, reasoning: 1024 });
  assert.deepEqual(resolveGenerationBudgets('fast', undefined, 4096), { initial: 256, retry: 256, reasoning: 0 });
});
