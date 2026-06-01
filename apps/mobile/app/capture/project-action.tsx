import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { ProjectActionForm } from '@/features/capture/ProjectActionForm';

export default function ProjectActionCaptureScreen() {
  const router = useRouter();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Project action</AppText>
      <ProjectActionForm onSave={() => router.back()} />
    </Screen>
  );
}
