import { useEffect, useMemo, useRef, useState } from 'react';
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

import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Section } from '@/components/Section';
import { createMobileNote } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import {
  resolveCaptureWorkspaceId,
  useWorkspaceState,
} from '@/store/workspaceStore';

import type { QuickNoteSheetDraft } from './QuickNoteSheetContext';

type QuickNoteSheetProps = {
  visible: boolean;
  draft: QuickNoteSheetDraft | null;
  onClose: () => void;
};

const SHEET_DRAG_CLOSE_THRESHOLD = 48;
const SHEET_BOTTOM_BUFFER = 24;

function deriveNoteTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() || trimmed;
  if (firstLine.length <= 80) {
    return firstLine;
  }

  return `${firstLine.slice(0, 77).trimEnd()}...`;
}

export function QuickNoteSheet({ visible, draft, onClose }: QuickNoteSheetProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const defaultWorkspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const [noteText, setNoteText] = useState('');
  const [workspaceId, setWorkspaceId] = useState(draft?.workspaceId ?? defaultWorkspaceId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      dragY.setValue(0);
      setNoteText('');
      setWorkspaceId(draft?.workspaceId ?? defaultWorkspaceId);
      setError(null);
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
  }, [backdropProgress, defaultWorkspaceId, dragY, draft, progress, visible]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setIsKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  const sheetHeight = Math.min(windowHeight * 0.68, 640);
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
            speed: 16,
          }).start();
        },
      }),
    [dragY],
  );

  const canSave = Boolean(noteText.trim()) && workspaceId !== 'all';

  const handleSave = async () => {
    const noteContent = noteText.trim();
    if (!noteContent || workspaceId === 'all') {
      setError('Type a note and choose a workspace.');
      return;
    }

    const title = deriveNoteTitle(noteContent);
    if (!title) {
      setError('Type a note.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createMobileNote(workspaceId, {
        title,
        content: noteContent,
        source: 'mobile',
        sourcePlatform: 'ios',
      });
      draft?.onSaved?.();
      closeSheet();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save note.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) {
    return null;
  }

  const backdropOpacity = backdropProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.14],
  });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (isKeyboardVisible) {
              Keyboard.dismiss();
              return;
            }
            closeSheet();
          }}
          style={styles.backdropPressable}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: theme.colors.textPrimary,
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
              height: sheetHeight,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}>
          <View
            {...panResponder.panHandlers}
            style={styles.handleHitArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Dismiss note sheet">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="body" style={styles.headerTitle}>
                Add note
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
              <AppButton title={isSaving ? 'Saving…' : 'Save note'} size="lg" disabled={!canSave || isSaving} onPress={handleSave} />
            }
            footerBottomPadding={theme.spacing.md}
            contentStyle={{ paddingTop: 0, paddingBottom: theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
            <Section childrenGap={theme.spacing.sm}>
              <AppTextInput
                label="Note"
                labelVariant="body"
                placeholder="Type a note"
                multiline
                value={noteText}
                onChangeText={setNoteText}
              />
              {error ? (
                <AppText variant="meta" style={{ color: theme.colors.danger }}>
                  {error}
                </AppText>
              ) : null}
            </Section>
          </CaptureFormShell>
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
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 24,
  },
});
