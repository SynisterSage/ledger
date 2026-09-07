import { memo, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import type { MobileNotificationCenterItem } from '@/types/ledger';
import type { PresentedNotification } from './notificationAdapters';

type NotificationRowProps = {
  presented: PresentedNotification;
  onPress?: (item: MobileNotificationCenterItem) => void;
  onLongPress?: (item: MobileNotificationCenterItem) => void;
  swipeActions?: Array<{ id: string; label: string; destructive?: boolean; onPress: () => void }>;
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  disabled?: boolean;
};

function NotificationRowBase({
  presented,
  onPress,
  onLongPress,
  swipeActions = [],
  open = false,
  onOpen,
  onClose,
  disabled = false,
}: NotificationRowProps) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const longPressTriggered = useRef(false);
  const swipeTriggered = useRef(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const [isSwiping, setIsSwiping] = useState(false);
  const { notification: item, presentation, displayState } = presented;
  const unread = displayState === 'unread';
  const resolved = displayState === 'resolved';
  const overdue = presentation.isOverdue && !resolved;

  const animateTo = (value: number) => {
    if (appPreferences.reduceMotionEnabled) {
      translateX.setValue(value);
      return;
    }
    Animated.spring(translateX, { toValue: value, useNativeDriver: true, tension: 120, friction: 18 }).start();
  };

  useEffect(() => {
    animateTo(open ? -Math.min(144, swipeActions.length * 72) : 0);
  }, [open, swipeActions.length, appPreferences.reduceMotionEnabled]);

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      !disabled && swipeActions.length > 0 && Math.abs(gestureState.dx) > 16 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
    onPanResponderGrant: () => {
      swipeTriggered.current = true;
      setIsSwiping(true);
      onOpen?.();
    },
    onPanResponderMove: (_, gestureState) => {
      translateX.setValue(Math.max(-144, Math.min(0, gestureState.dx)));
    },
    onPanResponderRelease: (_, gestureState) => {
      const shouldOpen = gestureState.dx < -54;
      if (shouldOpen) onOpen?.(); else onClose?.();
      animateTo(shouldOpen ? -Math.min(144, swipeActions.length * 72) : 0);
      setIsSwiping(false);
      setTimeout(() => { swipeTriggered.current = false; }, 0);
    },
    onPanResponderTerminate: () => {
      onClose?.();
      animateTo(0);
      setIsSwiping(false);
      setTimeout(() => { swipeTriggered.current = false; }, 0);
    },
  });

  const accessibilityActions = swipeActions.map((action) => ({ name: action.id, label: action.label }));

  return (
    <View style={styles.swipeContainer} {...panResponder.panHandlers}>
      {isSwiping || open ? (
        <View style={styles.swipeBackground} pointerEvents={open ? 'auto' : 'none'}>
          {swipeActions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() => { onClose?.(); action.onPress(); }}
              style={({ pressed }) => [styles.swipeAction, { backgroundColor: action.destructive ? theme.colors.danger : theme.colors.surfaceMuted, opacity: pressed ? 0.72 : 1 }]}
            >
              <AppText variant="caption" style={{ color: action.destructive ? theme.colors.surface : theme.colors.textPrimary, textAlign: 'center' }}>{action.label}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${presentation.title}. ${presentation.summary ?? ''} ${overdue ? 'Overdue.' : unread ? 'Unread.' : resolved ? 'Resolved.' : 'Read.'} ${presentation.accessibilityTime}`.trim()}
        accessibilityHint="Opens notification details. Long press for actions. Swipe left for notification actions."
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(event) => swipeActions.find((action) => action.id === event.nativeEvent.actionName)?.onPress()}
        disabled={disabled}
        onLongPress={() => {
          longPressTriggered.current = true;
          onLongPress?.(item);
        }}
        onPress={() => {
          if (longPressTriggered.current || swipeTriggered.current) return;
          if (open) { onClose?.(); return; }
          onPress?.(item);
        }}
        onPressOut={() => {
          setTimeout(() => { longPressTriggered.current = false; }, 0);
        }}
        style={({ pressed }) => [styles.row, { opacity: disabled ? 0.48 : pressed ? 0.68 : 1 }]}
      >
      <View style={styles.iconColumn}>
        <View style={[styles.iconContainer, { backgroundColor: theme.colors[presentation.colorTone] }]}>
          <SymbolView name={presentation.icon} size={15} weight="regular" tintColor="#FFFFFF" />
          {overdue ? (
            <View
              style={[styles.attentionBadge, { backgroundColor: theme.colors.danger, borderColor: theme.colors.background }]}
            >
              <SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={8} tintColor="#FFFFFF" />
            </View>
          ) : null}
        </View>
      </View>
      <View
        style={[styles.content, { borderBottomColor: theme.colors.borderSubtle }]}
      >
        <View style={styles.titleBlock}>
          <AppText
            variant="body"
            numberOfLines={2}
            style={{ color: theme.colors.textPrimary, fontWeight: unread ? '600' : resolved ? '400' : '500' }}
          >
            {presentation.title}
          </AppText>
          <View style={styles.metaLine}>
            {presentation.summary ? (
              <AppText variant="meta" numberOfLines={1} ellipsizeMode="tail" style={[styles.summary, { color: unread ? theme.colors.textSecondary : theme.colors.textMuted }]}>
                {presentation.summary}
              </AppText>
            ) : <View style={styles.summarySpacer} />}
            <View style={styles.timestamp}>
              <AppText variant="meta" numberOfLines={1} style={{ color: theme.colors.textMuted }}>
                {presentation.relativeTime}
              </AppText>
              {!overdue && unread ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.accent }]} /> : null}
            </View>
          </View>
        </View>
      </View>
      </Pressable>
      </Animated.View>
    </View>
  );
}

export const NotificationRow = memo(NotificationRowBase);

const styles = StyleSheet.create({
  swipeContainer: { overflow: 'hidden', position: 'relative' },
  swipeBackground: { ...StyleSheet.absoluteFill, flexDirection: 'row', justifyContent: 'flex-end' },
  swipeAction: { width: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  iconColumn: {
    width: 24,
    alignItems: 'center',
    paddingTop: 2,
  },
  iconContainer: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  attentionBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    minWidth: 0,
    flex: 1,
    gap: 3,
    paddingBottom: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleBlock: { minWidth: 0, gap: 3 },
  metaLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summary: { minWidth: 0, flex: 1 },
  summarySpacer: { flex: 1 },
  timestamp: {
    minWidth: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    paddingTop: 2,
  },
  unreadDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
});
