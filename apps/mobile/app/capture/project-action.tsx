import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ProjectActionForm } from '@/features/capture/ProjectActionForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function ProjectActionCaptureScreen() {
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Project action</AppText>
      <ProjectActionForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
