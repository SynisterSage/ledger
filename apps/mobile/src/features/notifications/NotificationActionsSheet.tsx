import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import { getNotificationActions, getNotificationSubtitle } from './notificationAdapters';

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

  const actions = useMemo(() => (item ? getNotificationActions(item) : []), [item]);

  if (!item) {
    return null;
  }

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={undefined} snapPoints={['34%', '52%', '80%']} initialSnapPointIndex={1}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle" style={styles.title}>
            {item.title}
          </AppText>
          <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
            {getNotificationSubtitle(item, showWorkspaceNames)}
          </AppText>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} />

        <View>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              onPress={() => onAction(action.id, item)}
              style={({ pressed }) => [
                styles.actionRow,
                {
                  borderBottomColor: theme.colors.borderSubtle,
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
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  actionRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    justifyContent: 'center',
  },
});
