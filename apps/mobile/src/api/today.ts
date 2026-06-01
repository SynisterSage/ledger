import type { TodayGroup } from '@/types/ledger';

import { mockWorkspaces } from './workspaces';

export const mockTodayGroups: TodayGroup[] = [
  {
    workspace: mockWorkspaces[0],
    items: [
      { id: 'alfa-1', title: 'Remote internship', meta: '11:00 AM' },
      { id: 'alfa-2', title: 'Submit hours', meta: '2:00 PM' },
    ],
  },
  {
    workspace: mockWorkspaces[1],
    items: [{ id: 'ledger-1', title: 'Review notification system', meta: 'Today' }],
  },
  {
    workspace: mockWorkspaces[2],
    items: [{ id: 'personal-1', title: 'Pick up prescription', meta: 'This afternoon' }],
  },
];

export function listTodayGroups() {
  return mockTodayGroups;
}
