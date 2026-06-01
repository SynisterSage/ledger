import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { NoteForm } from '@/features/capture/NoteForm';

export default function NoteCaptureScreen() {
  const router = useRouter();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Note</AppText>
      <NoteForm onSave={() => router.back()} />
    </Screen>
  );
}
