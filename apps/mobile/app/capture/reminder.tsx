import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ReminderForm } from '@/features/capture/ReminderForm';

export default function ReminderCaptureScreen() {
  const router = useRouter();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Reminder</AppText>
      <ReminderForm onSave={() => router.back()} />
    </Screen>
  );
}
