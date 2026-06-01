import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { signInWithEmail } from '@/api/auth';
import { useLedgerTheme } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const session = await signInWithEmail(email.trim(), password);

      if (session) {
        router.replace('/onboarding/default-workspace');
      } else {
        Alert.alert('Check your inbox', 'If verification is required, finish sign-in from your email first.');
      }
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="screenTitle">Sign in</AppText>
          <AppText variant="body">Use your Ledger account to access your workspaces.</AppText>
        </View>

        <View style={{ gap: theme.spacing.lg }}>
          <AppTextInput
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <AppTextInput
            label="Password"
            placeholder="••••••••"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <AppText variant="caption">{error}</AppText> : null}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton title="Sign in" onPress={handleSignIn} disabled={isSubmitting} />
          <Link href="/auth/sign-up" style={{ color: theme.colors.accent }}>
            Create account
          </Link>
        </View>
      </View>
    </Screen>
  );
}
