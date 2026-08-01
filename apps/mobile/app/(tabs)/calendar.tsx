import { useEffect } from 'react';
import { CalendarShell } from '@/features/calendar/CalendarShell';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function CalendarScreen() {
  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return <CalendarShell />;
}
