import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetingAutoStopCoordinator } from '../../electron/meetingAutoStopCoordinator.ts';

const make = (config = {}) => {
  const events = [];
  const coordinator = new MeetingAutoStopCoordinator({
    config: { calendarSilenceMs: 120, callEndedSilenceMs: 90, inactivitySilenceMs: 300, graceMs: 20, ...config },
    onGrace: (event) => events.push(['grace', event]),
    onStop: (reason, noteId) => events.push(['stop', reason, noteId]),
    onNewMeeting: (context) => events.push(['new-meeting', context]),
  });
  return { coordinator, events };
};

test('calendar end plus silence enters grace and stops', () => {
  const { coordinator, events } = make();
  coordinator.start({ noteId: 'n1', scheduledEndAt: new Date(1000).toISOString() }, 0);
  coordinator.tick(1120);
  assert.equal(events.filter(([kind]) => kind === 'grace').length, 1);
  coordinator.finishGrace(1141);
  assert.deepEqual(events.at(-1), ['stop', 'calendar_end', 'n1']);
});

test('meaningful audio cancels a pending calendar stop', () => {
  const { coordinator, events } = make();
  coordinator.start({ noteId: 'n1', scheduledEndAt: new Date(1000).toISOString() }, 0);
  coordinator.tick(1120);
  coordinator.audioLevel(0.8, 1130);
  coordinator.finishGrace(1200);
  assert.equal(events.some(([kind]) => kind === 'stop'), false);
});

test('call ended plus silence stops, but an ambiguous call does not', () => {
  const first = make({ callEndedSilenceMs: 300 });
  first.coordinator.start({ noteId: 'n1' }, 0);
  first.coordinator.signalCallEnded('n1', 100);
  first.coordinator.tick(401);
  first.coordinator.finishGrace(422);
  assert.equal(first.events.some(([kind, reason]) => kind === 'stop' && reason === 'call_ended'), true);

  const second = make();
  second.coordinator.start({ noteId: 'n1' }, 0);
  second.coordinator.tick(200);
  assert.equal(second.events.some(([kind]) => kind === 'stop'), false);
});

test('fallback inactivity, sleep, and Keep recording are safe', () => {
  const fallback = make();
  fallback.coordinator.start({ noteId: 'n1' }, 0);
  fallback.coordinator.tick(301);
  fallback.coordinator.keepRecording(310);
  fallback.coordinator.finishGrace(400);
  assert.equal(fallback.events.some(([kind]) => kind === 'stop'), false);
  fallback.coordinator.tick(611);
  fallback.coordinator.finishGrace(632);
  assert.equal(fallback.events.some(([kind, reason]) => kind === 'stop' && reason === 'inactivity'), true);

  const sleeping = make();
  sleeping.coordinator.start({ noteId: 'n2' }, 0);
  assert.equal(sleeping.coordinator.sleep(), true);
  assert.deepEqual(sleeping.events.at(-1), ['stop', 'sleep', 'n2']);
});

test('pause prevents inactivity and resume resets the timer', () => {
  const { coordinator, events } = make();
  coordinator.start({ noteId: 'n1' }, 0);
  coordinator.pause();
  coordinator.tick(1000);
  assert.equal(events.some(([kind]) => kind === 'stop'), false);
  coordinator.resume(1000);
  coordinator.tick(1299);
  assert.equal(events.some(([kind]) => kind === 'stop'), false);
});

test('back-to-back meeting signal never silently splits the active note', () => {
  const { coordinator, events } = make();
  coordinator.start({ noteId: 'n1' }, 0);
  assert.equal(coordinator.signalNewMeeting({ noteId: 'n2', title: 'Next call' }), true);
  assert.deepEqual(events, [['new-meeting', { noteId: 'n2', title: 'Next call' }]]);
  assert.equal(coordinator.state()?.noteId, 'n1');
});

test('only one grace notification is emitted for a pending stop', () => {
  const { coordinator, events } = make();
  coordinator.start({ noteId: 'n1' }, 0);
  coordinator.tick(301);
  coordinator.tick(302);
  assert.equal(events.filter(([kind, event]) => kind === 'grace' && event.active).length, 1);
});
