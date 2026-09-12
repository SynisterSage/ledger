import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AuthProductMockup } from '@/components/AuthProductMockup';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();

  const openLegalLink = (path: 'privacy' | 'terms') => {
    void WebBrowser.openBrowserAsync(`https://ledgerworkspace.com/${path}`, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
    });
  };

  return (
    <Screen contentStyle={{ paddingTop: 0 }} topFade={false}>
      <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
        <View
          style={{
            alignItems: 'center',
            gap: theme.spacing['2xl'],
            paddingTop: theme.spacing.xl,
          }}
        >
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

          <AuthProductMockup height={Math.min(Math.max(windowHeight * 0.46, 340), 520)} bleed />
        </View>

        <View style={styles.actionsGroup}>
        <View
          style={[
            styles.actionsSheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.borderSubtle,
              marginHorizontal: theme.spacing.sheetInset,
              marginBottom: theme.spacing.xs,
              borderRadius: theme.radius.sheet,
            },
          ]}
        >
          <View style={styles.actionsRow}>
            <View style={styles.actionColumn}>
              <AppButton
                title="Sign in"
                variant="secondary"
                size="lg"
                onPress={() => router.push('/auth/sign-in')}
              />
            </View>
            <View style={styles.actionColumn}>
              <AppButton
                title="Get started"
                variant="primary"
                size="lg"
                onPress={() => router.push('/auth/sign-up')}
              />
            </View>
          </View>
        </View>
        <View style={styles.legalRow}>
            <Pressable onPress={() => openLegalLink('privacy')} hitSlop={8}>
              <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                Privacy policy
              </AppText>
            </Pressable>
            <AppText variant="meta" style={{ color: theme.colors.borderSubtle }}>
              ·
            </AppText>
            <Pressable onPress={() => openLegalLink('terms')} hitSlop={8}>
              <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                Terms
              </AppText>
            </Pressable>
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
  actionsGroup: {
    width: '100%',
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
  actionsSheet: {
    gap: 8,
    padding: 10,
    borderWidth: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionColumn: {
    flex: 1,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
  },
});
