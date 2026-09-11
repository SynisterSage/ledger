import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, TouchableWithoutFeedback, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

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
  const [showPassword, setShowPassword] = useState(false);
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
        // Enter the authenticated shell directly. Going through `/` adds the
        // index redirect as another native-stack transition, which can leave
        // the auth screen reachable with the iOS back-swipe gesture.
        router.replace('/(tabs)/today');
      } else {
        Alert.alert(
          'Check your inbox',
          'If verification is required, finish sign-in from your email first.'
        );
      }
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
          <AuthHeader title="Welcome back" subtitle="Sign in to keep today in view." align="left" />

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
              title="Sign in"
              variant="primary"
              size="lg"
              onPress={handleSignIn}
              disabled={isSubmitting}
            />
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
