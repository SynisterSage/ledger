import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeterministicSpeakerIdentity } from '../../src/types/meetingPeople.ts';

const segment = (audio_source) => ({ id: 'segment-1', audio_source, speaker_label: null, start_ms: 0, end_ms: 1000, transcript_text: 'hello', confidence: 1, segment_order: 0 });
const metadata = (attendees) => ({ attendees });

test('microphone maps deterministically to the current user', () => {
  const identity = resolveDeterministicSpeakerIdentity({ segment: segment('user_microphone'), metadata: metadata([]), currentUser: { id: 'user-1', email: 'lex@example.com' }, currentUserName: 'Lex' });
  assert.deepEqual(identity, { rawSpeakerId: 'source:user_microphone', personId: 'user-1', displayName: 'Lex', state: 'known', confidence: 1, source: 'current_user', confirmedByUser: false });
});

test('one external attendee maps system audio, but group audio stays unknown', () => {
  const one = resolveDeterministicSpeakerIdentity({ segment: segment('system_audio'), metadata: metadata([{ id: 'person-1', name: 'Sam', email: 'sam@example.com' }]), currentUser: { id: 'user-1', email: 'lex@example.com' }, currentUserName: 'Lex' });
  assert.equal(one.displayName, 'Sam');
  assert.equal(one.state, 'known');
  const group = resolveDeterministicSpeakerIdentity({ segment: segment('system_audio'), metadata: metadata([{ name: 'Sam' }, { name: 'Jordan' }]), currentUserName: 'Lex' });
  assert.equal(group.state, 'unknown');
  assert.equal(group.displayName, undefined);
});

test('user-confirmed identity is preserved over deterministic resolution', () => {
  const identity = resolveDeterministicSpeakerIdentity({ segment: { ...segment('system_audio'), speaker_identity: { displayName: 'Jordan', state: 'known', confirmedByUser: true, source: 'user_confirmed' } }, metadata: metadata([{ name: 'Sam' }]) });
  assert.equal(identity.displayName, 'Jordan');
  assert.equal(identity.confirmedByUser, true);
});
