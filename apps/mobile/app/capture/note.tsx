import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { NoteForm } from '@/features/capture/NoteForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

export default function NoteCaptureScreen() {
  const theme = useLedgerTheme();
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
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Note" />
      <NoteForm
        initialTitle={title}
        initialBody={body}
        autoSubmit={source === 'siri'}
        onSave={() => router.replace('/(tabs)/capture')}
      />
    </Screen>
  );
}
