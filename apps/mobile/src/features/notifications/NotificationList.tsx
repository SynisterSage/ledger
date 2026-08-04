import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import { NotificationRow } from './NotificationRow';
import type { NotificationSection } from './notificationAdapters';

type NotificationListProps = {
  sections: NotificationSection[];
  onPress?: (item: MobileNotificationCenterItem) => void;
  onLongPress?: (item: MobileNotificationCenterItem) => void;
  openRowId?: string | null;
  onOpenRow?: (id: string) => void;
  onCloseRow?: () => void;
  getSwipeActions?: (item: MobileNotificationCenterItem) => Array<{ id: string; label: string; destructive?: boolean; onPress: () => void }>;
  onMarkAllRead?: () => void;
  busyItemId?: string | null;
};

function SectionHeader({ title, count, action, onAction }: { title: string; count?: number; action?: string; onAction?: () => void }) {
  const theme = useLedgerTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="label" style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{title}</AppText>
      {typeof count === 'number' ? <AppText variant="caption" style={{ color: theme.colors.textMuted }}>{count}</AppText> : null}
      {action ? <Pressable accessibilityRole="button" accessibilityLabel={action} hitSlop={8} onPress={onAction} style={styles.sectionAction}><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{action}</AppText></Pressable> : null}
    </View>
  );
}

export function NotificationList({
  sections,
  onPress,
  onLongPress,
  openRowId,
  onOpenRow,
  onCloseRow,
  getSwipeActions,
  onMarkAllRead,
  busyItemId,
}: NotificationListProps) {
  const renderRows = (section: NotificationSection) => (
    <View key={section.key}>
      {section.data.map((presented) => (
        <NotificationRow
          key={presented.notification.id}
          presented={presented}
          onPress={onPress}
          onLongPress={onLongPress}
          swipeActions={getSwipeActions?.(presented.notification)}
          open={openRowId === presented.notification.id}
          onOpen={() => onOpenRow?.(presented.notification.id)}
          onClose={onCloseRow}
          disabled={busyItemId === presented.notification.id}
        />
      ))}
    </View>
  );

  return (
    <View style={[styles.container, sections.length === 1 && sections[0].key === 'earlier' ? styles.earlierOnly : null]}>
      {sections.map((section) => (
        <View key={section.key} style={section.key === 'earlier' ? styles.earlierSection : undefined}>
          {(section.key !== 'earlier' || sections.some((candidate) => candidate.key === 'new')) ? <SectionHeader title={section.title} count={section.count} action={section.key === 'new' ? 'Mark all read' : undefined} onAction={onMarkAllRead} /> : null}
          {renderRows(section)}
        </View>
      ))}
    </View>
  );
}

const styles = {
  container: { gap: 22 },
  earlierOnly: { paddingTop: 18 },
  sectionHeader: { minHeight: 25, flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 6, marginBottom: 2 },
  sectionAction: { marginLeft: 'auto' as const, paddingVertical: 3 },
  earlierSection: { paddingTop: 2 },
};
