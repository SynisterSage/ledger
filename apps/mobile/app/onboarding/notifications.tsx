import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import NotificationBell from '../../assets/images/noti-bell.svg';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AuthHeader } from '@/components/AuthHeader';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';
import { useAuthState } from '@/store/sessionStore';
import {
  setNotificationOnboardingChoice,
  useNotificationOnboardingState,
} from '@/store/notificationOnboardingStore';

export default function NotificationsOnboardingScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const authSession = useAuthState();
  const authState = useNotificationOnboardingState();
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (routeTimerRef.current) {
        clearTimeout(routeTimerRef.current);
      }
    };
  }, []);

  const goToToday = () => {
    router.replace('/(tabs)/today');
  };

  const finishChoice = async (choice: 'enabled' | 'denied' | 'skipped', message?: string | null) => {
    await setNotificationOnboardingChoice(authSession.user?.id ?? authState.userId, choice);
    if (message) {
      setStatusMessage(message);
      routeTimerRef.current = setTimeout(() => {
        goToToday();
      }, 650);
      return;
    }

    goToToday();
  };

  const handleEnableNotifications = async () => {
    if (isEnablingNotifications || isSkipping) {
      return;
    }

    setIsEnablingNotifications(true);
    setStatusMessage(null);

    try {
      const existing = await Notifications.getPermissionsAsync();
      const permission =
        existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();

      if (permission.status === 'granted') {
        await finishChoice('enabled');
        return;
      }

      await finishChoice(
        'denied',
        'Notifications are off. You can enable them later in Settings.',
      );
    } catch {
      await finishChoice(
        'skipped',
        'Couldn’t update notifications. You can change this later in Settings.',
      );
    } finally {
      setIsEnablingNotifications(false);
    }
  };

  const handleSkip = async () => {
    if (isEnablingNotifications || isSkipping) {
      return;
    }

    setStatusMessage(null);
    setIsSkipping(true);
    try {
      await finishChoice('skipped');
    } finally {
      setIsSkipping(false);
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}>
        <AuthHeader title="Notifications" />

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <NotificationBell width={122} height={139} />
          </View>

          <View style={styles.copy}>
            <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
              Let Ledger bring important things back to you.
            </AppText>
            <AppText variant="body" style={{ color: theme.colors.textMuted }}>
              Get reminders for due tasks, upcoming events, and project actions while you’re away from your computer.
            </AppText>
          </View>

          <View style={styles.actions}>
            <AppButton
              title={isEnablingNotifications ? 'Enabling...' : 'Enable notifications'}
              onPress={handleEnableNotifications}
              disabled={isEnablingNotifications || isSkipping}
              size="lg"
            />
            <AppButton
              title="Not now"
              variant="secondary"
              onPress={handleSkip}
              disabled={isEnablingNotifications || isSkipping}
              size="lg"
            />
          </View>

          {statusMessage ? (
            <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
              {statusMessage}
            </AppText>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = {
  container: {
    flex: 1,
    justifyContent: 'space-between' as const,
  },
  body: {
    gap: 20,
    marginTop: 0,
    marginBottom: 8,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 88,
  },
  copy: {
    gap: 4,
  },
  actions: {
    gap: 14,
  },
} as const;
