type CalendarDataListener = (workspaceId: string) => void;

const listeners = new Set<CalendarDataListener>();

export function subscribeCalendarDataChanges(listener: CalendarDataListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCalendarDataChanged(workspaceId: string) {
  listeners.forEach((listener) => listener(workspaceId));
}
