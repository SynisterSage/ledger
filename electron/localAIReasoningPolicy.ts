import type { GenerationTier } from './localAIAssets.ts';

export type ReasoningMode = 'off' | 'adaptive' | 'on';
export type ReasoningDecisionReason =
  | 'simple_request'
  | 'direct_lookup'
  | 'casual'
  | 'transformation'
  | 'explicit_reasoning_request'
  | 'complex_analysis'
  | 'multi_source_synthesis'
  | 'dependency_reasoning'
  | 'conflict_resolution'
  | 'detailed_analytical_request'
  | 'dedicated_reasoning';

export type ReasoningRequestSignals = {
  question: string;
  answerDepth?: 'brief' | 'standard' | 'detailed';
  retrievalRequired?: boolean;
  sourceCount?: number;
  attachmentCount?: number;
  hasSkill?: boolean;
  routeReason?: string;
  generationDepth?: 'quick' | 'standard' | 'deep';
};

export type ReasoningDecision = {
  mode: ReasoningMode;
  enabled: boolean;
  reason: ReasoningDecisionReason;
};

export type GenerationBudgets = {
  initial: number;
  retry: number;
  reasoning: number;
};

export const resolveGenerationBudgets = (tier: GenerationTier, configuredMaxTokens: number | undefined, contextSize: number, signals?: ReasoningRequestSignals): GenerationBudgets => {
  const deepAnswer = signals?.generationDepth === 'deep' || signals?.answerDepth === 'detailed';
  const reasoning = tier === 'powerful'
    ? ((signals?.hasSkill || (signals?.sourceCount ?? 0) >= 3 || deepAnswer) ? 2048 : 768)
    : tier === 'balanced' && signals?.retrievalRequired && signals.answerDepth !== 'brief' ? 1024 : 0;
  const initial = tier === 'powerful'
    ? Math.max(configuredMaxTokens ?? 4096, reasoning + 512, 4096)
    : tier === 'balanced' && reasoning > 0
      ? Math.max(configuredMaxTokens ?? 512, reasoning + 512, deepAnswer ? 1536 : 0)
      : Math.max(configuredMaxTokens ?? 256, tier === 'fast' && deepAnswer ? 768 : 0);
  return { initial, retry: tier === 'fast' ? initial : Math.max(initial, Math.max(256, contextSize - 256)), reasoning };
};

const explicitReasoning = /\b(think carefully|reason through|analy[sz]e deeply|deep analysis|consider the trade[- ]?offs|work through the dependencies|reason about)\b/i;
const conflict = /\b(conflict|conflicting|contradict|inconsistent|disagree|different accounts)\b/i;
const dependency = /\b(dependenc(?:y|ies)|blocked by|blocker|cause and effect|what is causing|why is|why are|figure out why)\b/i;
const analysis = /\b(analy[sz](?:e|is)|compare|evaluate|prioriti[sz]e|recommend|trade[- ]?offs?|synthesi[sz](?:e|s)|implications?|health check|assess|plan)\b/i;
const transformation = /\b(rewrite|rephrase|polish|edit|shorten|lengthen|translate|format|summari[sz]e|what does this say)\b/i;
const casual = /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|what can you do|are you there)\b[!? .,]*$/i;
const directLookup = /\b(what tasks? (?:are|is) due|when is (?:the|my) meeting|what time|what(?:'s| is) the status|list my|show me|who is|where is)\b/i;

const adaptiveDecision = (signals: ReasoningRequestSignals): ReasoningDecision => {
  const question = signals.question.trim();
  if (casual.test(question)) return { mode: 'adaptive', enabled: false, reason: 'casual' };
  if (transformation.test(question)) return { mode: 'adaptive', enabled: false, reason: 'transformation' };
  if (explicitReasoning.test(question)) return { mode: 'adaptive', enabled: true, reason: 'explicit_reasoning_request' };
  if (conflict.test(question)) return { mode: 'adaptive', enabled: true, reason: 'conflict_resolution' };
  if (dependency.test(question)) return { mode: 'adaptive', enabled: true, reason: 'dependency_reasoning' };
  if ((signals.sourceCount ?? 0) >= 3 && signals.retrievalRequired) return { mode: 'adaptive', enabled: true, reason: 'multi_source_synthesis' };
  if (signals.hasSkill || (signals.attachmentCount ?? 0) > 0 && analysis.test(question)) return { mode: 'adaptive', enabled: true, reason: 'complex_analysis' };
  if ((signals.answerDepth === 'detailed' || signals.generationDepth === 'deep') && analysis.test(question)) return { mode: 'adaptive', enabled: true, reason: 'detailed_analytical_request' };
  if (analysis.test(question)) return { mode: 'adaptive', enabled: true, reason: 'complex_analysis' };
  if (directLookup.test(question) || signals.routeReason === 'non_workspace_request' || signals.routeReason === 'direct_lookup') {
    return { mode: 'adaptive', enabled: false, reason: 'direct_lookup' };
  }
  return { mode: 'adaptive', enabled: false, reason: 'simple_request' };
};

export const resolveReasoningDecision = (tier: GenerationTier, mode: ReasoningMode, signals: ReasoningRequestSignals): ReasoningDecision => {
  if (tier === 'fast' || mode === 'off') return { mode: 'off', enabled: false, reason: 'simple_request' };
  // Powerful is a dedicated thinking model. Keep its native hidden reasoning
  // path enabled even for short conversational requests; sending /no_think to
  // this model can make its deliberation leak into the visible answer stream.
  if (tier === 'powerful') return { mode: 'on', enabled: true, reason: 'dedicated_reasoning' };
  if (mode === 'on') return { mode: 'on', enabled: true, reason: 'dedicated_reasoning' };
  return adaptiveDecision(signals);
};

export const applyQwenReasoningControl = (modelFamily: string | undefined, reasoningEnabled: boolean, context: string) => (
  modelFamily === 'Qwen3' && !reasoningEnabled ? `${context}\n/no_think` : context
);
