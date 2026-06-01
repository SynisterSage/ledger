import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="screenTitle">Sign in</AppText>
          <AppText variant="body">Use your Ledger account to access your workspaces.</AppText>
        </View>

        <View style={{ gap: theme.spacing.lg }}>
          <AppTextInput label="Email" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <AppTextInput label="Password" placeholder="••••••••" secureTextEntry />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton title="Sign in" onPress={() => router.push('/onboarding/default-workspace')} />
          <Link href="/auth/sign-up" style={{ color: theme.colors.accent }}>
            Create account
          </Link>
        </View>
      </View>
    </Screen>
  );
}
