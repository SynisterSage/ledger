import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { AppText } from '@/components/AppText';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

type CaptureDateTimePickerSheetProps = {
  visible: boolean;
  title: string;
  mode: 'date' | 'time';
  value: Date;
  onSelect: (value: Date) => void;
  onClose: () => void;
  style?: ViewStyle;
};

const SHEET_VERTICAL_PADDING = 16;
const SHEET_MAX_HEIGHT = 460;
const SHEET_DRAG_CLOSE_THRESHOLD = 48;
const SHEET_BOTTOM_BUFFER = 24;

export function CaptureDateTimePickerSheet({
  visible,
  title,
  mode,
  value,
  onSelect,
  onClose,
  style,
}: CaptureDateTimePickerSheetProps) {
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

  const closeSheet = useCallback(() => {
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
  }, [backdropProgress, dragY, mounted, onClose, progress, reduceMotionEnabled]);

  const handleChange = (_event: DateTimePickerEvent, nextValue?: Date) => {
    if (!nextValue || Number.isNaN(nextValue.getTime())) return;
    onSelect(nextValue);
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

  if (!mounted) {
    return null;
  }

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
            accessibilityLabel={`Dismiss ${title}`}>
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <AppText variant="body" style={styles.headerTitle}>
              {title}
            </AppText>
          </View>

          <View style={[styles.content, style]}>
            <DateTimePicker
              value={value}
              mode={mode}
              display="spinner"
              onChange={handleChange}
              style={styles.picker}
            />
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
  handleHitArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SHEET_VERTICAL_PADDING + 4,
    paddingBottom: 20,
    minHeight: 68,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
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
  content: {
    paddingBottom: 28,
    alignItems: 'stretch',
  },
  picker: {
    alignSelf: 'stretch',
  },
});
