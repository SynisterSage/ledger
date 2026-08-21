import type { GenerationTier } from './localAIAssets.ts';
import { resolveReasoningDecision } from './localAIReasoningPolicy.ts';

export type AskLedgerModelRoutingSignals = { question?: string; answerDepth?: 'quick' | 'standard' | 'deep'; researchRoute?: boolean; objectiveCount?: number; evidenceCount?: number; evidenceTokens?: number; resourceTypeCount?: number; entityCount?: number; providerCount?: number; crossResource?: boolean; skillReasoningPolicy?: 'off' | 'optional' | 'preferred' };
export type AskLedgerModelRoute = { requestedTier: GenerationTier; recommendedTier: GenerationTier; resolvedTier: GenerationTier; reasoningMode: 'off' | 'thinking'; reasoningReason: string; fallbackReason?: 'requested_unavailable' | 'recommended_unavailable' | 'no_installed_tier'; reason: string; shouldSwitch: boolean };
const rank: Record<'fast' | 'balanced', number> = { fast: 0, balanced: 1 };

export const recommendAskLedgerTier = (signals: AskLedgerModelRoutingSignals): { tier: 'fast' | 'balanced'; reason: string; reasoningMode: 'off' | 'thinking'; reasoningReason: string } => {
  const broad = Boolean(signals.researchRoute || signals.answerDepth === 'deep' || (signals.objectiveCount ?? 0) >= 3 || (signals.providerCount ?? 0) >= 2 || signals.crossResource || (signals.entityCount ?? 0) >= 3);
  const moderate = Boolean(signals.answerDepth === 'standard' || (signals.evidenceCount ?? 0) >= 6 || (signals.evidenceTokens ?? 0) >= 1800 || (signals.resourceTypeCount ?? 0) >= 2);
  const decision = resolveReasoningDecision('balanced', 'auto', { question: signals.question ?? '', answerDepth: signals.answerDepth === 'deep' ? 'detailed' : signals.answerDepth === 'quick' ? 'brief' : 'standard', retrievalRequired: broad || moderate, sourceCount: signals.evidenceCount, generationDepth: signals.answerDepth, skillReasoningPolicy: signals.skillReasoningPolicy });
  if (broad || moderate) return { tier: 'balanced', reason: moderate ? 'grounded synthesis on the Balanced model' : 'research context on the Balanced model', reasoningMode: decision.enabled ? 'thinking' : 'off', reasoningReason: decision.reason };
  return { tier: 'fast', reason: 'narrow grounded lookup', reasoningMode: 'off', reasoningReason: decision.reason };
};

export const resolveAskLedgerModelRoute = ({ requestedTier, installedTiers, signals }: { requestedTier: GenerationTier; installedTiers: readonly GenerationTier[]; signals: AskLedgerModelRoutingSignals }): AskLedgerModelRoute => {
  const recommendation = recommendAskLedgerTier(signals);
  const normalizedRequested = requestedTier === 'powerful' ? 'balanced' : requestedTier;
  const installed = new Set(installedTiers.map((tier) => tier === 'powerful' ? 'balanced' : tier));
  const resolvedTier = installed.has(normalizedRequested) ? normalizedRequested : [...installed].sort((a, b) => rank[b] - rank[a])[0];
  if (!resolvedTier) return { requestedTier, recommendedTier: recommendation.tier, resolvedTier: 'fast', reasoningMode: 'off', reasoningReason: 'no_installed_tier', fallbackReason: 'no_installed_tier', reason: 'no generation tier is installed', shouldSwitch: false };
  const fallbackReason = requestedTier === 'powerful' || !installed.has(normalizedRequested) ? 'requested_unavailable' as const : undefined;
  const shouldSwitch = !fallbackReason && resolvedTier !== recommendation.tier && installed.has(recommendation.tier) && rank[recommendation.tier] > rank[resolvedTier];
  const thinking = resolvedTier === 'balanced' && (normalizedRequested === 'balanced' || recommendation.tier === 'balanced') ? recommendation.reasoningMode : 'off';
  return { requestedTier, recommendedTier: recommendation.tier, resolvedTier, reasoningMode: thinking, reasoningReason: thinking === 'thinking' ? recommendation.reasoningReason : 'simple_request', fallbackReason, reason: fallbackReason ? `requested tier unavailable; using ${resolvedTier}` : shouldSwitch ? recommendation.reason : 'current installed tier is sufficient', shouldSwitch };
};
