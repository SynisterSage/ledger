import { View } from 'react-native';

import type { NotificationItem } from '@/types/ledger';
import { useLedgerTheme } from '@/theme';

import { NotificationRow } from './NotificationRow';

type NotificationListProps = {
  items: NotificationItem[];
};

export function NotificationList({ items }: NotificationListProps) {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {items.map((item) => (
        <NotificationRow
          key={item.id}
          title={item.title}
          workspace={item.workspace.name}
          meta={item.meta}
          actions={item.actions}
        />
      ))}
    </View>
  );
}
