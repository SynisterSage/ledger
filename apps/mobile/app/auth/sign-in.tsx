import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AuthHeader } from '@/components/AuthHeader';
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
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
        <AuthHeader title="Welcome Back" />

        <View style={styles.form}>
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

        <View style={styles.actions}>
          <AppButton title="Sign In" variant="primary" size="lg" onPress={handleSignIn} disabled={isSubmitting} />
          <View style={styles.footerRow}>
            <AppText variant="body" style={{ color: theme.colors.textMuted }}>
              New to Ledger?{' '}
            </AppText>
            <Pressable onPress={() => router.push('/auth/sign-up')}>
              <AppText variant="body" style={{ color: theme.colors.accent }}>
                Create account
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = {
  container: {
    flex: 1,
    justifyContent: 'space-between' as const,
  },
  form: {
    gap: 20,
    marginTop: 0,
    marginBottom: 170,
  },
  actions: {
    gap: 14,
  },
  footerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
  },
};
