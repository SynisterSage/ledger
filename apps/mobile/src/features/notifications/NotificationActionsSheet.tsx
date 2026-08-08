import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import { getNotificationActions, getNotificationDisplayState, getNotificationSubtitle } from './notificationAdapters';

type NotificationActionsSheetProps = {
  visible: boolean;
  item: MobileNotificationCenterItem | null;
  showWorkspaceNames?: boolean;
  onClose: () => void;
  onAction: (actionId: string, item: MobileNotificationCenterItem) => void;
};

export function NotificationActionsSheet({
  visible,
  item,
  showWorkspaceNames = true,
  onClose,
  onAction,
}: NotificationActionsSheetProps) {
  const theme = useLedgerTheme();

  const actions = useMemo(() => {
    if (!item) return [];
    const state = getNotificationDisplayState(item);
    return [
      { id: 'open', label: 'Open' },
      { id: state === 'unread' ? 'mark_read' : 'mark_unread', label: state === 'unread' ? 'Mark as read' : 'Mark as unread' },
      ...getNotificationActions(item),
      { id: 'notification_settings', label: 'Notification settings' },
    ];
  }, [item]);

  if (!item) {
    return null;
  }

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={undefined} snapPoints={['34%', '52%', '92%']} initialSnapPointIndex={2} dragCloseThreshold={24} dragCloseVelocityThreshold={0.35} dragCloseSnapMargin={4}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle" style={styles.title}>
            {item.title}
          </AppText>
          <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
            {getNotificationSubtitle(item, showWorkspaceNames)}
          </AppText>
        </View>

        <View style={[styles.actionGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              onPress={() => onAction(action.id, item)}
              style={({ pressed }) => [
                styles.actionRow,
                {
                  opacity: pressed ? 0.72 : 1,
                },
              ]}>
              <AppText
                variant="body"
                style={{
                  color: action.variant === 'danger' ? theme.colors.danger : theme.colors.textPrimary,
                  fontWeight: action.variant === 'primary' ? '500' : '400',
                }}>
                {action.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '400',
    letterSpacing: -0.4,
  },
  actionGroup: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 2,
  },
  actionRow: {
    minHeight: 48,
    paddingVertical: 14,
    justifyContent: 'center',
  },
});
