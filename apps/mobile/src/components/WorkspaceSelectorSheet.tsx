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
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';
import type { MobileWorkspaceScopeOption } from '@/types/ledger';

const SHEET_OFFSET = 24;
const SHEET_VERTICAL_PADDING = 16;
const SHEET_MAX_HEIGHT = 460;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;
const SHEET_BOTTOM_BUFFER = 24;
type WorkspaceSelectorSheetProps = {
  visible: boolean;
  selectedWorkspaceId: string;
  workspaces: MobileWorkspaceScopeOption[];
  onSelect: (workspaceId: string) => void;
  onClose: () => void;
};

export function WorkspaceSelectorSheet({
  visible,
  selectedWorkspaceId,
  workspaces,
  onSelect,
  onClose,
}: WorkspaceSelectorSheetProps) {
  const theme = useLedgerTheme();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      Animated.timing(backdropProgress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [dragY, progress, visible]);

  const closeSheet = () => {
    if (!mounted) return;
    if (closingRef.current) return;

    closingRef.current = true;
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  };

  const handleSelect = (workspaceId: string) => {
    onSelect(workspaceId);
    onClose();
  };

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
            Animated.timing(backdropProgress, {
              toValue: 0,
              duration: 120,
              useNativeDriver: true,
            }).start();
            Animated.spring(dragY, {
              toValue: SHEET_MAX_HEIGHT,
              useNativeDriver: true,
              bounciness: 0,
            }).start(() => {
              closeSheet();
            });
            return;
          }

          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [closeSheet, dragY],
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
            accessibilityLabel="Dismiss workspace selector">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>
          <View style={styles.header}>
            <AppText variant="sectionTitle">Workspace</AppText>
          </View>

          <View style={styles.list}>
            {workspaces.map((option, index) => {
              const selected = option.id === selectedWorkspaceId;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.name}${selected ? ', selected' : ''}`}
                  onPress={() => handleSelect(option.id)}
                  style={[
                    styles.row,
                    index === workspaces.length - 1 ? styles.rowLast : styles.rowBorder,
                    { borderBottomColor: theme.colors.borderSubtle },
                  ]}>
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong">{option.name}</AppText>
                    {option.subtitle ? <AppText variant="meta">{option.subtitle}</AppText> : null}
                  </View>
                  {selected ? (
                    <SymbolView
                      name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                      size={14}
                      weight="regular"
                      tintColor={theme.colors.accent}
                    />
                  ) : null}
                </Pressable>
              );
            })}
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
});
