import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="screenTitle">Create account</AppText>
          <AppText variant="body">Set up access for your Ledger workspaces.</AppText>
        </View>

        <View style={{ gap: theme.spacing.lg }}>
          <AppTextInput label="Name" placeholder="Lex" autoCapitalize="words" />
          <AppTextInput label="Email" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <AppTextInput label="Password" placeholder="••••••••" secureTextEntry />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton title="Create account" onPress={() => router.push('/onboarding/default-workspace')} />
          <Link href="/auth/sign-in" style={{ color: theme.colors.accent }}>
            Sign in
          </Link>
        </View>
      </View>
    </Screen>
  );
}
