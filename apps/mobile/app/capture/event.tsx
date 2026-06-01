import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { EventForm } from '@/features/capture/EventForm';

export default function EventCaptureScreen() {
  const router = useRouter();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Event</AppText>
      <EventForm onSave={() => router.back()} />
    </Screen>
  );
}
