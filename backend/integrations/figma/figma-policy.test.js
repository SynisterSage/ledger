import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFigmaCapability, getFigmaCapabilityMinimumRole } from './figma-policy.js';

test('Figma policy separates viewing, editing, and connection management', () => {
  assert.equal(getFigmaCapabilityMinimumRole('manage_connection'), 'admin');
  assert.equal(getFigmaCapabilityMinimumRole('delete_workspace_figma_data'), 'owner');
  assert.doesNotThrow(() => assertFigmaCapability({ capability: 'view_saved_preview', workspaceRole: 'viewer', targetExists: true }));
  assert.throws(() => assertFigmaCapability({ capability: 'refresh_preview', workspaceRole: 'viewer', targetExists: true, targetEditable: false }), /permission/);
  assert.throws(() => assertFigmaCapability({ capability: 'manage_connection', workspaceRole: 'member' }), /permission/);
  assert.doesNotThrow(() => assertFigmaCapability({ capability: 'manage_connection', workspaceRole: 'admin' }));
});

test('workspace data removal capability requires the owner', () => {
  assert.throws(() => assertFigmaCapability({ capability: 'delete_workspace_figma_data', workspaceRole: 'admin' }), /owner/);
  assert.doesNotThrow(() => assertFigmaCapability({ capability: 'delete_workspace_figma_data', workspaceRole: 'owner' }));
});
