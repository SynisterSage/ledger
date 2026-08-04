import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileTodayInteractionItem } from '@/types/ledger';
import { getTodayItemActions } from './todayActions';

export type TodayActionSheetItem = MobileTodayInteractionItem;

type TodayItemActionsSheetProps = {
  visible: boolean;
  item: TodayActionSheetItem | null;
  onClose: () => void;
  onAction: (actionId: string, item: TodayActionSheetItem) => void;
  onOpen?: (item: TodayActionSheetItem) => void;
};

export type MobileActionSheetAction = {
  id: string;
  label: string;
  role?: 'default' | 'destructive';
  disabled?: boolean;
  perform: () => void | Promise<void>;
};

type MobileActionsSheetProps = {
  visible: boolean;
  title: string;
  typeLabel?: string;
  meta?: string | null;
  actions: MobileActionSheetAction[];
  onClose: () => void;
};

function getItemTypeLabel(item: TodayActionSheetItem) {
  if ('source' in item) {
    return 'Capture';
  }

  if (item.type === 'note') {
    return 'Note';
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

  if (item.type === 'note') {
    const noteParts = [item.workspaceName, item.updatedAt ? formatDateTimeLabel(item.updatedAt) : null, 'Note'].filter(Boolean);
    return noteParts.join(' · ');
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

export function TodayItemActionsSheet({ visible, item, onClose, onAction, onOpen }: TodayItemActionsSheetProps) {
  const actions = useMemo(
    () =>
      item
        ? getTodayItemActions(item, {
            onAction: (actionId, actionItem) => onAction(actionId, actionItem),
            onOpen,
            includeDestructive: true,
          })
        : [],
    [item, onAction],
  );

  if (!item) return null;

  return <MobileActionsSheet
    visible={visible}
    title={item.title}
    typeLabel={getItemTypeLabel(item)}
    meta={getItemMeta(item)}
    actions={actions}
    onClose={onClose}
  />;
}

export function MobileActionsSheet({ visible, title, typeLabel, meta, actions, onClose }: MobileActionsSheetProps) {
  const theme = useLedgerTheme();

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      headerAccessory={(
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} hitSlop={8}>
          <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={26} tintColor={theme.colors.accent} />
        </Pressable>
      )}
      snapPoints={['35%', '55%', '85%']}
      initialSnapPointIndex={2}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={styles.itemHeader}>
          {typeLabel ? <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>{typeLabel}</AppText> : null}
          {meta ? (
            <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
              {meta}
            </AppText>
          ) : null}
        </View>

        <View
          style={[
            styles.actionGroup,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window },
          ]}
        >
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              disabled={action.disabled}
              onPress={() => void action.perform()}
              style={({ pressed }) => [
                styles.actionRow,
                  {
                    opacity: action.disabled ? 0.4 : pressed ? 0.72 : 1,
                },
              ]}>
              <AppText
                variant="body"
                style={{
                  color:
                    action.role === 'destructive' ? theme.colors.danger : theme.colors.textPrimary,
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
  itemHeader: {
    gap: 4,
    paddingHorizontal: 2,
  },
  actionGroup: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 2,
  },
  actionRow: {
    minHeight: 56,
    paddingVertical: 8,
    justifyContent: 'center',
  },
});
