import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { ProjectActionForm } from '@/features/capture/ProjectActionForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

export default function ProjectActionCaptureScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <CaptureHeader title="Project action" />
      <ProjectActionForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
