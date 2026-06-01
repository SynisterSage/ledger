import type { NotificationItem } from '@/types/ledger';

import { mockWorkspaces } from './workspaces';

export const mockNotifications: NotificationItem[] = [
  {
    id: 'notify-1',
    title: 'Reminder due',
    workspace: mockWorkspaces[1],
    meta: 'Due now · Submit hours',
    actions: ['Complete', 'Snooze', 'Open', 'Dismiss'],
  },
  {
    id: 'notify-2',
    title: 'Event soon',
    workspace: mockWorkspaces[0],
    meta: 'Starts in 30 min · Remote internship',
    actions: ['Open', 'Snooze', 'Dismiss'],
  },
  {
    id: 'notify-3',
    title: 'Task overdue',
    workspace: mockWorkspaces[2],
    meta: 'Overdue · Pick up prescription',
    actions: ['Complete', 'Open', 'Dismiss'],
  },
];

export function listNotifications() {
  return mockNotifications;
}
