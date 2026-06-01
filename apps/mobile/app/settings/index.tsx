import { useRouter } from 'expo-router';
import { Alert, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Row } from '@/components/Row';
import { signOut } from '@/api/auth';
import { useLedgerTheme } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  async function handleSignOut() {
    Alert.alert('Log out', 'This will sign you out of Ledger Mobile.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            router.replace('/auth/welcome');
          } catch {
            Alert.alert('Unable to log out', 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle">Settings</AppText>
          <AppText variant="body">Temporary placeholder settings surface.</AppText>
        </View>

        <Row title="Default capture workspace" subtitle="Ledger" />
        <Row title="Notifications" subtitle="Managed later" />
        <Row title="Account" subtitle="Placeholder" />

        <AppButton title="Log out" variant="secondary" onPress={handleSignOut} />
        <AppButton title="Back to Today" onPress={() => router.push('/(tabs)/today')} />
      </View>
    </Screen>
  );
}
