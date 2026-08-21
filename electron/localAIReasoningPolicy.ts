import type { GenerationTier } from './localAIAssets.ts';

export type ReasoningMode = 'off' | 'auto' | 'thinking' | 'adaptive' | 'on';
export type ReasoningDecisionReason = 'simple_request' | 'direct_lookup' | 'casual' | 'transformation' | 'explicit_reasoning_request' | 'conflict_resolution' | 'dependency_reasoning' | 'priority_tradeoffs' | 'recommendation' | 'risk_analysis' | 'dedicated_reasoning';
export type ReasoningRequestSignals = { question: string; answerDepth?: 'brief' | 'standard' | 'detailed'; retrievalRequired?: boolean; sourceCount?: number; attachmentCount?: number; hasSkill?: boolean; routeReason?: string; generationDepth?: 'quick' | 'standard' | 'deep'; reasoningMode?: ReasoningMode; skillReasoningPolicy?: 'off' | 'optional' | 'preferred' };
export type ReasoningDecision = { mode: 'off' | 'thinking'; enabled: boolean; reason: ReasoningDecisionReason };
export type GenerationBudgets = { initial: number; retry: number; reasoning: number; visible: number };

const explicitReasoning = /\b(think deeper|think deeply|really analy[sz]e|reason through|think this through|deep analysis|work through)\b/i;
const conflict = /\b(conflict(?:ing)?|contradict|inconsistent|disagree|different accounts|what(?:'s| is) actually true)\b/i;
const dependency = /\b(dependenc(?:y|ies)|blocked by|blocker|what is causing|why is|why are|figure out why|keeps slipping|get .* back on track)\b/i;
const prioritization = /\b(prioriti[sz]e|what should I focus on|what matters most|urgency|impact|trade[- ]?offs?)\b/i;
const recommendation = /\b(compare .* recommend|recommend which|which .* should we|evaluate .* approach|choose between)\b/i;
const risk = /\b(at risk|risk analysis|risks?|threats?|what could go wrong)\b/i;
const transformation = /\b(rewrite|rephrase|polish|edit|shorten|lengthen|translate|format|summari[sz]e|what did .* say)\b/i;
const casual = /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|what can you do|are you there)\b[!? .,]*$/i;
const directLookup = /\b(what tasks? (?:are|is) due|when is (?:the|my) meeting|what time|what(?:'s| is) the status|list my|show me|who is|where is|what changed|what happened)\b/i;

export const resolveReasoningDecision = (tier: GenerationTier, mode: ReasoningMode, signals: ReasoningRequestSignals): ReasoningDecision => {
  if (tier === 'fast' || mode === 'off' || signals.skillReasoningPolicy === 'off') return { mode: 'off', enabled: false, reason: 'simple_request' };
  if (mode === 'thinking' || mode === 'on') return { mode: 'thinking', enabled: true, reason: 'dedicated_reasoning' };
  if (signals.skillReasoningPolicy === 'preferred') return { mode: 'thinking', enabled: true, reason: 'dedicated_reasoning' };
  if (casual.test(signals.question) || transformation.test(signals.question) || directLookup.test(signals.question)) return { mode: 'off', enabled: false, reason: transformation.test(signals.question) ? 'transformation' : directLookup.test(signals.question) ? 'direct_lookup' : 'casual' };
  if (explicitReasoning.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'explicit_reasoning_request' };
  if (conflict.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'conflict_resolution' };
  if (dependency.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'dependency_reasoning' };
  if (recommendation.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'recommendation' };
  if (prioritization.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'priority_tradeoffs' };
  if (risk.test(signals.question)) return { mode: 'thinking', enabled: true, reason: 'risk_analysis' };
  return { mode: 'off', enabled: false, reason: 'simple_request' };
};

export const resolveGenerationBudgets = (tier: GenerationTier, configuredMaxTokens: number | undefined, _contextSize: number, signals?: ReasoningRequestSignals, reasoningEnabled = false): GenerationBudgets => {
  const inferred = signals ? resolveReasoningDecision(tier, signals.reasoningMode ?? 'auto', signals).enabled : false;
  const thinking = tier !== 'fast' && (reasoningEnabled || inferred);
  const visible = Math.min(640, Math.max(448, configuredMaxTokens ?? 512));
  const reasoning = thinking ? 384 : 0;
  const initial = thinking ? reasoning + visible : visible;
  return { initial, retry: initial, reasoning, visible };
};

export const applyQwenReasoningControl = (modelFamily: string | undefined, reasoningEnabled: boolean, context: string) => (
  modelFamily === 'Qwen3' ? `${context}\n${reasoningEnabled ? '/think' : '/no_think'}` : context
);
