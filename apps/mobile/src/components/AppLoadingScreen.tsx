import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

import SplashIcon from '../../assets/images/splash-icon.png';

import { AppText } from '@/components/AppText';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

type AppLoadingScreenProps = {
  exiting?: boolean;
  onReady?: () => void;
  onExitComplete?: () => void;
};

export function AppLoadingScreen({ exiting = false, onReady, onExitComplete }: AppLoadingScreenProps) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const opacity = useRef(new Animated.Value(1)).current;
  const contentTranslateY = useRef(new Animated.Value(0)).current;
  const contentScale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotionEnabled) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotionEnabled]);

  useEffect(() => {
    if (!exiting) return;

    if (reduceMotionEnabled) {
      onExitComplete?.();
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentTranslateY, {
        toValue: -10,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentScale, {
        toValue: 0.97,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onExitComplete?.();
    });
  }, [contentScale, contentTranslateY, exiting, onExitComplete, opacity, reduceMotionEnabled]);

  const markScale = reduceMotionEnabled
    ? 1
    : pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.035],
      });

  const markOpacity = reduceMotionEnabled
    ? 1
    : pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.86, 1],
      });

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onReady}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          opacity,
        },
      ]}>
      <Animated.View
        style={[
          styles.content,
          {
            transform: [{ translateY: contentTranslateY }, { scale: contentScale }],
          },
        ]}>
        <Animated.View
          style={[
            styles.brandRow,
            {
              transform: [{ scale: markScale }],
              opacity: markOpacity,
            },
          ]}>
          <Image source={SplashIcon} style={styles.icon} resizeMode="contain" />
          <AppText
            variant="title"
            style={{
              color: theme.colors.textPrimary,
              fontWeight: '500',
              letterSpacing: 0,
            }}>
            Ledger
          </AppText>
        </Animated.View>
      </Animated.View>

      <View style={styles.footer}>
        <AppText
          variant="meta"
          style={{
            color: theme.colors.textMuted,
          }}>
          Preparing your workspace
        </AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  icon: {
    width: 56,
    height: 56,
  },
  footer: {
    bottom: 54,
    left: 0,
    position: 'absolute',
    right: 0,
    alignItems: 'center',
  },
});
