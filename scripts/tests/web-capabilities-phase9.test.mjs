import assert from 'node:assert/strict';
import { test } from 'node:test';

test('browser platform exposes explicit native and browser capability fallbacks', async () => {
  globalThis.window = {
    location: { href: 'http://localhost:5173/app' },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
    dispatchEvent() {},
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } } });
  const { createWebPlatform } = await import('../../src/platform/web/webPlatform.ts');
  const platform = createWebPlatform();
  assert.equal(platform.capabilities.canUseNativeMaterial, false);
  assert.equal(platform.capabilities.canUseNativeWindowControls, false);
  assert.equal(platform.capabilities.canCaptureSystemAudio, false);
  assert.equal(platform.capabilities.canOpenSystemSettings, false);
  assert.equal((await platform.meetingAudio.getCapabilities()).systemAudio, false);
});

test('notification permission is intent-driven and unsupported browsers are safe', async () => {
  const { createWebPlatform } = await import('../../src/platform/web/webPlatform.ts');
  const platform = createWebPlatform();
  assert.ok(['unsupported', 'default', 'granted', 'denied'].includes(platform.notifications.getPermission()));
  assert.equal(await platform.notifications.show('Ledger test'), false);
});

test('Settings and Meeting Notes use capability-aware browser fallbacks', async () => {
  const fs = await import('node:fs/promises');
  const settings = await fs.readFile(new URL('../../src/components/Settings/SettingsWindow.tsx', import.meta.url), 'utf8');
  const notes = await fs.readFile(new URL('../../src/components/Notes/NotesWindow.tsx', import.meta.url), 'utf8');
  assert.match(settings, /canUseNativeMaterial/);
  assert.match(settings, /canUseNativeWindowControls/);
  assert.match(settings, /notifications\.requestPermission/);
  assert.match(notes, /meetingAudio\.requestMicrophone/);
  assert.match(notes, /native recording and system-audio capture require the desktop app/);
});

test('desktop platform preserves native capability defaults', async () => {
  const { createDesktopPlatform } = await import('../../src/platform/desktop/desktopPlatform.ts');
  const platform = createDesktopPlatform();
  assert.equal(platform.capabilities.canUseNativeMaterial, true);
  assert.equal(platform.capabilities.canUseNativeWindowControls, true);
  assert.equal(platform.capabilities.canCaptureSystemAudio, true);
  assert.equal(platform.capabilities.canRestartApp, true);
});
