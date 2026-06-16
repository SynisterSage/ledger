import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

type SiriShortcutsSheetProps = {
  visible: boolean;
  onClose: () => void;
};

const SHEET_OFFSET = 24;
const SHEET_VERTICAL_PADDING = 16;
const SHEET_MAX_HEIGHT = 480;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;
const SHEET_BOTTOM_BUFFER = 24;

const shortcuts = [
  {
    title: "What's Today",
    subtitle: '“Hey Siri, what’s Today in Ledger?”',
  },
  {
    title: 'Add Reminder',
    subtitle: '“Hey Siri, add a Ledger reminder.”',
  },
  {
    title: 'Add Task',
    subtitle: '“Hey Siri, add a Ledger task.”',
  },
  {
    title: 'Create Event',
    subtitle: '“Hey Siri, create a Ledger event.”',
  },
  {
    title: 'Save Note',
    subtitle: '“Hey Siri, save a Ledger note.”',
  },
];

export function SiriShortcutsSheet({ visible, onClose }: SiriShortcutsSheetProps) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      dragY.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduceMotionEnabled ? 1 : 220,
        useNativeDriver: true,
      }).start();
      Animated.timing(backdropProgress, {
        toValue: 1,
        duration: reduceMotionEnabled ? 1 : 220,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotionEnabled ? 1 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: reduceMotionEnabled ? 1 : 120,
      useNativeDriver: true,
    }).start();
  }, [backdropProgress, dragY, progress, reduceMotionEnabled, visible]);

  const closeSheet = () => {
    if (!mounted || closingRef.current) return;

    closingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : 120,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragY.setValue(0);
        },
        onPanResponderMove: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
          dragY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
          if (gestureState.dy > SHEET_DRAG_CLOSE_THRESHOLD || gestureState.vy > 0.75) {
            closeSheet();
            return;
          }

          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: reduceMotionEnabled ? 24 : 16,
          }).start();
        },
      }),
    [closeSheet, dragY, reduceMotionEnabled],
  );

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [SHEET_MAX_HEIGHT, 0],
    }),
    dragY,
  );

  if (!mounted) {
    return null;
  }

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal} pointerEvents="box-none">
        <Pressable accessibilityRole="button" onPress={closeSheet} style={styles.backdropPressable}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: theme.colors.textPrimary,
                opacity: Animated.multiply(
                  backdropOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.14],
                  }),
                  backdropProgress,
                ),
              },
            ]}
          />
        </Pressable>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.borderSubtle,
              paddingBottom: SHEET_BOTTOM_BUFFER,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}>
          <View
            {...panResponder.panHandlers}
            style={styles.handleHitArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Dismiss Siri Shortcuts">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <AppText variant="body" style={styles.headerTitle}>
              Siri Shortcuts
            </AppText>
          </View>

          <View style={styles.list}>
            <AppText variant="meta" style={{ marginBottom: theme.spacing.xs, paddingHorizontal: 8 }}>
              Preview the Siri phrases Ledger will support on iPhone.
            </AppText>

            {shortcuts.map((shortcut, index) => (
              <View
                key={shortcut.title}
                style={[
                  styles.row,
                  index === shortcuts.length - 1 ? styles.rowLast : styles.rowBorder,
                  { borderBottomColor: theme.colors.borderSubtle },
                ]}>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong" style={styles.rowTitle}>
                    {shortcut.title}
                  </AppText>
                  <AppText variant="meta">{shortcut.subtitle}</AppText>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  portal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxHeight: SHEET_MAX_HEIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    marginTop: 0,
    marginBottom: 0,
  },
  handleHitArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SHEET_VERTICAL_PADDING + 4,
    paddingBottom: 20,
    minHeight: 68,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 28,
  },
  row: {
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
});
