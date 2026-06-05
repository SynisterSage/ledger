import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ReminderForm } from '@/features/capture/ReminderForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function ReminderCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string | string[];
    dueAt?: string | string[];
    note?: string | string[];
    source?: string | string[];
  }>();

  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const dueAt = Array.isArray(params.dueAt) ? params.dueAt[0] : params.dueAt;
  const note = Array.isArray(params.note) ? params.note[0] : params.note;
  const source = Array.isArray(params.source) ? params.source[0] : params.source;
  const parsedDueAt = dueAt ? new Date(dueAt) : null;
  const formattedDate =
    parsedDueAt && !Number.isNaN(parsedDueAt.getTime())
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
    <Screen scroll>
      <AppText variant="screenTitle">Reminder</AppText>
      <ReminderForm
        initialTitle={title}
        initialDateInput={formattedDate}
        initialTimeInput={formattedTime}
        initialNotes={note}
        autoSubmit={source === 'siri'}
        onSave={() => router.replace('/(tabs)/capture')}
      />
    </Screen>
  );
}
