import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { NotificationList } from '@/features/notifications/NotificationList';
import { listNotifications } from '@/api/notifications';
import { useLedgerTheme } from '@/theme';

export default function NotificationsScreen() {
  const theme = useLedgerTheme();
  const items = listNotifications();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.lg }}>
        <AppText variant="screenTitle">Notifications</AppText>
        <AppText variant="body">3 active</AppText>
      </View>
      <NotificationList items={items} />
    </Screen>
  );
}
