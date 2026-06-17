import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, TouchableWithoutFeedback, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { AuthHeader } from '@/components/AuthHeader';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { signUpWithEmail } from '@/api/auth';
import { useLedgerTheme } from '@/theme';
import { validatePasswordRequirements } from '@/utils/passwordPolicy';

export default function SignUpScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    if (!name.trim() || !email.trim() || !password) {
      setError('Enter your name, email, and password.');
      return;
    }

    const passwordError = validatePasswordRequirements(password);
    if (passwordError) {
      setError(passwordError);
      Alert.alert('Password requirements', passwordError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const session = await signUpWithEmail(email.trim(), password, name.trim());

      if (session) {
        router.replace('/');
      } else {
        Alert.alert('Check your email', 'If confirmation is enabled, finish creating your account from the email Ledger sent.');
        router.replace('/auth/sign-in');
      }
    } catch (signUpError) {
      const message =
        signUpError instanceof Error ? signUpError.message : 'Unable to create account.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
          <AuthHeader title="Create Your Account" />

          <View style={styles.form}>
            <AppTextInput
              label="Name"
              placeholder="John Doe"
              autoCapitalize="words"
              value={name}
              onChangeText={setName}
            />
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
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              rightAccessory={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPassword((value) => !value)}
                  hitSlop={8}
                  style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                  {showPassword ? (
                    <EyeOff size={18} color={theme.colors.textMuted} />
                  ) : (
                    <Eye size={18} color={theme.colors.textMuted} />
                  )}
                </Pressable>
              }
            />
            {error ? <AppText variant="caption">{error}</AppText> : null}
          </View>

          <View style={styles.actions}>
            <AppButton title="Create Account" variant="primary" size="lg" onPress={handleSignUp} disabled={isSubmitting} />
            <View style={styles.footerRow}>
              <AppText variant="body" style={{ color: theme.colors.textMuted }}>
                Already have an account?{' '}
              </AppText>
              <Pressable onPress={() => router.push('/auth/sign-in')}>
                <AppText variant="body" style={{ color: theme.colors.accent }}>
                  Sign in
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
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
    marginBottom: 80,
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
