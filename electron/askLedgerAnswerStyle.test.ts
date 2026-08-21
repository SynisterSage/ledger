import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LEDGER_PRESENTATION_PROFILES, buildAskLedgerAnswerStyleContract, deriveAskLedgerPresentationSignals, diagnoseAskLedgerAnswerStyle } from './askLedgerAnswerStyle.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

test('style contract adapts by execution mode and skill profile', () => {
  const lookup = buildAskLedgerAnswerStyleContract({ executionMode: 'workspace_lookup' });
  const weekly = buildAskLedgerAnswerStyleContract({ executionMode: 'workspace_synthesis', profile: 'weekly_plan' });
  const conversation = buildAskLedgerAnswerStyleContract({ executionMode: 'conversation' });
  assert.match(lookup, /one concise sentence or short paragraph/);
  assert.match(weekly, /🎯 Focus this week → 📅 Deadlines & commitments → ⚠️ Watchouts → ✅ Next steps/);
  assert.match(conversation, /usually 1–3 short paragraphs/);
  assert.match(weekly, /avoid phrases like/);
});

test('profiles define ordered sections, density, list type, and dynamic optional sections', () => {
  assert.deepEqual(ASK_LEDGER_PRESENTATION_PROFILES.weekly_plan.sectionOrder, ['🎯 Focus this week', '📅 Deadlines & commitments', '⚠️ Watchouts', '✅ Next steps']);
  assert.equal(ASK_LEDGER_PRESENTATION_PROFILES.meeting_summary.preferredListType, 'mixed');
  assert.equal(ASK_LEDGER_PRESENTATION_PROFILES.research_analysis.density, 'deep_compact');
  const items: AskLedgerContextItem[] = [{ resourceType: 'task', resourceId: 'task-1', title: 'Finish proof', content: '', status: 'open', dueAt: '2026-08-21' }];
  const signals = deriveAskLedgerPresentationSignals(items, { timeZone: 'America/New_York', now: new Date('2026-08-21T12:00:00Z') });
  assert.equal(signals.overdueItems, 0);
  assert.equal(signals.blockersPresent, false);
  assert.equal(signals.actionItemsPresent, true);
});

test('layout diagnostics distinguish supported sections from empty or invented template sections', () => {
  const weekly = diagnoseAskLedgerAnswerStyle('## 🎯 Focus this week\n\nFinish the exhibition.\n\n## 📅 Deadlines & commitments\n\n- **Exhibition:** due today\n\n## ✅ Next steps\n\n1. Finish the exhibition.', { profile: 'weekly_plan', signals: { overdueItems: 0, upcomingMeetings: 0, blockersPresent: false, actionItemsPresent: true, decisionsPresent: false, openQuestionsPresent: false, progressPresent: false, datedItems: 1, resourceCount: 1 } });
  assert.deepEqual(weekly.expectedSectionMissing, []);
  assert.equal(weekly.actionListProperlyOrdered, true);
  const meeting = diagnoseAskLedgerAnswerStyle('## 📝 Summary\n\nThe team aligned on the launch sequence.\n\n## 📌 Action items\n\n- **Lex:** review the draft.', { profile: 'meeting_summary', signals: { overdueItems: 0, upcomingMeetings: 0, blockersPresent: false, actionItemsPresent: true, decisionsPresent: false, openQuestionsPresent: false, progressPresent: false, datedItems: 0, resourceCount: 1 } });
  assert.deepEqual(meeting.expectedSectionMissing, []);
  const project = diagnoseAskLedgerAnswerStyle('## 📍 Where things stand\n\nThe project is moving.\n\n## 🔄 Recent progress\n\n- Draft reviewed.\n\n## ✅ Next moves\n\n1. Share the next revision.', { profile: 'project_status', signals: { overdueItems: 0, upcomingMeetings: 0, blockersPresent: false, actionItemsPresent: true, decisionsPresent: false, openQuestionsPresent: false, progressPresent: true, datedItems: 0, resourceCount: 1 } });
  assert.equal(project.emptySectionDetected, false);
  assert.deepEqual(project.expectedSectionMissing, []);
});

test('dense lists, lookups, weekly plans, casual conversation, research, and empty sections have measurable style signals', () => {
  const dense = diagnoseAskLedgerAnswerStyle('## 📌 Key work\n\n- **Exhibition:** finish checks\n- **Zhou:** upload logs\n- **Portfolio:** submit the remaining work\n\n## ✅ Next steps\n\n1. Finish the oldest item.');
  assert.equal(dense.largeParagraphDetected, false);
  assert.equal(dense.usefulBulletStructure, true);
  assert.equal(dense.actionableConclusion, true);

  const lookup = diagnoseAskLedgerAnswerStyle('**Packanack Work** is Friday at **3:00 PM**.');
  assert.equal(lookup.excessiveHeadingCount, false);
  assert.equal(lookup.usefulBulletStructure, false);

  const casual = diagnoseAskLedgerAnswerStyle('Thanks — happy to help.');
  assert.equal(casual.excessiveHeadingCount, false);
  assert.equal(casual.internalLanguageDetected, false);

  const research = diagnoseAskLedgerAnswerStyle('## 💡 What stands out\n\nThe exhibition work is the main pressure point.\n\n## ⚠️ Risks\n\n- Overdue work is competing with newer commitments.\n\n## ✅ What I’d do next\n\n1. Close the oldest overdue item.');
  assert.equal(research.excessiveHeadingCount, false);
  assert.equal(research.internalLanguageDetected, false);

  const emptyOmitted = diagnoseAskLedgerAnswerStyle('## 🎯 Focus this week\n\nFinish the exhibition work.\n\n## ✅ Next steps\n\n1. Start with final checks.');
  assert.equal(emptyOmitted.excessiveHeadingCount, false);
});

test('diagnostics flag internal language, repeated headings, and emoji spam', () => {
  const diagnostics = diagnoseAskLedgerAnswerStyle('## A\n\nThe evidence suggests this is risky.\n\n## A\n\n🔥🚀✨💯 More detail.');
  assert.equal(diagnostics.internalLanguageDetected, true);
  assert.equal(diagnostics.redundantHeadingDetected, true);
  assert.equal(diagnostics.excessiveEmojiUsage, true);
});
