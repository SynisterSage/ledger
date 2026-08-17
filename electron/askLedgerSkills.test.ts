import test from 'node:test';
import assert from 'node:assert/strict';
import { getAskLedgerSkill, listAskLedgerSkills, validateSkillContext } from './askLedgerSkills.ts';

test('registry exposes the five built-in skills without trusted instructions', () => {
  const skills = listAskLedgerSkills();
  assert.deepEqual(skills.map((skill) => skill.id), [
    'meeting_follow_up',
    'project_health_check',
    'plan_my_week',
    'turn_notes_into_tasks',
    'prepare_for_meeting',
  ]);
  assert.equal('instructions' in skills[0], false);
});

test('skill context requirements are enforced centrally', () => {
  const meeting = getAskLedgerSkill('meeting_follow_up');
  assert.ok(meeting);
  if (!meeting) return;
  const missingContextError = validateSkillContext(meeting);
  assert.ok(missingContextError);
  assert.match(missingContextError, /needs a Ledger resource/);
  const wrongContextError = validateSkillContext(meeting, { resourceType: 'note', resourceId: 'note-1', title: 'A note' });
  assert.ok(wrongContextError);
  assert.match(wrongContextError, /does not support note/);
  assert.equal(validateSkillContext(meeting, { resourceType: 'transcript', resourceId: 'transcript-1', title: 'Weekly sync' }), null);
});
