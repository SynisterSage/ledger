import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import {
  countActiveNotificationFilters,
  NOTIFICATION_SEMANTICS,
  type NotificationFilterState,
  type NotificationSemantic,
} from './notificationFilters';

type NotificationFilterSheetProps = {
  visible: boolean;
  filters: NotificationFilterState;
  onChange: (filters: NotificationFilterState) => void;
  onReset: () => void;
  onClose: () => void;
};

const SHEET_MAX_HEIGHT = 720;
const DRAG_CLOSE_THRESHOLD = 48;

export function NotificationFilterSheet({ visible, filters, onChange, onReset, onClose }: NotificationFilterSheetProps) {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeCount = countActiveNotificationFilters(filters);
  const sheetMaxHeight = Math.min(windowHeight * 0.9, SHEET_MAX_HEIGHT);
  const mountedRef = useRef(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = visible;
    if (visible) {
      closingRef.current = false;
      dragY.setValue(0);
      Animated.parallel([
        Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(backdropProgress, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(backdropProgress, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start();
  }, [backdropProgress, dragY, progress, visible]);

  const closeSheet = () => {
    if (!mountedRef.current || closingRef.current) return;
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(backdropProgress, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(dragY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => dragY.setValue(0),
    onPanResponderMove: (_event: GestureResponderEvent, gestureState: PanResponderGestureState) => dragY.setValue(Math.max(0, gestureState.dy)),
    onPanResponderRelease: (_event: GestureResponderEvent, gestureState: PanResponderGestureState) => {
      if (gestureState.dy > DRAG_CLOSE_THRESHOLD || gestureState.vy > 0.75) {
        closeSheet();
        return;
      }
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  }), [dragY]);

  const toggle = (semantic: NotificationSemantic) => onChange({
    semantics: filters.semantics.includes(semantic)
      ? filters.semantics.filter((value) => value !== semantic)
      : [...filters.semantics, semantic],
  });

  const sheetTranslateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [sheetMaxHeight, 0] }),
    dragY,
  );

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal}>
        <Pressable accessibilityRole="button" onPress={closeSheet} style={styles.backdropPressable}>
          <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.textPrimary, opacity: backdropProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }) }]} />
        </Pressable>
        <Animated.View style={[styles.sheet, { height: sheetMaxHeight, backgroundColor: theme.colors.background, borderColor: theme.colors.borderSubtle, transform: [{ translateY: sheetTranslateY }] }]}>
          <SafeAreaView edges={['bottom']} style={styles.safeArea}>
            <View {...panResponder.panHandlers} style={styles.handleRegion} accessibilityRole="adjustable" accessibilityLabel="Dismiss notification filters">
              <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
            </View>
            <View style={styles.content}>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <AppText variant="sectionTitle" style={styles.title}>Filter notifications</AppText>
                  {activeCount ? <AppText variant="caption">{activeCount} active</AppText> : null}
                </View>
                <Pressable accessibilityRole="button" onPress={onReset} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reset</AppText></Pressable>
              </View>
              <View style={[styles.filterCard, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="label" style={styles.groupLabel}>Type</AppText>
                <View style={styles.options}>{NOTIFICATION_SEMANTICS.map(([semantic, label]) => {
                  const selected = filters.semantics.includes(semantic);
                  return <Pressable key={semantic} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggle(semantic)} style={({ pressed }) => [styles.option, { opacity: pressed ? 0.68 : 1 }]}><AppText variant="body">{label}</AppText>{selected ? <AppText variant="body" style={{ color: theme.colors.accent }}>✓</AppText> : null}</Pressable>;
                })}</View>
              </View>
              <Pressable accessibilityRole="button" onPress={onClose} style={[styles.done, { backgroundColor: theme.colors.accent }]}><AppText variant="button" style={styles.doneText}>Done</AppText></Pressable>
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  portal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  backdropPressable: { ...StyleSheet.absoluteFill },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  safeArea: { flex: 1 },
  handleRegion: { alignItems: 'center', paddingTop: 12, paddingBottom: 20, minHeight: 68 },
  handle: { width: 42, height: 4, borderRadius: 999 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1, gap: 4 },
  title: { fontSize: 20, lineHeight: 24, fontWeight: '500' },
  filterCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12 },
  groupLabel: { paddingBottom: 5, letterSpacing: 0.6 },
  options: { gap: 2 },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  doneText: { color: '#FFFFFF', textAlign: 'center' },
});
