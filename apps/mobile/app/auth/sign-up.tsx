import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, TouchableWithoutFeedback, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { AuthHeader } from '@/components/AuthHeader';
import { AuthProductMockup } from '@/components/AuthProductMockup';
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
        router.replace('/(tabs)/today');
      } else {
        Alert.alert(
          'Check your email',
          'If confirmation is enabled, finish creating your account from the email Ledger sent.'
        );
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
          <AuthHeader
            title="Create your account"
            subtitle="Start with a clear view of what matters."
            align="left"
          />

          <AuthProductMockup height={164} />

          <View style={styles.form}>
            <View
              style={[
                styles.inputCard,
                {
                  backgroundColor: theme.colors.surfaceCard,
                  borderColor: theme.colors.borderSubtle,
                  borderRadius: theme.radius.surface,
                },
              ]}
            >
              <View style={styles.inputField}>
                <AppTextInput
                  label="Name"
                  placeholder="Your name"
                  autoCapitalize="words"
                  value={name}
                  onChangeText={setName}
                  style={styles.cardInput}
                />
              </View>
              <View style={[styles.inputDivider, { backgroundColor: theme.colors.borderSubtle }]} />
              <View style={styles.inputField}>
                <AppTextInput
                  label="Email"
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  style={styles.cardInput}
                />
              </View>
              <View style={[styles.inputDivider, { backgroundColor: theme.colors.borderSubtle }]} />
              <View style={styles.inputField}>
                <AppTextInput
                  label="Password"
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  style={styles.cardInput}
                  rightAccessory={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      onPress={() => setShowPassword((value) => !value)}
                      hitSlop={8}
                      style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                    >
                      {showPassword ? (
                        <EyeOff size={18} color={theme.colors.textMuted} />
                      ) : (
                        <Eye size={18} color={theme.colors.textMuted} />
                      )}
                    </Pressable>
                  }
                />
              </View>
            </View>
            {error ? <AppText variant="caption">{error}</AppText> : null}
          </View>

          <View style={styles.actions}>
            <AppButton
              title="Create account"
              variant="primary"
              size="lg"
              onPress={handleSignUp}
              disabled={isSubmitting}
            />
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
  },
  form: {
    gap: 12,
    marginTop: 32,
  },
  inputCard: {
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  inputField: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputDivider: {
    height: 1,
    marginLeft: 16,
  },
  cardInput: {
    borderBottomWidth: 0,
  },
  actions: {
    gap: 14,
    marginTop: 'auto' as const,
  },
  footerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
  },
};
