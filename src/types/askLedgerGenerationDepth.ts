import type { AskLedgerAnswerDepth } from './askLedgerAnswerDepth.ts';
import type { AskLedgerOrchestrationDiagnostics } from './askLedgerResourceContract.ts';

export type AskLedgerGenerationDepth = 'quick' | 'standard' | 'deep';

export type AskLedgerGenerationDepthDecision = {
  depth: AskLedgerGenerationDepth;
  explicit: boolean;
  reason: string;
};

const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const explicitQuick = /\b(?:brief(?:ly)?|quick answer|short version|one sentence|just tell me)\b/i;
const explicitDeep = /\b(?:full picture|go deep(?:er)?|deep dive|in detail|detailed|thorough|walk me through)\b/i;
const researchSignals = /\b(?:look through|across|connect|tie together|where everything stands|what have i been working on|what needs my attention|summari[sz]e .* and|full update)\b/i;

export const inferAskLedgerGenerationDepth = (input: {
  question: string;
  routeDepth?: AskLedgerAnswerDepth;
  retrievalMode?: 'quick' | 'research';
  orchestration?: Pick<AskLedgerOrchestrationDiagnostics, 'objectives' | 'coverage'>;
}): AskLedgerGenerationDepthDecision => {
  const normalized = normalize(input.question);
  if (explicitQuick.test(normalized)) return { depth: 'quick', explicit: true, reason: 'explicit_quick_request' };
  if (explicitDeep.test(normalized) || input.routeDepth === 'detailed') return { depth: 'deep', explicit: input.routeDepth === 'detailed' || explicitDeep.test(normalized), reason: input.routeDepth === 'detailed' ? 'explicit_detail_request' : 'explicit_deep_request' };
  if (input.retrievalMode === 'research' || (input.orchestration?.objectives.length ?? 0) > 1 || researchSignals.test(normalized)) return { depth: 'deep', explicit: false, reason: input.retrievalMode === 'research' ? 'research_route' : 'cross_resource_synthesis' };
  if (input.routeDepth === 'brief') return { depth: 'quick', explicit: false, reason: 'brief_route' };
  return { depth: 'standard', explicit: false, reason: 'standard_route' };
};
