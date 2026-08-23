export type MeetingPrepEvalCase = { id: string; expected: 'useful' | 'empty' | 'state-aware' | 'no-match'; description: string };
export const meetingPrepEvalFixtures: MeetingPrepEvalCase[] = [
  { id: 'recurring-open-actions', expected: 'useful', description: 'Recurring meeting with unfinished actions.' },
  { id: 'all-complete', expected: 'state-aware', description: 'All prior actions are completed.' },
  { id: 'prior-unresolved', expected: 'useful', description: 'Prior unresolved question remains relevant.' },
  { id: 'project-changed', expected: 'state-aware', description: 'Linked project changed significantly.' },
  { id: 'milestone-near', expected: 'useful', description: 'Upcoming milestone is approaching.' },
  { id: 'stale-meeting', expected: 'empty', description: 'Previous meeting is stale and no current state supports it.' },
  { id: 'same-title-other-series', expected: 'no-match', description: 'Same title belongs to another series.' },
  { id: 'same-attendees-unrelated', expected: 'no-match', description: 'Same attendees but unrelated meeting.' },
  { id: 'no-prior-meeting', expected: 'empty', description: 'No previous meeting exists.' },
  { id: 'sparse-project', expected: 'empty', description: 'Sparse project context provides no useful signal.' },
  { id: 'misleading-semantic-match', expected: 'no-match', description: 'Weak semantic match must not become continuity.' },
  { id: 'note-contradiction', expected: 'state-aware', description: 'Previous transcript contradicts a human note.' },
  { id: 'completed-not-open', expected: 'state-aware', description: 'Completed task must not be reported as open.' },
  { id: 'cross-workspace-distractor', expected: 'no-match', description: 'Cross-workspace record is excluded.' },
  { id: 'nothing-useful', expected: 'empty', description: 'No useful prep information.' },
  { id: 'overdue-project-action', expected: 'state-aware', description: 'Current project has overdue actions.' },
  { id: 'series-parent-template', expected: 'useful', description: 'Series-level template and prior meeting context apply.' },
  { id: 'unresolved-risk', expected: 'useful', description: 'Prior risk remains unresolved.' },
];

export const prepTrustGate = (metrics: { useful: number; staleClaims: number; incorrectOpenClaims: number; fillerPoints: number }) => metrics.staleClaims === 0 && metrics.incorrectOpenClaims === 0 && metrics.fillerPoints === 0 && metrics.useful / meetingPrepEvalFixtures.length >= 0.7;
