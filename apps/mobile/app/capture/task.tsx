import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { TaskForm } from '@/features/capture/TaskForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

export default function TaskCaptureScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string | string[];
    dueDate?: string | string[];
    dueAt?: string | string[];
    notes?: string | string[];
    addToToday?: string | string[];
    source?: string | string[];
  }>();

  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const dueDate = Array.isArray(params.dueDate) ? params.dueDate[0] : params.dueDate;
  const dueAt = Array.isArray(params.dueAt) ? params.dueAt[0] : params.dueAt;
  const notes = Array.isArray(params.notes) ? params.notes[0] : params.notes;
  const addToToday = Array.isArray(params.addToToday) ? params.addToToday[0] : params.addToToday;
  const source = Array.isArray(params.source) ? params.source[0] : params.source;

  const parsedDueAt = dueAt ? new Date(dueAt) : null;
  const formattedDate =
    dueDate && dueDate.trim()
      ? dueDate.trim()
      : parsedDueAt && !Number.isNaN(parsedDueAt.getTime())
        ? parsedDueAt.toISOString().slice(0, 10)
        : undefined;
  const formattedTime =
    parsedDueAt && !Number.isNaN(parsedDueAt.getTime())
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsedDueAt)
      : undefined;

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Task" />
      <TaskForm
        initialTitle={title}
        initialDateInput={formattedDate}
        initialTimeInput={formattedTime}
        initialNotes={notes}
        initialShowInToday={addToToday === '1'}
        autoSubmit={source === 'siri'}
        onSave={() => router.replace('/(tabs)/capture')}
      />
    </Screen>
  );
}
