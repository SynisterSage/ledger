import type { Workspace } from '@/types/ledger';

export const mockWorkspaces: Workspace[] = [
  { id: 'alfa-summer-26', name: 'Alfa Summer 26' },
  { id: 'ledger', name: 'Ledger', isDefault: true },
  { id: 'personal', name: 'Personal' },
];

export function listWorkspaces() {
  return mockWorkspaces;
}
