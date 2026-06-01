import { Stack } from 'expo-router';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeAuth } from '@/api/auth';
import { useLedgerTheme } from '@/theme';

export default function RootLayout() {
  const theme = useLedgerTheme();

  useEffect(() => {
    void initializeAuth();
  }, []);

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
