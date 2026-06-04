import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ReminderForm } from '@/features/capture/ReminderForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function ReminderCaptureScreen() {
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Reminder</AppText>
      <ReminderForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
