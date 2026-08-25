import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticSpeakerEvent, isUsableSpeakerName, mapAccessibilityPermission, observerEligibility } from './speakerTags.ts';

test('maps Accessibility permission by platform', () => {
  assert.equal(mapAccessibilityPermission('darwin', true), 'authorized');
  assert.equal(mapAccessibilityPermission('darwin', false), 'not_authorized');
  assert.equal(mapAccessibilityPermission('win32', true), 'unsupported');
});

test('observer is eligible only for authorized macOS Zoom', () => {
  const zoom = { running: true, pid: 42 };
  assert.equal(observerEligibility('darwin', 'authorized', zoom), true);
  assert.equal(observerEligibility('darwin', 'not_authorized', zoom), false);
  assert.equal(observerEligibility('win32', 'authorized', zoom), false);
  assert.equal(observerEligibility('darwin', 'authorized', { running: false, pid: null }), false);
});

test('diagnostic events are timestamped and invalid names are ignored', () => {
  assert.deepEqual(diagnosticSpeakerEvent(' Sarah Johnson ', 123), { type: 'speaker-change', displayName: 'Sarah Johnson', observedAtMs: 123 });
  assert.equal(diagnosticSpeakerEvent(''), null);
  assert.equal(isUsableSpeakerName('Participants'), false);
  assert.equal(isUsableSpeakerName('Sarah Johnson'), true);
});
