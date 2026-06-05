import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { NoteForm } from '@/features/capture/NoteForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function NoteCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string | string[];
    body?: string | string[];
    source?: string | string[];
  }>();

  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const body = Array.isArray(params.body) ? params.body[0] : params.body;
  const source = Array.isArray(params.source) ? params.source[0] : params.source;

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Note</AppText>
      <NoteForm
        initialTitle={title}
        initialBody={body}
        autoSubmit={source === 'siri'}
        onSave={() => router.replace('/(tabs)/capture')}
      />
    </Screen>
  );
}
