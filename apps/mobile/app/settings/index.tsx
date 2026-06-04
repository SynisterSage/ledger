import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { signOut, updateDisplayName, updatePassword } from '@/api/auth';
import {
  defaultMobileNotificationPreferences,
  getMobileUserSettings,
  readMobileNotificationPreferences,
  updateMobileUserSettings,
} from '@/api/userSettings';
import { AppText } from '@/components/AppText';
import { Section } from '@/components/Section';
import { SettingsRow } from '@/components/SettingsRow';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { SettingsEditSheet, type SettingsEditSheetMode } from '@/features/settings/SettingsEditSheet';
import { useAuthState } from '@/store/sessionStore';
import {
  bootstrapWorkspaceState,
  getWorkspaceLabel,
  setDefaultCaptureWorkspace,
  setRememberLastWorkspace,
  setTodayScopeWorkspace,
  useWorkspaceState,
} from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

const mockProfile = {
  version: '1.0.0',
};

const HEADER_COLLAPSE_DISTANCE = 64;
const HEADER_TRANSLATE_DISTANCE = 36;
const HEADER_SCROLL_SPACE = 150;

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuthState();
  const workspaceState = useWorkspaceState();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [notificationPrefs, setNotificationPrefs] = useState(defaultMobileNotificationPreferences);
  const [notificationPrefsLoading, setNotificationPrefsLoading] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [sheetMode, setSheetMode] = useState<SettingsEditSheetMode | null>(null);
  const [workspaceSheetTarget, setWorkspaceSheetTarget] = useState<'default_capture' | 'today_scope' | null>(null);

  const switchTrackColor = useMemo(
    () => ({
      false: theme.colors.borderSubtle,
      true: theme.colors.accent,
    }),
    [theme.colors.accent, theme.colors.borderSubtle],
  );

  const displayName =
    auth.user?.user_metadata?.full_name ||
    auth.user?.user_metadata?.name ||
    auth.user?.email?.split('@')[0] ||
    'Ledger user';
  const email = auth.user?.email || 'Not signed in';
  const defaultCaptureWorkspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.defaultCaptureWorkspaceId, workspaceState.options),
    [workspaceState.defaultCaptureWorkspaceId, workspaceState.options],
  );
  const todayScopeWorkspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.todayScopeWorkspaceId, workspaceState.options),
    [workspaceState.todayScopeWorkspaceId, workspaceState.options],
  );
  const captureWorkspaceOptions = useMemo(() => {
    const filtered = workspaceState.options.filter((option) => option.id !== 'all');
    return filtered.length ? filtered : workspaceState.options;
  }, [workspaceState.options]);

  useEffect(() => {
    setSheetMode(null);
  }, [auth.user?.id]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadNotificationPreferences = async () => {
      setNotificationPrefsLoading(true);

      try {
        const settings = await getMobileUserSettings();
        if (cancelled) return;
        setNotificationPrefs(readMobileNotificationPreferences(settings));
      } catch {
        if (!cancelled) {
          setNotificationPrefs(defaultMobileNotificationPreferences);
        }
      } finally {
        if (!cancelled) {
          setNotificationPrefsLoading(false);
        }
      }
    };

    void loadNotificationPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/auth/welcome');
    } catch {
      Alert.alert('Unable to sign out', 'Please try again.');
    }
  };

  const openDisplayNameSheet = () => setSheetMode('display_name');
  const openPasswordSheet = () => setSheetMode('password');
  const openWorkspaceSheet = (target: 'default_capture' | 'today_scope') => {
    if (workspaceState.isLoading) return;
    setWorkspaceSheetTarget(target);
  };

  const patchNotificationPreferences = async (
    nextPreferences: typeof defaultMobileNotificationPreferences,
  ) => {
    setNotificationPrefs(nextPreferences);

    try {
      await updateMobileUserSettings({
        preferences: {
          mobileNotificationPreferences: nextPreferences,
        },
      });
    } catch {
      Alert.alert(
        'Could not save notifications',
        'You can change this later in Settings.',
      );
    }
  };

  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, -HEADER_TRANSLATE_DISTANCE],
    extrapolate: 'clamp',
  });
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE - 8, HEADER_COLLAPSE_DISTANCE],
    outputRange: [1, 0.32, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: pressed ? theme.colors.selectedSurface : 'transparent',
              },
            ]}>
            <SymbolView
              name="chevron.left"
              size={18}
              weight="regular"
              tintColor={theme.colors.textPrimary}
            />
          </Pressable>

          <AppText variant="screenTitle" style={styles.headerTitle}>
            Settings
          </AppText>

          <View style={styles.headerSpacer} />
        </View>

      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: HEADER_SCROLL_SPACE + insets.top * 0.15,
            paddingHorizontal: theme.spacing.screenX,
            paddingBottom: theme.spacing['3xl'] + 96,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.sections}>
          <Section title="Account">
            <View style={[styles.identityBlock, { borderBottomColor: theme.colors.borderSubtle }]}>
              <AppText variant="bodyStrong">{displayName}</AppText>
              <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                {email}
              </AppText>
            </View>
            <SettingsRow
              title="Display name"
              subtitle="Your name as it appears in Ledger."
              value={displayName}
              chevron
              onPress={openDisplayNameSheet}
            />
            <SettingsRow title="Email" subtitle="Used for signing in." value={email} />
            <SettingsRow
              title="Security"
              subtitle="Change your account password."
              chevron
              onPress={openPasswordSheet}
            />
          </Section>

          <Section title="Workspace">
            <SettingsRow
              title="Default capture workspace"
              value={workspaceState.isLoading ? 'Loading workspaces…' : defaultCaptureWorkspaceLabel}
              chevron
              onPress={() => openWorkspaceSheet('default_capture')}
            />
            <SettingsRow
              title="Today scope"
              value={workspaceState.isLoading ? 'Loading workspaces…' : todayScopeWorkspaceLabel}
              chevron
              onPress={() => openWorkspaceSheet('today_scope')}
            />
            <SettingsRow
              title="Remember last used workspace"
                right={
                  <Switch
                  value={workspaceState.rememberLastWorkspace}
                  onValueChange={setRememberLastWorkspace}
                    trackColor={switchTrackColor}
                    thumbColor={theme.colors.surface}
                  />
                }
            />
          </Section>

          <Section title="Notifications">
            <SettingsRow
              title="Push notifications"
              right={
                <Switch
                  value={notificationPrefs.pushNotifications}
                  onValueChange={(value) =>
                    void patchNotificationPreferences({
                      ...notificationPrefs,
                      pushNotifications: value,
                    })
                  }
                  disabled={notificationPrefsLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Reminders"
              right={
                <Switch
                  value={notificationPrefs.remindersEnabled}
                  onValueChange={(value) =>
                    void patchNotificationPreferences({
                      ...notificationPrefs,
                      remindersEnabled: value,
                    })
                  }
                  disabled={notificationPrefsLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Events"
              right={
                <Switch
                  value={notificationPrefs.eventsEnabled}
                  onValueChange={(value) =>
                    void patchNotificationPreferences({
                      ...notificationPrefs,
                      eventsEnabled: value,
                    })
                  }
                  disabled={notificationPrefsLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Project actions"
              right={
                <Switch
                  value={notificationPrefs.projectActionsEnabled}
                  onValueChange={(value) =>
                    void patchNotificationPreferences({
                      ...notificationPrefs,
                      projectActionsEnabled: value,
                    })
                  }
                  disabled={notificationPrefsLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Overdue items"
              right={
                <Switch
                  value={notificationPrefs.overdueItemsEnabled}
                  onValueChange={(value) =>
                    void patchNotificationPreferences({
                      ...notificationPrefs,
                      overdueItemsEnabled: value,
                    })
                  }
                  disabled={notificationPrefsLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
          </Section>

          <Section title="Capture">
            <SettingsRow title="Shared items" value="Save to Inbox" chevron />
            <SettingsRow title="Default capture type" value="Reminder" chevron />
            <SettingsRow title="Siri Shortcuts" value="Coming soon" />
            <SettingsRow title="Share Sheet" value="Coming soon" />
          </Section>

          <Section title="App">
            <SettingsRow title="Appearance" value="System" chevron />
            <SettingsRow
              title="Haptics"
              right={
                <Switch
                  value={hapticsEnabled}
                  onValueChange={setHapticsEnabled}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Reduce motion"
              right={
                <Switch
                  value={reduceMotionEnabled}
                  onValueChange={setReduceMotionEnabled}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
          </Section>

          <Section title="About">
            <SettingsRow title="Help" chevron onPress={() => Alert.alert('Coming soon', 'Help will live here later.')} />
            <SettingsRow title="Privacy Policy" chevron onPress={() => Alert.alert('Coming soon', 'Privacy policy will open later.')} />
            <SettingsRow title="Terms" chevron onPress={() => Alert.alert('Coming soon', 'Terms will open later.')} />
            <SettingsRow title="Version" value={mockProfile.version} />
          </Section>

          <Section>
            <SettingsRow title="Sign out" destructive onPress={handleSignOut} />
          </Section>
        </View>
      </Animated.ScrollView>

      <SettingsEditSheet
        visible={sheetMode !== null}
        mode={sheetMode}
        initialDisplayName={displayName}
        onClose={() => setSheetMode(null)}
        onSaveDisplayName={updateDisplayName}
        onSavePassword={updatePassword}
      />

      <WorkspaceSelectorSheet
        visible={workspaceSheetTarget !== null}
        selectedWorkspaceId={
          workspaceSheetTarget === 'default_capture'
            ? workspaceState.defaultCaptureWorkspaceId
            : workspaceState.todayScopeWorkspaceId
        }
        workspaces={
          workspaceSheetTarget === 'default_capture'
            ? captureWorkspaceOptions
            : workspaceState.options
        }
        onSelect={(workspaceId) => {
          if (workspaceSheetTarget === 'default_capture') {
            setDefaultCaptureWorkspace(workspaceId);
          } else if (workspaceSheetTarget === 'today_scope') {
            setTodayScopeWorkspace(workspaceId);
          }
          setWorkspaceSheetTarget(null);
        }}
        onClose={() => setWorkspaceSheetTarget(null)}
      />
    </View>
  );
}

const styles = {
  screen: {
    flex: 1,
  },
  header: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 10,
    zIndex: 5,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center' as const,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  subcopy: {
    marginTop: 8,
    maxWidth: 320,
  },
  scrollContent: {
    flexGrow: 1,
  },
  sections: {
    gap: 28,
  },
  identityBlock: {
    gap: 2,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
} as const;
