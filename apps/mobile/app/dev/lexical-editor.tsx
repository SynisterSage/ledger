import { Redirect } from 'expo-router';

import { LexicalCompatibilityScreen } from '@/features/dev/LexicalCompatibilityScreen';

export default function LexicalEditorDevRoute() {
  if (!__DEV__) return <Redirect href="/(tabs)/today" />;
  return <LexicalCompatibilityScreen />;
}
