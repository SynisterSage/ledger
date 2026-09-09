import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
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
              }}>
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
              ]}>
              Save reminders, tasks, events, and notes to the right workspace.
            </AppText>
          </View>

          <CapturePreview />
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

function CapturePreview() {
  const theme = useLedgerTheme();

  return (
    <View style={[styles.preview, { backgroundColor: theme.colors.surfaceCard, borderColor: theme.colors.borderSubtle }]}>
      <View style={styles.previewHeader}>
        <View style={[styles.previewDot, { backgroundColor: theme.colors.accent }]} />
        <AppText variant="caption" style={{ color: theme.colors.textPrimary }}>
          Today
        </AppText>
        <AppText variant="meta" style={{ color: theme.colors.textMuted, marginLeft: 'auto' }}>
          3 items
        </AppText>
      </View>
      <PreviewRow label="Review notification system" meta="Today" complete />
      <PreviewRow label="Pick up prescription" meta="This afternoon" />
      <PreviewRow label="Remote internship" meta="11:00 AM" />
    </View>
  );
}

function PreviewRow({ label, meta, complete = false }: { label: string; meta: string; complete?: boolean }) {
  const theme = useLedgerTheme();

  return (
    <View style={[styles.previewRow, { borderTopColor: theme.colors.borderSubtle }]}>
      <View style={[styles.check, { borderColor: complete ? theme.colors.accent : theme.colors.borderSubtle }]}>
        {complete ? <View style={[styles.checkFill, { backgroundColor: theme.colors.accent }]} /> : null}
      </View>
      <View style={styles.previewRowCopy}>
        <AppText variant="caption" numberOfLines={1} style={{ color: theme.colors.textPrimary }}>
          {label}
        </AppText>
        <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
          {meta}
        </AppText>
      </View>
    </View>
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
  preview: {
    width: '100%',
    maxWidth: 350,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkFill: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewRowCopy: {
    flex: 1,
    gap: 2,
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
