import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { TaskForm } from '@/features/capture/TaskForm';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';

export default function TaskCaptureScreen() {
  const router = useRouter();

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Task</AppText>
      <TaskForm onSave={() => router.replace('/(tabs)/capture')} />
    </Screen>
  );
}
