import type { AskLedgerBudget } from './contracts.ts';

export type AskLedgerRetrievalMode = 'quick' | 'standard' | 'research';

export const ASK_LEDGER_BUDGETS: Record<AskLedgerRetrievalMode, AskLedgerBudget> = {
  quick: { ...{ candidateLimit: 20, rerankLimit: 12, selectedResourceLimit: 6, evidenceTokenBudget: 1800, contextTokenBudget: 2400, maxItemTokens: 420, maxTranscriptSegmentsPerParent: 2 } },
  standard: { ...ASK_LEDGER_DESKTOP_BUDGET },
  research: { candidateLimit: 60, rerankLimit: 30, selectedResourceLimit: 20, evidenceTokenBudget: 4200, contextTokenBudget: 6000, maxItemTokens: 720, maxTranscriptSegmentsPerParent: 3 },
};

export const budgetForAskLedgerMode = (mode: AskLedgerRetrievalMode, overrides: Partial<AskLedgerBudget> = {}) => ({ ...ASK_LEDGER_BUDGETS[mode], ...overrides });

import { ASK_LEDGER_DESKTOP_BUDGET } from './contracts.ts';
