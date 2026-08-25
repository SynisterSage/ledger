import assert from 'node:assert/strict';
import test from 'node:test';
import { matchZoomDisplayNameToAttendee, resolveDeterministicSpeakerIdentity } from './meetingPeople.ts';

test('Zoom name attaches only to a unique attendee match', () => {
  assert.equal(matchZoomDisplayNameToAttendee('Sarah Johnson', [{ id: 'person-1', name: 'Sarah Johnson' }])?.id, 'person-1');
  assert.equal(matchZoomDisplayNameToAttendee('Sarah Johnson', [{ id: 'person-1', name: 'Sarah Johnson' }, { id: 'person-2', name: 'Sarah Johnson' }]), null);
  assert.equal(matchZoomDisplayNameToAttendee('Unknown', [{ id: 'person-1', name: 'Sarah Johnson' }]), null);
});

test('user-confirmed identity wins and Zoom identity beats calendar fallback', () => {
  const metadata = { attendees: [{ id: 'person-1', name: 'Sarah Johnson' }], calendar_event_id: 'event-1' } as never;
  const zoom = { audio_source: 'system_audio' as const, speaker_label: 'Sarah Johnson', speaker_identity: { displayName: 'Sarah Johnson', state: 'known' as const, source: 'zoom_accessibility' as const, confirmedByUser: false as const }, start_ms: 0, end_ms: 1000 } as never;
  assert.equal(resolveDeterministicSpeakerIdentity({ segment: zoom, metadata }).source, 'zoom_accessibility');
  const confirmed = { audio_source: 'system_audio' as const, speaker_label: 'Client', speaker_identity: { displayName: 'Client', state: 'known' as const, source: 'user_confirmed' as const, confirmedByUser: true as const }, start_ms: 0, end_ms: 1000 } as never;
  assert.equal(resolveDeterministicSpeakerIdentity({ segment: confirmed, metadata }).displayName, 'Client');
});
