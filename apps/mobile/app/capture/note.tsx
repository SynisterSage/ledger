import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { NoteForm } from '@/features/capture/NoteForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { openMobileNote } from '@/features/notes/openMobileNote';

export default function NoteCaptureScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string | string[];
    body?: string | string[];
    source?: string | string[];
    projectId?: string | string[];
    workspaceId?: string | string[];
  }>();

  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const body = Array.isArray(params.body) ? params.body[0] : params.body;
  const source = Array.isArray(params.source) ? params.source[0] : params.source;
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const workspaceId = Array.isArray(params.workspaceId) ? params.workspaceId[0] : params.workspaceId;
  const isSiri = source === 'siri';
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
        projectId={projectId}
        initialWorkspaceId={workspaceId}
        onSave={(noteId) => openMobileNote(router, noteId, { workspaceId: workspaceId ?? undefined, returnTo: isSiri ? '/(tabs)/today' : '/(tabs)/capture', focus: 'title' })}
      />
    </Screen>
  );
}
