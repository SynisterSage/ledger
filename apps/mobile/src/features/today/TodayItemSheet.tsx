import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type {
  MobileTodayInteractionItem,
} from '@/types/ledger';

export type TodaySheetMode = 'detail' | 'actions';

export type TodaySheetItem = MobileTodayInteractionItem;

type TodayItemSheetProps = {
  visible: boolean;
  item: TodaySheetItem | null;
  mode: TodaySheetMode;
  onClose: () => void;
  onAction: (actionId: string, item: TodaySheetItem) => void;
};

type SheetAction = {
  id: string;
  label: string;
  danger?: boolean;
  primary?: boolean;
};

function getItemTypeLabel(item: TodaySheetItem) {
  if ('source' in item) {
    return 'Capture';
  }

  if (item.type === 'project_action') {
    return 'Project action';
  }

  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getItemMeta(item: TodaySheetItem) {
  if ('type' in item && item.type === 'focus') {
    return null;
  }

  if ('source' in item) {
    return item.source;
  }

  const metaParts = [
    item.workspaceName,
    'timeLabel' in item ? item.timeLabel : null,
    'meta' in item ? item.meta : ('dueLabel' in item ? item.dueLabel : null),
  ].filter(Boolean);
  return metaParts.join(' · ');
}

function getActionsForItem(item: TodaySheetItem, mode: TodaySheetMode): SheetAction[] {
  if ('source' in item) {
    return [
      { id: 'convert_task', label: 'Convert to task', primary: mode === 'actions' },
      { id: 'convert_reminder', label: 'Convert to reminder' },
      { id: 'convert_note', label: 'Convert to note' },
      { id: 'archive', label: 'Archive', danger: true },
    ];
  }

  switch (item.type) {
    case 'focus':
      return mode === 'actions'
        ? [
            { id: 'mark_done', label: 'Mark as done', primary: true },
            { id: 'remove_today', label: 'Remove from Today' },
            { id: 'delete', label: 'Delete', danger: true },
          ]
        : [
            { id: 'mark_done', label: 'Mark as done', primary: true },
            { id: 'remove_today', label: 'Remove from Today' },
          ];
    case 'event':
      return mode === 'actions'
        ? [
            { id: 'open', label: 'Open', primary: true },
            { id: 'add_note', label: 'Add note' },
            { id: 'create_follow_up', label: 'Create follow-up' },
            { id: 'reschedule', label: 'Reschedule' },
            { id: 'dismiss_today', label: 'Dismiss from Today', danger: true },
          ]
        : [
            { id: 'open', label: 'Open', primary: true },
            { id: 'add_note', label: 'Add note' },
            { id: 'create_follow_up', label: 'Create follow-up' },
            { id: 'reschedule', label: 'Reschedule' },
          ];
    case 'reminder':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'snooze_hour', label: 'Snooze 1 hour' },
            { id: 'snooze_tomorrow', label: 'Snooze tomorrow' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', danger: true },
          ]
        : [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'snooze_hour', label: 'Snooze 1 hour' },
            { id: 'edit', label: 'Edit' },
          ];
    case 'task':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'add_focus', label: 'Add to focus' },
            { id: 'edit', label: 'Edit' },
            { id: 'delete', label: 'Delete', danger: true },
          ]
        : [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'edit', label: 'Edit' },
          ];
    case 'project_action':
      return mode === 'actions'
        ? [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'move_tomorrow', label: 'Move to tomorrow' },
            { id: 'open_project', label: 'Open project' },
            { id: 'edit', label: 'Edit' },
          ]
        : [
            { id: 'complete', label: 'Complete', primary: true },
            { id: 'open_project', label: 'Open project' },
            { id: 'edit', label: 'Edit' },
          ];
    default:
      return [];
  }
}

export function TodayItemSheet({ visible, item, mode, onClose, onAction }: TodayItemSheetProps) {
  const theme = useLedgerTheme();

  const actions = useMemo(() => (item ? getActionsForItem(item, mode) : []), [item, mode]);

  if (!item) {
    return null;
  }

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'actions' ? undefined : item.title}
      snapPoints={mode === 'actions' ? ['35%', '55%', '85%'] : ['55%', '85%']}
      initialSnapPointIndex={mode === 'actions' ? 2 : 1}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          {mode === 'actions' ? (
            <AppText variant="screenTitle" style={styles.title}>
              {item.title}
            </AppText>
          ) : null}
          <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
            {getItemTypeLabel(item)}
          </AppText>
          {getItemMeta(item) ? (
            <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
              {getItemMeta(item)}
            </AppText>
          ) : null}
        </View>

        {mode === 'detail' && 'source' in item ? (
          <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
            Capture waiting to be sorted.
          </AppText>
        ) : null}

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
