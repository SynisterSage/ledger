import type { CaptureOption } from '@/types/ledger';

export const mockCaptureOptions: CaptureOption[] = [
  { id: 'reminder', title: 'Reminder', subtitle: 'Quick reminder for later', href: '/capture/reminder' },
  { id: 'task', title: 'Task', subtitle: 'A simple action to complete', href: '/capture/task' },
  { id: 'event', title: 'Event', subtitle: 'A time-bound calendar item', href: '/capture/event' },
  { id: 'note', title: 'Note', subtitle: 'Save a thought or detail', href: '/capture/note' },
  { id: 'project-action', title: 'Project action', subtitle: 'Add a next step to a project', href: '/capture/project-action' },
];

export function listCaptureOptions() {
  return mockCaptureOptions;
}
