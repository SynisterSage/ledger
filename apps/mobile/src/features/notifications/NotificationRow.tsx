import { memo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import { getNotificationSubtitle } from './notificationAdapters';

type NotificationRowProps = {
  item: MobileNotificationCenterItem;
  showWorkspaceName?: boolean;
  onPress?: (item: MobileNotificationCenterItem) => void;
  onLongPress?: (item: MobileNotificationCenterItem) => void;
  disabled?: boolean;
};

function NotificationRowBase({
  item,
  showWorkspaceName = true,
  onPress,
  onLongPress,
  disabled = false,
}: NotificationRowProps) {
  const theme = useLedgerTheme();
  const longPressTriggered = useRef(false);
  const isActive = item.status === 'active';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens notification details. Long press for actions."
      disabled={disabled}
      onLongPress={() => {
        longPressTriggered.current = true;
        onLongPress?.(item);
      }}
      onPress={() => {
        if (longPressTriggered.current) {
          return;
        }
        onPress?.(item);
      }}
      onPressOut={() => {
        setTimeout(() => {
          longPressTriggered.current = false;
        }, 0);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.colors.borderSubtle,
          paddingVertical: theme.spacing.md,
          opacity: disabled ? 0.4 : pressed ? 0.72 : 1,
        },
      ]}>
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {isActive ? <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} /> : null}
          <AppText
            variant="body"
            style={{
              color: isActive ? theme.colors.textPrimary : theme.colors.textSecondary,
              fontWeight: isActive ? '500' : '400',
            }}>
            {item.title}
          </AppText>
        </View>
        <AppText
          variant="meta"
          style={{
            color: isActive ? theme.colors.textMuted : theme.colors.textMuted,
          }}>
          {getNotificationSubtitle(item, showWorkspaceName)}
        </AppText>
        {item.body ? (
          <AppText variant="meta" style={{ color: theme.colors.textMuted }} numberOfLines={2}>
            {item.body}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export const NotificationRow = memo(NotificationRowBase);

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
});
