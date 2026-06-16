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
  const isSiri = source === 'siri';
  const saveDestination = isSiri ? '/(tabs)/today' : '/(tabs)/capture';
  const formKey = isSiri ? ['siri-note', title ?? '', body ?? ''].join(':') : 'manual-note';

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Note" />
      <NoteForm
        key={formKey}
        initialTitle={title}
        initialBody={body}
        onSave={() => router.replace(saveDestination)}
      />
    </Screen>
  );
}
