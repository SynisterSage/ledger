import { Stack } from 'expo-router';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useLedgerTheme } from '@/theme';

export default function RootLayout() {
  const theme = useLedgerTheme();

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />
    </SafeAreaProvider>
  );
}
