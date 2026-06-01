import { mobileRequest } from './client';

import type { MobileWorkspaceScopeOption, Workspace } from '@/types/ledger';

export const mockWorkspaces: Workspace[] = [
  { id: 'all', name: 'All Workspaces' },
  { id: 'alfa-summer-26', name: 'Alfa Summer 26' },
  { id: 'ledger', name: 'Ledger' },
  { id: 'personal', name: 'Personal' },
];

export const mockWorkspaceScopeOptions: MobileWorkspaceScopeOption[] = [
  { id: 'all', name: 'All Workspaces', type: 'scope' },
  {
    id: 'alfa-summer-26',
    name: 'Alfa Summer 26',
    subtitle: 'Personal workspace',
    type: 'workspace',
    role: 'owner',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    subtitle: 'App development',
    type: 'workspace',
    role: 'owner',
    isDefault: true,
  },
  {
    id: 'personal',
    name: 'Personal',
    subtitle: 'Personal workspace',
    type: 'personal',
    role: 'owner',
  },
];

type MobileWorkspacesResponse = {
  defaultWorkspaceId: string | null;
  scopeOptions: MobileWorkspaceScopeOption[];
};

export async function getMobileWorkspaces() {
  return mobileRequest<MobileWorkspacesResponse>('/api/mobile/workspaces');
}

export async function loadMobileWorkspaceScopeOptions() {
  const response = await getMobileWorkspaces();
  return response.scopeOptions?.length ? response.scopeOptions : mockWorkspaceScopeOptions;
}

export function listWorkspaces() {
  return mockWorkspaces;
}
