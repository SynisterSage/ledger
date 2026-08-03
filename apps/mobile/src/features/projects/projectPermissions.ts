import type { MobileWorkspaceScopeOption } from '@/types/ledger';

export type MobileProjectPermissions = {
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
  canAddAction: boolean;
  canAddMilestone: boolean;
  canAddNote: boolean;
  canArchive: boolean;
  canDelete: boolean;
  readOnly: boolean;
};

const viewerRoles = new Set(['viewer', 'read_only', 'readonly', 'guest']);
const adminRoles = new Set(['owner', 'admin']);

export function getMobileProjectPermissions(workspaceId: string, options: MobileWorkspaceScopeOption[]): MobileProjectPermissions {
  const workspace = options.find((option) => option.id === workspaceId);
  const role = String(workspace?.role ?? 'viewer').toLowerCase();
  const readOnly = workspaceId === 'all' || viewerRoles.has(role);
  const canEdit = !readOnly;
  return {
    canCreate: canEdit,
    canEdit,
    canChangeStatus: canEdit,
    canAddAction: canEdit,
    canAddMilestone: canEdit,
    canAddNote: canEdit,
    canArchive: canEdit,
    canDelete: !readOnly && adminRoles.has(role),
    readOnly,
  };
}
