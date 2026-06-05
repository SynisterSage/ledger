import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileTodayInteractionItem } from '@/types/ledger';

export type TodayActionSheetItem = MobileTodayInteractionItem;

type TodayItemActionsSheetProps = {
  visible: boolean;
  item: TodayActionSheetItem | null;
  onClose: () => void;
  onAction: (actionId: string, item: TodayActionSheetItem) => void;
};

type SheetAction = {
  id: string;
  label: string;
  danger?: boolean;
  primary?: boolean;
};

function getItemTypeLabel(item: TodayActionSheetItem) {
  if ('source' in item) {
    return 'Capture';
  }

  if (item.type === 'project_action') {
    return 'Project action';
  }

  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getItemMeta(item: TodayActionSheetItem) {
  if ('type' in item && item.type === 'focus') {
    const focusParts = [item.workspaceName, 'Focus', item.urgency ?? 'Low'].filter(Boolean);
    return focusParts.length ? focusParts.join(' · ') : null;
  }

  if ('source' in item) {
    const captureParts = [item.workspaceName, item.createdAt ? formatDateTimeLabel(item.createdAt) : item.dateLabel ?? null, item.source].filter(Boolean);
    return captureParts.length ? captureParts.join(' · ') : item.source;
  }

  const dateMeta = 'startsAt' in item ? formatDateTimeLabel(item.startsAt) : 'dateLabel' in item ? item.dateLabel : null;
  const metaParts = [item.workspaceName, dateMeta].filter(Boolean);
  return metaParts.join(' · ');
}

function formatDateTimeLabel(dateLike: string | null | undefined) {
  if (!dateLike) return null;

  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getActionsForItem(item: TodayActionSheetItem): SheetAction[] {
  if ('source' in item) {
    return [
      { id: 'convert_task', label: 'Convert to task', primary: true },
      { id: 'convert_reminder', label: 'Convert to reminder' },
      { id: 'convert_note', label: 'Convert to note' },
      { id: 'archive', label: 'Archive' },
      { id: 'delete', label: 'Delete', danger: true },
    ];
  }

  switch (item.type) {
    case 'focus':
      return [
        { id: 'mark_done', label: 'Mark as done', primary: true },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'remove_today', label: 'Remove from Today' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', danger: true },
      ];
    case 'event':
      return [
        { id: 'open', label: 'Open', primary: true },
        { id: 'add_note', label: 'Add note' },
        { id: 'create_follow_up', label: 'Create follow-up' },
        { id: 'reschedule', label: 'Reschedule' },
        { id: 'dismiss_today', label: 'Dismiss from Today', danger: true },
        { id: 'delete', label: 'Delete', danger: true },
      ];
    case 'reminder':
      return [
        { id: 'complete', label: 'Mark as done', primary: true },
        { id: 'snooze_hour', label: 'Snooze 1 hour' },
        { id: 'snooze_tomorrow', label: 'Snooze tomorrow' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', danger: true },
      ];
    case 'task':
      return [
        { id: 'complete', label: 'Mark as done', primary: true },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'add_focus', label: 'Add to focus' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', danger: true },
      ];
    case 'project_action':
      return [
        { id: 'complete', label: 'Mark as done', primary: true },
        { id: 'move_tomorrow', label: 'Move to tomorrow' },
        { id: 'open_project', label: 'Open project' },
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete', danger: true },
      ];
    default:
      return [];
  }
}

export function TodayItemActionsSheet({ visible, item, onClose, onAction }: TodayItemActionsSheetProps) {
  const theme = useLedgerTheme();

  const actions = useMemo(() => (item ? getActionsForItem(item) : []), [item]);

  if (!item) {
    return null;
  }

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={undefined}
      snapPoints={['35%', '55%', '85%']}
      initialSnapPointIndex={2}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle" style={styles.title}>
            {item.title}
          </AppText>
          <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
            {getItemTypeLabel(item)}
          </AppText>
          {getItemMeta(item) ? (
            <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
              {getItemMeta(item)}
            </AppText>
          ) : null}
        </View>

        <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} />

        <View>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              onPress={() => {
                onAction(action.id, item);
              }}
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
                  color: action.danger ? theme.colors.danger : theme.colors.textPrimary,
                  fontWeight: action.primary ? '500' : '400',
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
