import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { registerCurrentMobilePushToken } from '@/api/pushNotifications';
import { useAuthState } from '@/store/sessionStore';
import { setNotificationOnboardingChoice } from '@/store/notificationOnboardingStore';
import { useLedgerTheme } from '@/theme';

type NotificationPermissionSheetProps = {
  visible: boolean;
  onDismiss: () => void;
};

export function NotificationPermissionSheet({ visible, onDismiss }: NotificationPermissionSheetProps) {
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (choice: 'enabled' | 'denied' | 'skipped') => {
    if (!auth.user?.id) {
      setError('Your account is still loading. Please try again.');
      return;
    }

    await setNotificationOnboardingChoice(auth.user.id, choice);
  };

  const handleEnable = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const existing = await Notifications.getPermissionsAsync();
      const permission = existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();

      if (permission.status === 'granted') {
        try {
          await registerCurrentMobilePushToken();
        } catch (registerError) {
          console.warn('Failed to register mobile push token:', registerError);
        }
        await finish('enabled');
      } else {
        await finish('denied');
      }
    } catch {
      setError('Could not update notifications. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNotNow = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await finish('skipped');
    } catch {
      setError('Could not save your choice. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onDismiss}
      snapPoints={['36%', '52%']}
      initialSnapPointIndex={0}
      dragCloseThreshold={24}
      dragCloseVelocityThreshold={0.35}
      dragCloseSnapMargin={4}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="sectionTitle">Keep important things from slipping</AppText>
          <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
            Get reminders for due tasks, upcoming events, and project actions while you’re away from your computer.
          </AppText>
        </View>

        {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton
            title={isSubmitting ? 'Updating…' : 'Enable notifications'}
            onPress={() => void handleEnable()}
            disabled={isSubmitting}
            size="lg"
          />
          <AppButton title="Not now" variant="secondary" onPress={() => void handleNotNow()} disabled={isSubmitting} size="lg" />
        </View>
      </View>
    </AppBottomSheet>
  );
}
