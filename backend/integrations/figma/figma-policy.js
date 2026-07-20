export const FIGMA_CAPABILITIES = Object.freeze([
  'view_reference',
  'view_saved_preview',
  'open_external_url',
  'link_reference',
  'embed_reference',
  'refresh_preview',
  'remove_embed',
  'unlink_reference',
  'delete_saved_preview',
  'manage_connection',
  'delete_workspace_figma_data',
]);

const workspaceMinimumRole = Object.freeze({
  manage_connection: 'admin',
  delete_workspace_figma_data: 'owner',
});

export const isFigmaCapability = (value) => FIGMA_CAPABILITIES.includes(String(value ?? ''));

export const getFigmaCapabilityMinimumRole = (capability) => workspaceMinimumRole[capability] ?? null;

export const assertFigmaCapability = ({ capability, workspaceRole, targetExists = true, targetEditable = false }) => {
  if (!isFigmaCapability(capability)) {
    const error = new Error('Unsupported Figma capability');
    error.statusCode = 400;
    throw error;
  }
  if (!targetExists) {
    const error = new Error('Target object not found');
    error.statusCode = 404;
    throw error;
  }
  if (capability === 'manage_connection' && !['owner', 'admin'].includes(String(workspaceRole).toLowerCase())) {
    const error = new Error('You don’t have permission to manage the Figma connection.');
    error.statusCode = 403;
    throw error;
  }
  if (capability === 'delete_workspace_figma_data' && String(workspaceRole).toLowerCase() !== 'owner') {
    const error = new Error('Only the workspace owner can remove stored Figma data.');
    error.statusCode = 403;
    throw error;
  }
  if (['link_reference', 'embed_reference', 'refresh_preview', 'remove_embed', 'unlink_reference', 'delete_saved_preview'].includes(capability) && !targetEditable) {
    const error = new Error('You don’t have permission to modify this Ledger item.');
    error.statusCode = 403;
    throw error;
  }
  return true;
};
