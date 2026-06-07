import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { createMobileTask } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import { getWorkspaceLabel, resolveCaptureWorkspaceId, setDefaultCaptureWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { useAppPreferencesState } from '@/store/appPreferencesStore';

import type { FollowUpSheetDraft } from './FollowUpSheetContext';

type FollowUpSheetProps = {
  visible: boolean;
  draft: FollowUpSheetDraft | null;
  onClose: () => void;
};

const CLOSE_DURATION = 180;
const BACKDROP_CLOSE_DURATION = 120;
const OPEN_DURATION = 220;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;

function getTomorrowDefaults() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return {
    dueDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`,
    dueTime: '09:00',
  };
}

export function FollowUpSheet({ visible, draft, onClose }: FollowUpSheetProps) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const workspaceState = useWorkspaceState();
  const defaultWorkspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const [title, setTitle] = useState(draft?.title ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [workspaceId, setWorkspaceId] = useState(draft?.workspaceId ?? defaultWorkspaceId);
  const [projectId, setProjectId] = useState<string | null>(draft?.projectId ?? null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const { height: windowHeight } = useWindowDimensions();

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
        duration: reduceMotionEnabled ? 1 : OPEN_DURATION,
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

  const closeSheet = () => {
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
  };

  const canSave = Boolean(title.trim()) && workspaceId !== 'all';
  const sheetMaxHeight = Math.min(windowHeight * 0.9, windowHeight - 12);
  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [sheetMaxHeight, 0],
    }),
    dragY,
  );

  const panResponder = useMemo(
    () =>
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
            speed: reduceMotionEnabled ? 24 : 18,
          }).start();
        },
      }),
    [dragY, reduceMotionEnabled],
  );

  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceId, workspaceState.options),
    [workspaceId, workspaceState.options],
  );

  const handleSave = async () => {
    if (!title.trim() || workspaceId === 'all') {
      setError('Choose a workspace and enter a title.');
      return;
    }

    const { dueDate, dueTime } = getTomorrowDefaults();
    const sourceLabel = draft?.sourceLabel?.trim() ?? null;
    const normalizedSourceLabel =
      sourceLabel?.toLowerCase().startsWith('from ') ? sourceLabel.slice(5).trim() : sourceLabel;

    setIsSaving(true);
    setError(null);

    try {
      await createMobileTask(workspaceId, {
        title: title.trim(),
        notes: notes.trim() || null,
        description: normalizedSourceLabel ? `Follow-up from ${normalizedSourceLabel}` : 'Follow-up',
        project_id: projectId,
        due_date: dueDate,
        due_time: dueTime,
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
            accessibilityLabel="Dismiss follow-up sheet">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerText}>
              <AppText variant="sectionTitle" style={styles.title}>
                Add follow-up
              </AppText>
              <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                Save a task to Ledger.
              </AppText>
            </View>
            <AppButton
              title="Close"
              variant="ghost"
              fullWidth={false}
              onPress={closeSheet}
            />
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              {
                paddingHorizontal: theme.spacing.lg,
                paddingBottom: theme.spacing.lg + 28,
              },
            ]}>
            <View style={{ gap: theme.spacing.md }}>
              {draft?.sourceLabel ? (
                <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                  {draft.sourceLabel}
                </AppText>
              ) : null}

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

              <View style={{ gap: theme.spacing.xs }}>
                <AppText variant="body">Workspace</AppText>
                <View
                  style={[
                    styles.rowShell,
                    {
                      borderColor: theme.colors.borderSubtle,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setWorkspacePickerOpen(true)}
                    style={styles.rowPressable}>
                    <View style={styles.rowText}>
                      <AppText variant="bodyStrong">{workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel}</AppText>
                      <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                        Change where this saves
                      </AppText>
                    </View>
                    <SymbolView
                      name="chevron.down"
                      size={14}
                      weight="regular"
                      tintColor={theme.colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={{ gap: theme.spacing.xs }}>
                <AppText variant="body">Project</AppText>
                <View
                  style={[
                    styles.rowShell,
                    {
                      borderColor: theme.colors.borderSubtle,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setProjectPickerOpen(true)}
                    style={styles.rowPressable}>
                    <View style={styles.rowText}>
                      <AppText variant="bodyStrong">
                        {projectId
                          ? projects.find((project) => project.id === projectId)?.name ?? 'No project'
                          : 'No project'}
                      </AppText>
                      <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                        Optional
                      </AppText>
                    </View>
                    <SymbolView
                      name="chevron.down"
                      size={14}
                      weight="regular"
                      tintColor={theme.colors.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>

              {error ? (
                <AppText variant="meta" style={{ color: theme.colors.danger }}>
                  {error}
                </AppText>
              ) : null}
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.colors.background,
                borderTopColor: theme.colors.borderSubtle,
              },
            ]}>
            <AppButton
              title={isSaving ? 'Saving…' : 'Save follow-up'}
              size="lg"
              disabled={!canSave || isSaving}
              onPress={handleSave}
            />
          </View>
        </Animated.View>
      </View>

      <WorkspaceSelectorSheet
        visible={workspacePickerOpen}
        selectedWorkspaceId={workspaceId}
        workspaces={workspaceState.options}
        onSelect={(nextWorkspaceId) => {
          setWorkspaceId(nextWorkspaceId);
          setDefaultCaptureWorkspace(nextWorkspaceId);
        }}
        onClose={() => setWorkspacePickerOpen(false)}
      />
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
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '400',
  },
  content: {
    gap: 12,
  },
  rowShell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
  },
  rowPressable: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
});
