import type { AskLedgerToolSurface } from './tools.ts';

export type AskLedgerAgentActivityStep = {
  type: 'retrieving' | 'generating' | 'validating' | 'fallback';
  sourceCount?: number;
};

export type AskLedgerAgentActivity = {
  surface: AskLedgerToolSurface;
  durationMs: number;
  steps: AskLedgerAgentActivityStep[];
};
