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
};

export function NotificationList({ active, earlier, showWorkspaceNames = true }: NotificationListProps) {
  const theme = useLedgerTheme();

  const renderRows = (items: MobileNotificationCenterItem[]) => (
    <View style={{ gap: theme.spacing.lg }}>
      {items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          showWorkspaceName={showWorkspaceNames}
        />
      ))}
    </View>
  );

  return (
    <View style={{ gap: theme.spacing['3xl'] }}>
      <Section title="Active">
        {active.length ? renderRows(active) : <AppText variant="meta">Nothing active.</AppText>}
      </Section>

      <Section title="Earlier">
        {earlier.length ? renderRows(earlier) : <AppText variant="meta">No earlier notifications.</AppText>}
      </Section>
    </View>
  );
}
