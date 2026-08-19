import test from 'node:test';
import assert from 'node:assert/strict';
import { AskLedgerAnswerValidator } from './askLedgerAnswerValidator.ts';
import type { AskLedgerEvidencePackage } from '../src/types/askLedgerResourceContract.ts';

const evidence = (overrides: Partial<AskLedgerEvidencePackage['coverage']> = {}): AskLedgerEvidencePackage => {
  const task = { resourceType: 'task' as const, resourceId: 'task-1', title: 'Review Final Proof', content: 'Final proof review.', dueAt: '2026-08-20', status: 'In Progress' };
  const milestone = { resourceType: 'milestone' as const, resourceId: 'milestone-1', title: 'Final Production', content: 'Production milestone.', status: 'In Progress' };
  return {
    request: 'Connect projects, milestones, and tasks.',
    coverage: { requested: ['projects', 'milestones', 'tasks'], found: ['projects', 'milestones', 'tasks'], missing: [], truncated: [], ...overrides },
    sections: [
      { category: 'tasks', title: 'Tasks', items: [{ resource: task, source: { resourceType: 'task', resourceId: 'task-1', title: task.title, relationshipPath: ['project:project-1', 'task:task-1'], score: { retrievalRelevance: 1, structuralRelevance: 1, temporalRelevance: 1, objectiveRelevance: 1, authority: 1, finalScore: 1, reasons: [] } } }] },
      { category: 'milestones', title: 'Milestones', items: [{ resource: milestone, source: { resourceType: 'milestone', resourceId: 'milestone-1', title: milestone.title, relationshipPath: ['project:project-1', 'milestone:milestone-1'], score: { retrievalRelevance: 1, structuralRelevance: 1, temporalRelevance: 1, objectiveRelevance: 1, authority: 1, finalScore: 1, reasons: [] } } }] },
    ],
    sources: [],
    stats: { retrieved: 2, selected: 2, dropped: 0, estimatedTokens: 100, estimatedTokensBefore: 100 },
    text: 'MILESTONES\n- Final Production\nTASKS\n- Review Final Proof — Due: 2026-08-20',
  };
};

test('fails when an important requested category is omitted', () => {
  const result = new AskLedgerAnswerValidator().validate({ question: 'Connect projects, milestones, and tasks.', answer: 'The project has one open task: Review Final Proof.', evidencePackage: evidence() , depth: 'deep' });
  assert.equal(result.passed, false);
  assert.deepEqual(result.coverageIssues.map((issue) => issue.category), ['milestones']);
  assert.equal(result.repairRecommended, true);
});

test('detects an incorrect structured due date', () => {
  const result = new AskLedgerAnswerValidator().validate({ question: 'When is Review Final Proof due?', answer: 'Review Final Proof is due Aug 22.', evidencePackage: evidence(), depth: 'quick' });
  assert.equal(result.passed, false);
  assert.equal(result.groundednessIssues[0]?.code, 'structured_due_date_mismatch');
});

test('rejects certainty about an unavailable provider but accepts explicit uncertainty', () => {
  const unavailable = evidence({ requested: ['external'], found: [], missing: ['external'], unavailable: ['GitHub'] });
  const validator = new AskLedgerAnswerValidator();
  assert.equal(validator.validate({ question: 'What happened in GitHub?', answer: 'There were no GitHub updates.', evidencePackage: unavailable, depth: 'standard' }).passed, false);
  assert.equal(validator.validate({ question: 'What happened in GitHub?', answer: "I couldn't verify GitHub activity because GitHub context was unavailable.", evidencePackage: unavailable, depth: 'standard' }).passed, true);
});

test('accepts a current structured fact and source references', () => {
  const result = new AskLedgerAnswerValidator().validate({ question: 'What is due?', answer: 'Review Final Proof is due Aug 20 and remains In Progress.', evidencePackage: evidence(), depth: 'quick' });
  assert.equal(result.passed, true);
  assert.deepEqual(result.sourceReferences.map((source) => source.resourceId), ['task-1']);
});
