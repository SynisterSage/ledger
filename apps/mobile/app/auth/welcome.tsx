import { useRouter } from 'expo-router';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const { width, height } = useWindowDimensions();
  const heroWidth = Math.min(width * 1.18, 430);
  const heroStageHeight = Math.min(height * 0.52, 390);
  const heroStageWidth = width + theme.spacing.lg * 2;

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
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

          <View
            style={[
              styles.heroStage,
              {
                height: heroStageHeight,
                width: heroStageWidth,
                marginHorizontal: -theme.spacing.lg,
                marginTop: -4,
              },
            ]}>
            <Image
              source={require('../../assets/images/welcome.png')}
              resizeMode="contain"
              style={[
                styles.heroImage,
                {
                  width: heroWidth,
                  aspectRatio: 402 / 661,
                  right: -12,
                },
              ]}
            />
          </View>
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
  heroStage: {
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    position: 'absolute',
    top: -24,
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
