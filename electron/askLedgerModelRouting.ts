import type { GenerationTier } from './localAIAssets.ts';

export type AskLedgerModelRoutingSignals = {
  answerDepth?: 'quick' | 'standard' | 'deep';
  researchRoute?: boolean;
  objectiveCount?: number;
  evidenceCount?: number;
  evidenceTokens?: number;
  resourceTypeCount?: number;
  entityCount?: number;
  providerCount?: number;
  crossResource?: boolean;
};

export type AskLedgerModelRoute = {
  requestedTier: GenerationTier;
  recommendedTier: GenerationTier;
  resolvedTier: GenerationTier;
  fallbackReason?: 'requested_unavailable' | 'recommended_unavailable' | 'no_installed_tier';
  reason: string;
  shouldSwitch: boolean;
};

const rank: Record<GenerationTier, number> = { fast: 0, balanced: 1, powerful: 2 };

export const recommendAskLedgerTier = (signals: AskLedgerModelRoutingSignals): { tier: GenerationTier; reason: string } => {
  if (signals.researchRoute || signals.answerDepth === 'deep' || (signals.objectiveCount ?? 0) >= 3 || (signals.providerCount ?? 0) >= 2 || signals.crossResource || (signals.entityCount ?? 0) >= 3) {
    return { tier: 'powerful', reason: 'bounded research or cross-resource synthesis' };
  }
  if (signals.answerDepth === 'standard' || (signals.evidenceCount ?? 0) >= 6 || (signals.evidenceTokens ?? 0) >= 1800 || (signals.resourceTypeCount ?? 0) >= 2) {
    return { tier: 'balanced', reason: 'moderate grounded synthesis' };
  }
  return { tier: 'fast', reason: 'narrow grounded lookup' };
};

export const resolveAskLedgerModelRoute = ({
  requestedTier,
  installedTiers,
  signals,
}: {
  requestedTier: GenerationTier;
  installedTiers: readonly GenerationTier[];
  signals: AskLedgerModelRoutingSignals;
}): AskLedgerModelRoute => {
  const recommendation = recommendAskLedgerTier(signals);
  const recommendedTier = recommendation.tier;
  const installed = new Set(installedTiers);
  const availableAtOrBelow = (tier: GenerationTier) => [...installed].filter((candidate) => rank[candidate] <= rank[tier]).sort((left, right) => rank[right] - rank[left])[0];
  const resolvedTier = installed.has(requestedTier)
    ? requestedTier
    : availableAtOrBelow(requestedTier) ?? [...installed].sort((left, right) => rank[right] - rank[left])[0];
  if (!resolvedTier) return { requestedTier, recommendedTier, resolvedTier: requestedTier, fallbackReason: 'no_installed_tier', reason: 'no generation tier is installed', shouldSwitch: false };
  const fallbackReason = installed.has(requestedTier) ? undefined : 'requested_unavailable' as const;
  const shouldSwitch = !fallbackReason && resolvedTier !== recommendedTier && installed.has(recommendedTier) && rank[recommendedTier] > rank[resolvedTier];
  return {
    requestedTier,
    recommendedTier,
    resolvedTier,
    fallbackReason,
    reason: fallbackReason ? `requested tier unavailable; using ${resolvedTier}` : shouldSwitch ? recommendation.reason : 'current installed tier is sufficient',
    shouldSwitch,
  };
};
