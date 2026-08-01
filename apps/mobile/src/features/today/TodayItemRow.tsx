import { memo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

export type TodayItemType =
  | 'task'
  | 'reminder'
  | 'event'
  | 'project_action'
  | 'project'
  | 'note'
  | 'intake';

export type TodayItemStatus =
  | 'default'
  | 'active'
  | 'overdue'
  | 'focused'
  | 'completed'
  | 'snoozed'
  | 'disabled'
  | 'updating'
  | 'failed';

export type TodayItemRowProps = {
  type: TodayItemType;
  title: string;
  metadata?: string[];
  leadingLabel?: string | null;
  trailingLabel?: string | null;
  progress?: number;
  status?: TodayItemStatus;
  completed?: boolean;
  disabled?: boolean;
  updating?: boolean;
  failed?: boolean;
  onPress: () => void;
  onComplete?: () => void;
  onRetry?: () => void;
  onLongPress?: () => void;
  onOverflow?: () => void;
  swipeLeft?: { label: string; onPress: () => void };
  swipeRight?: { label: string; onPress: () => void };
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

type TodaySymbolName = ComponentProps<typeof SymbolView>['name'];

const iconByType: Record<TodayItemType, TodaySymbolName> = {
  task: { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' },
  reminder: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
  event: { ios: 'calendar', android: 'event', web: 'event' },
  project_action: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  project: { ios: 'folder', android: 'folder_open', web: 'folder_open' },
  note: { ios: 'note.text', android: 'description', web: 'description' },
  intake: { ios: 'tray.and.arrow.down', android: 'inbox', web: 'inbox' },
};

const labelByType: Record<TodayItemType, string> = {
  task: 'Task',
  reminder: 'Reminder',
  event: 'Event',
  project_action: 'Project action',
  project: 'Project',
  note: 'Note',
  intake: 'Intake capture',
};

function TodayItemRowBase({
  type,
  title,
  metadata = [],
  leadingLabel,
  trailingLabel,
  progress,
  status = 'default',
  completed = status === 'completed',
  disabled = status === 'disabled',
  updating = status === 'updating',
  failed = status === 'failed',
  onPress,
  onRetry,
  onLongPress,
  onOverflow,
  swipeLeft,
  swipeRight,
  accessibilityLabel,
  accessibilityHint,
}: TodayItemRowProps) {
  const theme = useLedgerTheme();
  const longPressTriggered = useRef(false);
  const childActionTriggered = useRef(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const [isSwiping, setIsSwiping] = useState(false);
  const interactive = !disabled && !updating;
  const attention = status === 'overdue' || status === 'failed';
  const titleColor = completed ? theme.colors.textMuted : theme.colors.textPrimary;
  const iconColor = theme.colors.textMuted;
  const description = [
    labelByType[type],
    completed ? 'Completed' : null,
    status === 'overdue' ? 'Overdue' : null,
    status === 'snoozed' ? 'Snoozed' : null,
    ...metadata,
    trailingLabel,
  ]
    .filter(Boolean)
    .join('. ');
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      interactive &&
      (Boolean(swipeLeft) || Boolean(swipeRight)) &&
      Math.abs(gestureState.dx) > 18 &&
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
    onPanResponderGrant: () => {
      setIsSwiping(true);
    },
    onPanResponderMove: (_, gestureState) => {
      const next = Math.max(-112, Math.min(112, gestureState.dx));
      translateX.setValue(next);
    },
    onPanResponderRelease: (_, gestureState) => {
      const action = gestureState.dx < -64 ? swipeLeft : gestureState.dx > 64 ? swipeRight : null;
      if (action && interactive) {
        childActionTriggered.current = true;
        action.onPress();
      }
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        tension: 90,
        friction: 12,
      }).start();
      setIsSwiping(false);
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      setIsSwiping(false);
    },
  });

  return (
    <View style={styles.swipeContainer}>
      {isSwiping ? (
        <View style={styles.swipeBackground} pointerEvents="none">
          {swipeRight ? (
            <View style={[styles.swipeAction, { backgroundColor: theme.colors.accent }]}>
              <AppText variant="caption" style={{ color: theme.colors.surface }}>
                {swipeRight.label}
              </AppText>
            </View>
          ) : null}
          {swipeLeft ? (
            <View style={[styles.swipeAction, { backgroundColor: theme.colors.surfaceMuted }]}>
              <AppText variant="caption">{swipeLeft.label}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `${title}. ${description}`}
          accessibilityHint={accessibilityHint ?? 'Opens item details. Long press for actions.'}
          accessibilityState={{ disabled: !interactive }}
          disabled={!interactive}
          onLongPress={() => {
            longPressTriggered.current = true;
            onLongPress?.();
          }}
          onPress={() => {
            if (longPressTriggered.current || childActionTriggered.current) return;
            onPress();
          }}
          onPressOut={() => {
            setTimeout(() => {
              longPressTriggered.current = false;
              childActionTriggered.current = false;
            }, 0);
          }}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: theme.colors.background,
              opacity: disabled ? 0.48 : pressed ? 0.68 : 1,
            },
          ]}
        >
          <View style={styles.content}>
        {leadingLabel ? (
          <AppText variant="meta" numberOfLines={1} style={[styles.leadingLabel, { color: iconColor }]}>
            {leadingLabel}
          </AppText>
        ) : null}

        <View style={styles.leading}>
          <View style={styles.iconTarget}>
            <SymbolView name={iconByType[type]} size={16} weight="regular" tintColor={iconColor} />
          </View>
        </View>

        <View style={styles.main}>
          <AppText
            variant="body"
            numberOfLines={2}
            style={{ color: titleColor, textDecorationLine: completed ? 'line-through' : 'none' }}
          >
            {title}
          </AppText>
          {metadata.length ? (
            <AppText variant="meta" numberOfLines={1}>
              {metadata.join(' · ')}
            </AppText>
          ) : null}
          {typeof progress === 'number' ? (
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderSubtle }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(0, Math.min(100, progress))}%`, backgroundColor: theme.colors.accent },
                ]}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.trailing}>
          {updating ? (
            <ActivityIndicator size="small" color={theme.colors.textMuted} />
          ) : failed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry update for ${title}`}
              disabled={!onRetry}
              hitSlop={8}
              onPress={onRetry}
            >
              <AppText variant="meta" style={{ color: theme.colors.danger }}>
                Retry
              </AppText>
            </Pressable>
          ) : trailingLabel ? (
            <AppText
              variant="meta"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: attention ? theme.colors.danger : theme.colors.textMuted }}
            >
              {trailingLabel}
            </AppText>
          ) : null}
          {onOverflow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${title}`}
              disabled={!interactive}
              hitSlop={8}
              onPress={() => {
                childActionTriggered.current = true;
                onOverflow();
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={16}
                weight="medium"
                tintColor={theme.colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export const TodayItemRow = memo(TodayItemRowBase);

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    width: '100%',
    justifyContent: 'center',
  },
  swipeContainer: {
    overflow: 'hidden',
  },
  swipeBackground: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  swipeAction: {
    width: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  leadingLabel: {
    width: 42,
    flexShrink: 0,
  },
  leading: {
    width: 28,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconTarget: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  progressTrack: {
    height: 3,
    width: '100%',
    marginTop: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
  },
  trailing: {
    maxWidth: 112,
    minWidth: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
    flexShrink: 1,
  },
});
