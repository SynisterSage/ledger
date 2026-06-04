import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { EventForm } from '@/features/capture/EventForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function EventCaptureScreen() {
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Event</AppText>
      <EventForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
