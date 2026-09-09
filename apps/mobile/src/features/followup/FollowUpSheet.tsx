import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { createMobileTask } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import { resolveCaptureWorkspaceId, useWorkspaceState } from '@/store/workspaceStore';
import { useAppPreferencesState } from '@/store/appPreferencesStore';

import type { FollowUpSheetDraft } from './FollowUpSheetContext';

type FollowUpSheetProps = {
  visible: boolean;
  draft: FollowUpSheetDraft | null;
  onClose: () => void;
};

const SHEET_DRAG_CLOSE_THRESHOLD = 48;
const SHEET_BOTTOM_BUFFER = 24;
const OPEN_DURATION = 220;
const CLOSE_DURATION = 180;
const BACKDROP_OPEN_DURATION = 220;
const BACKDROP_CLOSE_DURATION = 120;

function deriveNotesPayload(draft: FollowUpSheetDraft | null, notes: string) {
  const trimmedNotes = notes.trim();

  if (draft?.sourceType === 'calendar_event' && draft.sourceId) {
    const sourceTitle = draft.sourceTitle?.trim() || draft.title.replace(/^Follow up:\s*/i, '').trim() || draft.title.trim();
    const prefix = `Follow-up from calendar: ${sourceTitle}`;
    return trimmedNotes ? `${prefix}\n\n${trimmedNotes}` : prefix;
  }

  return trimmedNotes || null;
}

function deriveDescription(draft: FollowUpSheetDraft | null) {
  if (draft?.sourceType === 'calendar_event' && draft.sourceId) {
    return `calendar_followup:${draft.sourceId}`;
  }

  return 'follow_up';
}

export function FollowUpSheet({ visible, draft, onClose }: FollowUpSheetProps) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const appPreferences = useAppPreferencesState();
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const workspaceState = useWorkspaceState();
  const defaultWorkspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const [title, setTitle] = useState(draft?.title ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [workspaceId, setWorkspaceId] = useState(draft?.workspaceId ?? defaultWorkspaceId);
  const [projectId, setProjectId] = useState<string | null>(draft?.projectId ?? null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      dragY.setValue(0);
      setTitle(draft?.title ?? '');
      setNotes(draft?.notes ?? '');
      setWorkspaceId(draft?.workspaceId ?? defaultWorkspaceId);
      setProjectId(draft?.projectId ?? null);
      setError(null);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduceMotionEnabled ? 1 : OPEN_DURATION,
        useNativeDriver: true,
      }).start();
      Animated.timing(backdropProgress, {
        toValue: 1,
        duration: reduceMotionEnabled ? 1 : BACKDROP_OPEN_DURATION,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotionEnabled ? 1 : CLOSE_DURATION,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: reduceMotionEnabled ? 1 : BACKDROP_CLOSE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [backdropProgress, defaultWorkspaceId, draft, dragY, progress, reduceMotionEnabled, visible]);

  const closeSheet = useCallback(() => {
    if (!mounted || closingRef.current) return;

    closingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : BACKDROP_CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: reduceMotionEnabled ? 1 : CLOSE_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  }, [backdropProgress, dragY, mounted, onClose, progress, reduceMotionEnabled]);

  const handleSave = async () => {
    if (!title.trim() || workspaceId === 'all') {
      setError('Choose a workspace and enter a title.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createMobileTask(workspaceId, {
        title: title.trim(),
        notes: deriveNotesPayload(draft, notes),
        description: deriveDescription(draft),
        project_id: projectId,
        due_date: null,
        due_time: null,
        status: 'todo',
        priority: 'medium',
        show_in_today: true,
        is_today_focus: false,
        source: 'follow_up',
        sourcePlatform: 'ios',
      });
      draft?.onSaved?.();
      closeSheet();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save follow-up.');
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = Boolean(title.trim()) && workspaceId !== 'all';
  const sheetHeight = Math.min(windowHeight * 0.72, 660);
  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [sheetHeight + SHEET_BOTTOM_BUFFER, 0],
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
            speed: reduceMotionEnabled ? 24 : 16,
          }).start();
        },
      }),
    [closeSheet, dragY, reduceMotionEnabled],
  );

  if (!mounted) {
    return null;
  }

  const backdropOpacity = backdropProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.14],
  });

  const selectedProjectName = projectId
    ? projects.find((project) => project.id === projectId)?.name ?? 'No project'
    : 'No project';

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal} pointerEvents="box-none">
        <Pressable accessibilityRole="button" onPress={closeSheet} style={styles.backdropPressable}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: theme.colors.backdrop,
                opacity: Animated.multiply(backdropOpacity, progress),
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
              marginHorizontal: theme.spacing.sheetInset,
              marginBottom: Math.max(theme.spacing.xs, insets.bottom - theme.spacing.md),
              borderRadius: theme.radius.sheet,
              height: sheetHeight,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}>
          <View
            {...panResponder.panHandlers}
            style={styles.handleHitArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Dismiss follow-up sheet">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="body" style={styles.headerTitle}>
                Add follow-up
              </AppText>
              {draft?.sourceLabel ? (
                <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                  {draft.sourceLabel}
                </AppText>
              ) : null}
            </View>
          </View>

          <CaptureFormShell
            footer={
              <AppButton
                title={isSaving ? 'Saving…' : 'Save follow-up'}
                size="lg"
                disabled={!canSave || isSaving}
                onPress={handleSave}
              />
            }
            footerBottomPadding={theme.spacing.md}
            contentStyle={{
              paddingTop: 0,
              paddingBottom: theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
            }}>
            <View style={{ gap: theme.spacing.lg }}>
              <AppTextInput
                label="Title"
                labelVariant="body"
                placeholder="What needs to happen next?"
                value={title}
                onChangeText={setTitle}
              />

              <AppTextInput
                label="Notes"
                labelVariant="body"
                placeholder="Add context or details"
                value={notes}
                onChangeText={setNotes}
                multiline
              />

              <Row
                title="Project"
                subtitle={selectedProjectName}
                onPress={() => setProjectPickerOpen(true)}
                right={<SymbolView name="chevron.down" size={14} weight="regular" tintColor={theme.colors.textSecondary} />}
                titleVariant="body"
              />

              {error ? (
                <AppText variant="meta" style={{ color: theme.colors.danger }}>
                  {error}
                </AppText>
              ) : null}
            </View>
          </CaptureFormShell>
        </Animated.View>
      </View>

      <ProjectPickerSheet
        visible={projectPickerOpen}
        projects={projects}
        selectedProjectId={projectId}
        onSelect={setProjectId}
        onClose={() => setProjectPickerOpen(false)}
        loading={projectsLoading}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  portal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  backdrop: {
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
    paddingTop: 10,
    paddingBottom: 12,
    minHeight: 48,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 24,
  },
});
