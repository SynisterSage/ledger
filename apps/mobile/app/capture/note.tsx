import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { NoteForm } from '@/features/capture/NoteForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function NoteCaptureScreen() {
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Note</AppText>
      <NoteForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
