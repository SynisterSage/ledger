import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Section';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import { NotificationRow } from './NotificationRow';

type NotificationListProps = {
  active: MobileNotificationCenterItem[];
  earlier: MobileNotificationCenterItem[];
  showWorkspaceNames?: boolean;
  onPress?: (item: MobileNotificationCenterItem) => void;
  onLongPress?: (item: MobileNotificationCenterItem) => void;
  busyItemId?: string | null;
};

export function NotificationList({
  active,
  earlier,
  showWorkspaceNames = true,
  onPress,
  onLongPress,
  busyItemId,
}: NotificationListProps) {
  const theme = useLedgerTheme();
  const activeTitle = active.length > 0 ? `Active (${active.length})` : 'Active';

  const renderRows = (items: MobileNotificationCenterItem[]) => (
    <View style={{ gap: theme.spacing.xs }}>
      {items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          showWorkspaceName={showWorkspaceNames}
          onPress={onPress}
          onLongPress={onLongPress}
          disabled={busyItemId === item.id}
        />
      ))}
    </View>
  );

  return (
    <View style={{ gap: theme.spacing['3xl'] }}>
      <Section title={activeTitle}>
        {active.length ? renderRows(active) : <AppText variant="meta">Nothing active.</AppText>}
      </Section>

      <Section title="Earlier">
        {earlier.length ? renderRows(earlier) : <AppText variant="meta">No earlier notifications.</AppText>}
      </Section>
    </View>
  );
}
