import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { signUpWithEmail } from '@/api/auth';
import { useLedgerTheme } from '@/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    if (!name.trim() || !email.trim() || !password) {
      setError('Enter your name, email, and password.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const session = await signUpWithEmail(email.trim(), password, name.trim());

      if (session) {
        router.replace('/onboarding/default-workspace');
      } else {
        Alert.alert('Check your email', 'If confirmation is enabled, finish creating your account from the email Ledger sent.');
        router.replace('/auth/sign-in');
      }
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : 'Unable to create account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="screenTitle">Create account</AppText>
          <AppText variant="body">Set up access for your Ledger workspaces.</AppText>
        </View>

        <View style={{ gap: theme.spacing.lg }}>
          <AppTextInput label="Name" placeholder="Lex" autoCapitalize="words" value={name} onChangeText={setName} />
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
          <AppButton title="Create account" onPress={handleSignUp} disabled={isSubmitting} />
          <Link href="/auth/sign-in" style={{ color: theme.colors.accent }}>
            Sign in
          </Link>
        </View>
      </View>
    </Screen>
  );
}
