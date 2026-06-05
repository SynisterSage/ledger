import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

export type AppDetailSheetMetaRow = {
  label?: string;
  value: string;
};

export type AppDetailSheetAction = {
  id: string;
  label: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
};

type AppDetailSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  meta?: AppDetailSheetMetaRow[];
  body?: string;
  actions?: AppDetailSheetAction[];
  onAction?: (actionId: string) => void;
  onClose: () => void;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

const OPEN_DURATION = 220;
const CLOSE_DURATION = 180;
const BACKDROP_OPEN_DURATION = 200;
const BACKDROP_CLOSE_DURATION = 120;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;

export function AppDetailSheet({
  visible,
  title,
  subtitle,
  meta,
  body,
  actions = [],
  onAction,
  onClose,
  footer,
  contentStyle,
}: AppDetailSheetProps) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const sheetMaxHeight = Math.min(windowHeight * 0.92, windowHeight - insets.top - 12);
  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [sheetMaxHeight, 0],
    }),
    dragY,
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      dragY.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_DURATION,
        useNativeDriver: true,
      }).start();
      Animated.timing(backdropProgress, {
        toValue: 1,
        duration: BACKDROP_OPEN_DURATION,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_DURATION,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: BACKDROP_CLOSE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [backdropProgress, dragY, progress, visible]);

  const closeSheet = () => {
    if (!mounted || closingRef.current) return;

    closingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: BACKDROP_CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: CLOSE_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const safeActions = actions.filter((action) => action.variant !== 'danger');
  const dangerActions = actions.filter((action) => action.variant === 'danger');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_: GestureResponderEvent, gestureState: PanResponderGestureState) =>
        Math.abs(gestureState.dy) > 2,
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
          speed: 18,
        }).start();
      },
    }),
  ).current;

  if (!mounted) {
    return null;
  }

  const backdropOpacity = backdropProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.16],
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
                opacity: backdropOpacity,
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
            <View style={styles.headerText}>
              <AppText variant="sectionTitle" style={styles.title}>
                {title}
              </AppText>
              {subtitle ? (
                <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>

            
          </View>

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
            <View style={{ gap: theme.spacing.md }}>
              {meta?.length ? (
                <View
                  style={[
                    styles.metaGroup,
                    {
                      borderTopColor: theme.colors.borderSubtle,
                      borderBottomColor: theme.colors.borderSubtle,
                    },
                  ]}>
                  {meta.map((item, index) => (
                    <View
                      key={`${item.label ?? 'meta'}-${index}`}
                      style={[
                        styles.metaRow,
                        index === meta.length - 1 ? styles.metaRowLast : null,
                        { borderBottomColor: theme.colors.borderSubtle },
                      ]}>
                      {item.label ? (
                        <AppText variant="caption" style={{ color: theme.colors.textMuted }}>
                          {item.label}
                        </AppText>
                      ) : null}
                      <AppText variant="body" style={{ color: theme.colors.textPrimary }}>
                        {item.value}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : null}

              {body ? (
                <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                  {body}
                </AppText>
              ) : null}

              {safeActions.length ? (
                <View style={styles.actionsGroup}>
                  {safeActions.map((action) => (
                    <Pressable
                      key={action.id}
                      accessibilityRole="button"
                      disabled={action.disabled}
                      onPress={() => onAction?.(action.id)}
                      style={({ pressed }) => [
                        styles.actionRow,
                        {
                          borderBottomColor: theme.colors.borderSubtle,
                          opacity: action.disabled ? 0.4 : pressed ? 0.72 : 1,
                        },
                      ]}>
                      <AppText
                        variant="body"
                        style={[
                          styles.actionLabel,
                          action.variant === 'primary' ? styles.actionLabelPrimary : null,
                          action.variant === 'danger' ? styles.actionLabelDanger : null,
                        ]}>
                        {action.label}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {dangerActions.length ? (
                <View style={styles.dangerActionsGroup}>
                  {dangerActions.map((action) => (
                    <Pressable
                      key={action.id}
                      accessibilityRole="button"
                      disabled={action.disabled}
                      onPress={() => onAction?.(action.id)}
                      style={({ pressed }) => [
                        styles.actionRow,
                        {
                          borderBottomColor: theme.colors.borderSubtle,
                          opacity: action.disabled ? 0.4 : pressed ? 0.72 : 1,
                        },
                      ]}>
                      <AppText variant="body" style={[styles.actionLabel, styles.actionLabelDanger]}>
                        {action.label}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {footer ? <>{footer}</> : null}
            </View>
          </ScrollView>
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
  },
  handleHitArea: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    minHeight: 56,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
    letterSpacing: 0,
  },
  closeButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  content: {
    gap: 12,
  },
  metaGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaRow: {
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  metaRowLast: {
    borderBottomWidth: 0,
  },
  actionsGroup: {
    marginTop: 4,
  },
  dangerActionsGroup: {
    marginTop: -8,
  },
  actionRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  actionLabelPrimary: {
    fontWeight: '500',
  },
  actionLabelDanger: {
    fontWeight: '400',
    color: '#FF5F40',
  },
});
