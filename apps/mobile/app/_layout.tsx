import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { Animated, Easing, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeAuth } from '@/api/auth';
import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { useAuthState } from '@/store/sessionStore';
import { resetBootState, setBootState, useBootState } from '@/store/bootStore';
import { useLedgerTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 220, fade: true });

const MIN_SPLASH_MS = 900;

export default function RootLayout() {
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const boot = useBootState();
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const [showOverlay, setShowOverlay] = useState(true);

  useEffect(() => {
    resetBootState();
    setBootState({
      isBooting: true,
      hasHydratedSession: false,
      minimumSplashElapsed: false,
      isBootReady: false,
    });

    let cancelled = false;
    const minTimer = setTimeout(() => {
      if (cancelled) {
        return;
      }

      setBootState({ minimumSplashElapsed: true });
      void SplashScreen.hideAsync();
    }, MIN_SPLASH_MS);

    void initializeAuth();

    return () => {
      cancelled = true;
      clearTimeout(minTimer);
    };
  }, []);

  useEffect(() => {
    if (auth.isLoading) {
      return;
    }

    setBootState({ hasHydratedSession: true });

    if (!boot.minimumSplashElapsed || boot.isBootReady) {
      return;
    }

    setBootState({
      isBooting: false,
      isBootReady: true,
    });
  }, [auth.isLoading, boot.minimumSplashElapsed, boot.isBootReady]);

  useEffect(() => {
    if (!boot.isBootReady || !showOverlay) {
      return;
    }

    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowOverlay(false);
      }
    });
  }, [boot.isBootReady, overlayOpacity, showOverlay]);

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />
      {showOverlay ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: overlayOpacity,
            },
          ]}>
          <AppLoadingScreen />
        </Animated.View>
      ) : null}
    </SafeAreaProvider>
  );
}
