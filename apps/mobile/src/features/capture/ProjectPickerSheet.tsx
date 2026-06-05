import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { useLedgerTheme } from '@/theme';
import type { MobileProjectOption } from '@/types/ledger';

type ProjectPickerSheetProps = {
  visible: boolean;
  projects: MobileProjectOption[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onClose: () => void;
  loading?: boolean;
  title?: string;
  footer?: ReactNode;
};

const SHEET_MAX_HEIGHT = 470;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;

export function ProjectPickerSheet({
  visible,
  projects,
  selectedProjectId,
  onSelect,
  onClose,
  loading = false,
  title = 'Project',
  footer,
}: ProjectPickerSheetProps) {
  const theme = useLedgerTheme();
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
  }, [backdropProgress, dragY, progress, visible]);

  const closeSheet = () => {
    if (!mounted || closingRef.current) return;

    closingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
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

  const handleSelect = (projectId: string | null) => {
    onSelect(projectId);
    closeSheet();
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
            closeSheet();
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
      <View style={styles.portal}>
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
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}>
          <View
            {...panResponder.panHandlers}
            style={styles.handleHitArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Dismiss project picker">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <AppText variant="body" style={styles.headerTitle}>
              {title}
            </AppText>
          </View>

          <View style={styles.list}>
            {loading ? (
              <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                Loading projects...
              </AppText>
            ) : (
              <>
                <Pressable
                  onPress={() => handleSelect(null)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderBottomColor: theme.colors.borderSubtle,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}>
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong">No project</AppText>
                    <AppText variant="meta">Keep this capture unlinked</AppText>
                  </View>
                </Pressable>
                {projects.length ? (
                  projects.map((project) => (
                    <Pressable
                      key={project.id}
                      onPress={() => handleSelect(project.id)}
                      style={({ pressed }) => [
                        styles.row,
                        {
                          borderBottomColor: theme.colors.borderSubtle,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}>
                      <View style={styles.rowText}>
                        <AppText variant="bodyStrong">{project.name}</AppText>
                        <AppText variant="meta">{project.description ?? project.status ?? undefined}</AppText>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <AppText variant="meta" style={{ paddingVertical: theme.spacing.md }}>
                    No projects in this workspace yet.
                  </AppText>
                )}
              </>
            )}

            {footer ? <>{footer}</> : null}
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
    paddingTop: 20,
    paddingBottom: 28,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  rowText: {
    gap: 2,
  },
});
