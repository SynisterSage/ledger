import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveZoomAccessibilityBridgePath } from './speakerTagsRuntime.ts';

test('resolves the packaged helper beside Electron resources', () => {
  assert.equal(resolveZoomAccessibilityBridgePath({ isPackaged: true, resourcesPath: '/Ledger.app/Contents/Resources', appPath: '/workspace' }), '/Ledger.app/Contents/Resources/ZoomAccessibilityBridge');
});

test('resolves the development helper from the native workspace directory', () => {
  assert.equal(resolveZoomAccessibilityBridgePath({ isPackaged: false, resourcesPath: '/unused', appPath: '/workspace' }), '/workspace/native/ZoomAccessibilityBridge');
});
