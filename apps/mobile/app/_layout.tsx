import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeAuth } from '@/api/auth';
import { registerCurrentMobilePushToken, revokeCurrentMobilePushToken } from '@/api/pushNotifications';
import { getMobileUserSettings, readMobileNotificationPreferences } from '@/api/userSettings';
import { bootstrapAppPreferencesState, resetAppPreferencesState } from '@/store/appPreferencesStore';
import { useAuthState } from '@/store/sessionStore';
import { resetBootState, setBootState, useBootState } from '@/store/bootStore';
import { bootstrapNotificationOnboardingState, useNotificationOnboardingState } from '@/store/notificationOnboardingStore';
import { useLedgerTheme } from '@/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

const MIN_SPLASH_MS = 900;

export default function RootLayout() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const notificationOnboarding = useNotificationOnboardingState();
  const boot = useBootState();
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const [mobilePushHydrated, setMobilePushHydrated] = useState(false);
  const [mobilePushEnabled, setMobilePushEnabled] = useState<boolean | null>(null);
  const handledNotificationResponseIdRef = useRef<string | null>(null);

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
    }, MIN_SPLASH_MS);

    void initializeAuth();

    return () => {
      cancelled = true;
      clearTimeout(minTimer);
    };
  }, []);

  useEffect(() => {
    void bootstrapNotificationOnboardingState(auth.user?.id ?? null);
  }, [auth.user?.id]);

  useEffect(() => {
    if (!auth.user?.id) {
      resetAppPreferencesState();
      return;
    }

    void bootstrapAppPreferencesState(auth.user.id);
  }, [auth.user?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadPushPreference = async () => {
      setMobilePushHydrated(false);

      if (!auth.user?.id) {
        setMobilePushEnabled(false);
        setMobilePushHydrated(true);
        return;
      }

      try {
        const settings = await getMobileUserSettings();
        if (cancelled) return;
        setMobilePushEnabled(readMobileNotificationPreferences(settings).pushNotifications);
      } catch {
        if (!cancelled) {
          setMobilePushEnabled(null);
        }
      } finally {
        if (!cancelled) {
          setMobilePushHydrated(true);
        }
      }
    };

    void loadPushPreference();

    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  useEffect(() => {
    const notificationStateReady =
      !auth.session ||
      (notificationOnboarding.userId === auth.user?.id &&
        notificationOnboarding.isHydrated &&
        !notificationOnboarding.isLoading);

    if (auth.isLoading || notificationOnboarding.isLoading || !notificationStateReady) {
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
  }, [
    auth.isLoading,
    auth.session,
    auth.user?.id,
    boot.minimumSplashElapsed,
    boot.isBootReady,
    notificationOnboarding.isHydrated,
    notificationOnboarding.isLoading,
    notificationOnboarding.userId,
  ]);

  useEffect(() => {
    if (!boot.isBootReady) {
      return;
    }

    void SplashScreen.hideAsync();
  }, [boot.isBootReady]);

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const notificationId = typeof data?.notificationId === 'string' ? data.notificationId : null;
      const route = typeof data?.route === 'string' ? data.route : '/(tabs)/notifications';
      const routeParams = (data?.routeParams && typeof data.routeParams === 'object' ? data.routeParams : null) as
        | Record<string, unknown>
        | null;

      if (notificationId && handledNotificationResponseIdRef.current === notificationId) {
        return;
      }
      if (notificationId) {
        handledNotificationResponseIdRef.current = notificationId;
      }

      const notificationRouteParams = {
        notificationId,
        workspaceId: typeof routeParams?.workspaceId === 'string' ? routeParams.workspaceId : null,
        sourceType: typeof routeParams?.sourceType === 'string' ? routeParams.sourceType : null,
        sourceId: typeof routeParams?.sourceId === 'string' ? routeParams.sourceId : null,
      };

      if (route === '/(tabs)/notifications') {
        router.replace({
          pathname: '/(tabs)/notifications',
          params: notificationRouteParams,
        });
        return;
      }

      router.replace(route as never);
    },
    [router],
  );

  useEffect(() => {
    if (!boot.isBootReady || !lastNotificationResponse) {
      return;
    }

    handleNotificationResponse(lastNotificationResponse);
  }, [boot.isBootReady, handleNotificationResponse, lastNotificationResponse]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => {
      subscription.remove();
    };
  }, [handleNotificationResponse]);

  useEffect(() => {
    if (
      !boot.isBootReady ||
      auth.isLoading ||
      !auth.user?.id ||
      !mobilePushHydrated ||
      mobilePushEnabled === null
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        if (mobilePushEnabled) {
          await registerCurrentMobilePushToken();
        } else {
          await revokeCurrentMobilePushToken();
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to sync mobile push token:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.isLoading, auth.user?.id, boot.isBootReady, mobilePushEnabled, mobilePushHydrated]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        />
      </SafeAreaProvider>
    </View>
  );
}
