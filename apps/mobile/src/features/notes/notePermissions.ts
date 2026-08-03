import type { MobileWorkspaceScopeOption } from '@/types/ledger';

export type MobileNotePermissions = {
  canCreate: boolean;
  canEdit: boolean;
  canRename: boolean;
  canMove: boolean;
  canCreateChild: boolean;
  canPin: boolean;
  canDuplicate: boolean;
  canLinkProject: boolean;
  canEditTranscript: boolean;
  canEditMindMap: boolean;
  canDelete: boolean;
  canManageSections: boolean;
};

const READ_ONLY: MobileNotePermissions = {
  canCreate: false, canEdit: false, canRename: false, canMove: false,
  canCreateChild: false, canPin: false, canDuplicate: false, canLinkProject: false,
  canEditTranscript: false, canEditMindMap: false, canDelete: false, canManageSections: false,
};

export function getMobileNotePermissions(option?: MobileWorkspaceScopeOption | null): MobileNotePermissions {
  const role = String(option?.role ?? 'member').toLowerCase();
  if (role === 'viewer') return READ_ONLY;
  const canManageSections = role === 'owner' || role === 'admin';
  return {
    canCreate: true, canEdit: true, canRename: true, canMove: true, canCreateChild: true,
    canPin: true, canDuplicate: true, canLinkProject: true, canEditTranscript: true,
    canEditMindMap: true, canDelete: true, canManageSections,
  };
}
