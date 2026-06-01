import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="screenTitle">Ledger</AppText>
          <AppText variant="bodyStrong">Your workspaces, wherever you remember things.</AppText>
          <AppText variant="body">
            Capture reminders, tasks, events, and notes from your phone, then see them back in Ledger on desktop.
          </AppText>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton title="Sign in" onPress={() => router.push('/auth/sign-in')} />
          <AppButton title="Create account" variant="secondary" onPress={() => router.push('/auth/sign-up')} />
        </View>
      </View>
    </Screen>
  );
}
