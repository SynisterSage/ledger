import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function NotificationsOnboardingScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle">Notifications</AppText>
          <AppText variant="body">Let Ledger remind you about what needs attention.</AppText>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton title="Enable notifications" onPress={() => router.push('/(tabs)/today')} />
          <AppButton title="Not now" variant="secondary" onPress={() => router.push('/(tabs)/today')} />
        </View>
      </View>
    </Screen>
  );
}
