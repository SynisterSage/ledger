import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

export type AppBottomSheetSnapPoint = number | `${number}%`;

type AppBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  snapPoints?: AppBottomSheetSnapPoint[];
  initialSnapPointIndex?: number;
  headerAccessory?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  dragCloseThreshold?: number;
  dragCloseVelocityThreshold?: number;
  dragCloseSnapMargin?: number;
};

const DEFAULT_SNAP_POINTS: AppBottomSheetSnapPoint[] = ['35%', '55%', '85%'];
const OPEN_DURATION = 240;
const CLOSE_DURATION = 280;
const BACKDROP_OPEN_DURATION = 200;
const BACKDROP_CLOSE_DURATION = 180;
const DEFAULT_DRAG_CLOSE_THRESHOLD = 110;
const DEFAULT_DRAG_CLOSE_VELOCITY_THRESHOLD = 0.75;
const DEFAULT_DRAG_CLOSE_SNAP_MARGIN = 24;

function resolveSnapPoint(value: AppBottomSheetSnapPoint, sheetMaxHeight: number) {
  if (typeof value === 'string' && value.endsWith('%')) {
    const percent = Number.parseFloat(value) / 100;
    return Math.max(120, sheetMaxHeight * percent);
  }

  if (typeof value === 'number' && value <= 1) {
    return Math.max(120, sheetMaxHeight * value);
  }

  return Math.max(120, Number(value));
}

export function AppBottomSheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = DEFAULT_SNAP_POINTS,
  initialSnapPointIndex = 1,
  headerAccessory,
  contentStyle,
  dragCloseThreshold = DEFAULT_DRAG_CLOSE_THRESHOLD,
  dragCloseVelocityThreshold = DEFAULT_DRAG_CLOSE_VELOCITY_THRESHOLD,
  dragCloseSnapMargin = DEFAULT_DRAG_CLOSE_SNAP_MARGIN,
}: AppBottomSheetProps) {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(windowHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragStartTranslate = useRef(0);
  const currentTranslate = useRef(windowHeight);
  const closingRef = useRef(false);

  const sheetMaxHeight = Math.min(windowHeight * 0.9, 720);
  const resolvedSnapPoints = useMemo(
    () =>
      [...snapPoints]
        .map((point) => resolveSnapPoint(point, sheetMaxHeight))
        .sort((a, b) => a - b),
    [sheetMaxHeight, snapPoints],
  );

  const initialSnapPoint = resolvedSnapPoints[Math.min(initialSnapPointIndex, resolvedSnapPoints.length - 1)];
  const minTranslateY = sheetMaxHeight - resolvedSnapPoints[resolvedSnapPoints.length - 1];
  const maxTranslateY = sheetMaxHeight - resolvedSnapPoints[0];
  const closedTranslateY = sheetMaxHeight + insets.bottom + 24;

  const clampTranslate = (value: number) => Math.min(closedTranslateY, Math.max(minTranslateY, value));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      const targetTranslate = sheetMaxHeight - initialSnapPoint;
      currentTranslate.current = targetTranslate;
      translateY.setValue(closedTranslateY);
      backdropOpacity.setValue(0);

      Animated.parallel([
        Animated.timing(translateY, {
          toValue: targetTranslate,
          duration: OPEN_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: BACKDROP_OPEN_DURATION,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!mounted) {
      return;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: closedTranslateY,
        duration: CLOSE_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: BACKDROP_CLOSE_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [
    backdropOpacity,
    closedTranslateY,
    initialSnapPoint,
    mounted,
    sheetMaxHeight,
    translateY,
    visible,
  ]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose, visible]);

  const closeSheet = () => {
    if (!mounted || closingRef.current) {
      return;
    }

    closingRef.current = true;
    currentTranslate.current = closedTranslateY;
    onClose();
  };

  const snapToNearestPoint = (currentValue: number) => {
    let target = resolvedSnapPoints[0];
    let targetDistance = Number.POSITIVE_INFINITY;

    for (const point of resolvedSnapPoints) {
      const pointTranslate = sheetMaxHeight - point;
      const distance = Math.abs(pointTranslate - currentValue);
      if (distance < targetDistance) {
        targetDistance = distance;
        target = point;
      }
    }

    const targetTranslate = sheetMaxHeight - target;
    currentTranslate.current = targetTranslate;
    Animated.spring(translateY, {
      toValue: targetTranslate,
      useNativeDriver: true,
      bounciness: 0,
      speed: 16,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_: GestureResponderEvent, gestureState: PanResponderGestureState) =>
          Math.abs(gestureState.dy) > 2,
        onPanResponderGrant: () => {
          dragStartTranslate.current = currentTranslate.current;
        },
        onPanResponderMove: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
          const nextValue = clampTranslate(dragStartTranslate.current + gestureState.dy);
          currentTranslate.current = nextValue;
          translateY.setValue(nextValue);
        },
        onPanResponderRelease: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
          const shouldClose =
            gestureState.vy > dragCloseVelocityThreshold ||
            gestureState.dy > dragCloseThreshold ||
            currentTranslate.current > maxTranslateY + dragCloseSnapMargin;

          if (shouldClose) {
            closeSheet();
            return;
          }

          snapToNearestPoint(currentTranslate.current);
        },
      }),
    [closedTranslateY, dragCloseThreshold, dragCloseVelocityThreshold, dragCloseSnapMargin, translateY, maxTranslateY],
  );

  if (!mounted) {
    return null;
  }

  const backdrop = backdropOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.18],
  });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal}>
        <Pressable accessibilityRole="button" onPress={closeSheet} style={styles.backdropPressable}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: theme.colors.textPrimary,
                opacity: backdrop,
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
              height: sheetMaxHeight,
              transform: [{ translateY }],
            },
          ]}>
          <SafeAreaView edges={['bottom']} style={styles.safeArea}>
            <View {...panResponder.panHandlers} style={styles.handleRegion} accessibilityRole="adjustable">
              <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
            </View>

            {title || headerAccessory ? (
              <View style={styles.header}>
                <View style={styles.headerTitle}>
                  {title ? (
                    <AppText variant="sectionTitle" style={styles.title}>
                      {title}
                    </AppText>
                  ) : null}
                </View>
                {headerAccessory ? <View>{headerAccessory}</View> : null}
              </View>
            ) : null}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.content,
                {
                  paddingHorizontal: theme.spacing.lg,
                  paddingBottom: insets.bottom + theme.spacing.lg,
                },
                contentStyle,
              ]}>
              {children}
            </ScrollView>
          </SafeAreaView>
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 28,
    shadowOffset: {
      width: 0,
      height: -6,
    },
    elevation: 14,
  },
  safeArea: {
    flex: 1,
  },
  handleRegion: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
  },
  title: {
    marginTop: 0,
    textAlign: 'left',
    fontSize: 20,
    lineHeight: 24,
  },
  content: {
    gap: 12,
  },
});
