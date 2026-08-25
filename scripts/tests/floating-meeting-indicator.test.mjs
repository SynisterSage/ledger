import test from 'node:test';
import assert from 'node:assert/strict';
import { FloatingMeetingIndicatorController } from '../../electron/floatingMeetingIndicator.ts';
import {
  activityFromLevel,
  clampIndicatorBounds,
  restoreIndicatorPosition,
  saveIndicatorPosition,
} from '../../electron/floatingMeetingIndicatorPosition.ts';
import { resolveFloatingMeetingIndicatorRenderer } from '../../electron/floatingMeetingIndicatorAssets.ts';
import { getFloatingMeetingIndicatorPlatformOptions } from '../../electron/floatingMeetingIndicatorPlatform.ts';

function harness() {
  const windows = [];
  const returned = [];
  const controller = new FloatingMeetingIndicatorController({
    create(onClick) {
      const win = { visible: false, destroyed: false, showedInactive: false, onClick, state: null,
        isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
        showInactive() { this.showedInactive = true; this.visible = true; }, hide() { this.visible = false; },
        sendState(state) { this.state = state; },
        close() { this.destroyed = true; this.visible = false; } };
      windows.push(win); return win;
    },
  }, (noteId) => returned.push(noteId));
  return { controller, windows, returned };
}

test('shows only for an unfocused active meeting recording', () => {
  const h = harness();
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].visible, true);
  h.controller.update({ recording: true, ledgerFocused: true, noteId: 'meeting-1' });
  assert.equal(h.windows[0].visible, false);
});

test('stops, normal notes, and missing identity never show', () => {
  const h = harness();
  for (const state of [
    { recording: false, ledgerFocused: false, noteId: 'meeting-1' },
    { recording: true, ledgerFocused: false, noteId: null },
  ]) h.controller.update(state);
  assert.equal(h.windows.length, 0);
});

test('reuses one indicator and click returns to the active note without focusing on show', () => {
  const h = harness();
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].showedInactive, true);
  h.windows[0].onClick();
  assert.deepEqual(h.returned, ['meeting-1']); assert.equal(h.windows[0].visible, false);
});

test('cleanup closes the indicator', () => {
  const h = harness();
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  h.controller.destroy();
  assert.equal(h.windows[0].destroyed, true);
});

test('activity reaches the indicator and pause/resume are represented without hiding it', () => {
  const h = harness();
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1', activity: activityFromLevel(.8) });
  assert.equal(h.windows[0].state.activity, 'high');
  h.controller.update({ recording: true, paused: true, ledgerFocused: false, noteId: 'meeting-1', activity: 'silent' });
  assert.deepEqual(h.windows[0].state, { recording: true, paused: true, activity: 'silent' });
  h.controller.update({ recording: true, paused: false, ledgerFocused: false, noteId: 'meeting-1', activity: 'medium' });
  assert.deepEqual(h.windows[0].state, { recording: true, paused: false, activity: 'medium' });
});

test('position is saved relatively and restored across work-area changes', () => {
  const display = { id: 'main', workArea: { x: 0, y: 0, width: 1000, height: 800 } };
  const saved = saveIndicatorPosition({ x: 500, y: 354, width: 50, height: 92 }, display);
  const restored = restoreIndicatorPosition(saved, { ...display, workArea: { x: 100, y: 20, width: 1400, height: 900 } }, { width: 50, height: 92 });
  assert.ok(restored.x > 700 && restored.x < 850);
  assert.ok(restored.y > 400 && restored.y < 450);
});

test('invalid or disconnected positions fall back and clamp fully inside a display', () => {
  const display = { id: 'fallback', workArea: { x: -400, y: 10, width: 500, height: 300 } };
  const restored = restoreIndicatorPosition({ displayId: 'gone', relativeX: 99, relativeY: -4 }, display, { width: 560, height: 400 });
  assert.deepEqual(restored, { x: -400, y: 10, width: 560, height: 400 });
  assert.deepEqual(clampIndicatorBounds({ x: 999, y: -999, width: 50, height: 50 }, display.workArea), { x: 50, y: 10, width: 50, height: 50 });
});

test('repeated focus and blur cycles never create duplicates or activate Ledger', () => {
  const h = harness();
  for (let index = 0; index < 4; index += 1) {
    h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
    h.controller.update({ recording: true, ledgerFocused: true, noteId: 'meeting-1' });
  }
  assert.equal(h.windows.length, 1);
  assert.equal(h.windows[0].showedInactive, true);
});

test('a destroyed indicator is recreated while recording continues', () => {
  const h = harness();
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  h.windows[0].destroyed = true;
  h.controller.update({ recording: true, ledgerFocused: false, noteId: 'meeting-1' });
  assert.equal(h.windows.length, 2);
  h.controller.update({ recording: false, ledgerFocused: false, noteId: 'meeting-1' });
  assert.equal(h.windows[1].visible, false);
});

test('platform options and packaged renderer paths stay lightweight and cross-platform', () => {
  const mac = getFloatingMeetingIndicatorPlatformOptions('darwin');
  const win = getFloatingMeetingIndicatorPlatformOptions('win32');
  assert.equal(mac.type, 'panel'); assert.equal(mac.visibleOnAllWorkspaces, true);
  assert.equal(mac.focusable, false); assert.equal(win.skipTaskbar, true); assert.equal(win.focusable, false);
  assert.equal(resolveFloatingMeetingIndicatorRenderer({ devServerUrl: 'http://localhost:5173/', rendererDist: '/dist' }), 'http://localhost:5173/floating-meeting-indicator.html');
  assert.equal(resolveFloatingMeetingIndicatorRenderer({ rendererDist: '/dist' }), '/dist/floating-meeting-indicator.html');
});
