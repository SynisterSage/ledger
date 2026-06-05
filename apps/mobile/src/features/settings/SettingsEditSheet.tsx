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

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

export type SettingsEditSheetMode = 'display_name' | 'password';

type SettingsEditSheetProps = {
  visible: boolean;
  mode: SettingsEditSheetMode | null;
  initialDisplayName: string;
  onClose: () => void;
  onSaveDisplayName: (displayName: string) => Promise<void>;
  onSavePassword: (password: string) => Promise<void>;
};

const SHEET_MAX_HEIGHT = 470;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;

export function SettingsEditSheet({
  visible,
  mode,
  initialDisplayName,
  onClose,
  onSaveDisplayName,
  onSavePassword,
}: SettingsEditSheetProps) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const [mounted, setMounted] = useState(visible);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!visible) {
      return;
    }

    setDisplayName(initialDisplayName);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setIsSaving(false);
  }, [initialDisplayName, visible, mode]);

  const title = useMemo(() => (mode === 'password' ? 'Security' : 'Display name'), [mode]);

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

  const handleSave = async () => {
    if (isSaving) return;

    if (mode === 'display_name') {
      const trimmed = displayName.trim();
      if (!trimmed) {
        setError('Enter a display name.');
        return;
      }

      setError(null);
      setIsSaving(true);
      try {
        await onSaveDisplayName(trimmed);
        closeSheet();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Unable to update your name.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (!password) {
      setError('Enter a new password.');
      return;
    }

    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSavePassword(password);
      closeSheet();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update your password.');
    } finally {
      setIsSaving(false);
    }
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
            accessibilityLabel="Dismiss settings editor">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <AppText variant="body" style={styles.headerTitle}>
              {title}
            </AppText>
          </View>

          <View style={styles.content}>
            <View style={{ gap: theme.spacing.lg }}>
              {mode === 'display_name' ? (
                <>
                  <View style={{ gap: theme.spacing.xs }}>
                    <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                      Your name as it appears in Ledger.
                    </AppText>
                    <AppText variant="body" style={{ color: theme.colors.textMuted }}>
                      This updates your profile name on this account.
                    </AppText>
                  </View>

                  <AppTextInput
                    label="Display name"
                    placeholder="Lex Ferguson"
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </>
              ) : (
                <>
                  <View style={{ gap: theme.spacing.xs }}>
                    <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                      Change your account password.
                    </AppText>
                    <AppText variant="body" style={{ color: theme.colors.textMuted }}>
                      Use a password you do not use elsewhere.
                    </AppText>
                  </View>

                  <AppTextInput
                    label="New password"
                    placeholder="••••••••"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                  />
                  <AppTextInput
                    label="Confirm password"
                    placeholder="••••••••"
                    secureTextEntry
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                  />
                </>
              )}

              {error ? (
                <AppText variant="caption" style={{ color: theme.colors.danger }}>
                  {error}
                </AppText>
              ) : null}
            </View>

            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xl, paddingTop: theme.spacing.sm }}>
              <AppButton
                title={isSaving ? 'Saving...' : mode === 'password' ? 'Save password' : 'Save name'}
                onPress={handleSave}
                disabled={isSaving}
                size="lg"
              />
              <AppButton title="Cancel" variant="secondary" onPress={closeSheet} disabled={isSaving} size="lg" />
            </View>
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
    paddingTop: 4,
    paddingBottom: 8,
    minHeight: 44,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
});
