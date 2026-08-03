import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { ProjectActionForm } from '@/features/capture/ProjectActionForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

export default function ProjectActionCaptureScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; returnTo?: string; workspaceId?: string }>();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Project action" />
      <ProjectActionForm initialProjectId={params.projectId ?? null} initialWorkspaceId={params.workspaceId ?? null} onSave={() => router.replace((params.returnTo ?? '/(tabs)/capture') as never)} />
    </Screen>
  );
}
