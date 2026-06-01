import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { TaskForm } from '@/features/capture/TaskForm';

export default function TaskCaptureScreen() {
  const router = useRouter();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Task</AppText>
      <TaskForm onSave={() => router.back()} />
    </Screen>
  );
}
