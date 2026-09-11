import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AuthProductMockup } from '@/components/AuthProductMockup';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen contentStyle={{ paddingTop: 0 }} topFade={false}>
      <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
        <View style={{ alignItems: 'center', gap: theme.spacing['2xl'] }}>
          <View style={styles.brandRow}>
            <LogoMark width={44} height={44} />
            <AppText
              variant="title"
              style={{
                fontSize: 28,
                lineHeight: 32,
                fontWeight: '400',
                color: theme.colors.textPrimary,
              }}
            >
              Ledger
            </AppText>
          </View>

          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText variant="screenTitle" style={styles.headline}>
              Capture away{'\n'}from your desk
            </AppText>
            <AppText
              variant="body"
              style={[
                styles.copy,
                {
                  color: theme.colors.textSecondary,
                },
              ]}
            >
              Save reminders, tasks, events, and notes to the right workspace.
            </AppText>
          </View>

          <AuthProductMockup height={Math.min(Math.max(theme.spacing['3xl'] * 10, 292), 360)} />
        </View>

        <View style={styles.actionsRow}>
          <View style={styles.actionColumn}>
            <AppButton
              title="Sign In"
              variant="secondary"
              size="lg"
              onPress={() => router.push('/auth/sign-in')}
            />
          </View>
          <View style={styles.actionColumn}>
            <AppButton
              title="Get Started"
              variant="primary"
              size="lg"
              onPress={() => router.push('/auth/sign-up')}
            />
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headline: {
    maxWidth: 360,
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '400',
    letterSpacing: -0.6,
  },
  copy: {
    maxWidth: 310,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 8,
  },
  actionColumn: {
    flex: 1,
  },
});
