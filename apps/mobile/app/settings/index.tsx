import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { signOut, updateDisplayName, updatePassword } from '@/api/auth';
import {
  defaultMobileCapturePreferences,
  defaultMobileNotificationPreferences,
  getMobileUserSettings,
  readMobileCapturePreferences,
  readMobileNotificationPreferences,
  updateMobileUserSettings,
} from '@/api/userSettings';
import { AppText } from '@/components/AppText';
import { Section } from '@/components/Section';
import { SettingsRow } from '@/components/SettingsRow';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import {
  MOBILE_PAGE_HEADER_SCROLL_SPACE,
} from '@/components/MobilePageHeader';
import { SettingsEditSheet, type SettingsEditSheetMode } from '@/features/settings/SettingsEditSheet';
import { SettingsChoiceSheet } from '@/features/settings/SettingsChoiceSheet';
import { SiriShortcutsSheet } from '@/features/settings/SiriShortcutsSheet';
import {
  bootstrapAppPreferencesState,
  setHapticsEnabled,
  setReduceMotionEnabled,
  useAppPreferencesState,
} from '@/store/appPreferencesStore';
import { useAuthState } from '@/store/sessionStore';
import {
  bootstrapWorkspaceState,
  getWorkspaceLabel,
  setDefaultCaptureWorkspace,
  setDefaultSiriWorkspace,
  setRememberLastWorkspace,
  setSiriAskEveryTime,
  setTodayScopeWorkspace,
  useWorkspaceState,
} from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

const mockProfile = {
  version: '1.0.0',
};

const HEADER_COLLAPSE_DISTANCE = 64;
const HEADER_TRANSLATE_DISTANCE = 36;

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuthState();
  const workspaceState = useWorkspaceState();
  const appPreferences = useAppPreferencesState();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [notificationPrefs, setNotificationPrefs] = useState(defaultMobileNotificationPreferences);
  const [notificationPrefsLoading, setNotificationPrefsLoading] = useState(true);
  const [capturePrefs, setCapturePrefs] = useState(defaultMobileCapturePreferences);
  const [capturePrefsLoading, setCapturePrefsLoading] = useState(true);
  const [sheetMode, setSheetMode] = useState<SettingsEditSheetMode | null>(null);
  const [workspaceSheetTarget, setWorkspaceSheetTarget] = useState<'default_capture' | 'today_scope' | 'default_siri' | null>(null);
  const [captureSheetTarget, setCaptureSheetTarget] = useState<'shared_items' | 'default_type' | null>(null);
  const [siriShortcutsVisible, setSiriShortcutsVisible] = useState(false);

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
  const defaultSiriWorkspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.defaultSiriWorkspaceId, workspaceState.options),
    [workspaceState.defaultSiriWorkspaceId, workspaceState.options],
  );
  const todayScopeWorkspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.todayScopeWorkspaceId, workspaceState.options),
    [workspaceState.todayScopeWorkspaceId, workspaceState.options],
  );
  const captureWorkspaceOptions = useMemo(() => {
    const filtered = workspaceState.options.filter((option) => option.id !== 'all');
    return filtered.length ? filtered : workspaceState.options;
  }, [workspaceState.options]);
  const captureTypeLabel = useMemo(() => {
    return formatCaptureTypeLabel(capturePrefs.defaultCaptureType);
  }, [capturePrefs.defaultCaptureType]);

  useEffect(() => {
    setSheetMode(null);
  }, [auth.user?.id]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  useEffect(() => {
    void bootstrapAppPreferencesState(auth.user?.id ?? null);
  }, [auth.user?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadNotificationPreferences = async () => {
      setNotificationPrefsLoading(true);
      setCapturePrefsLoading(true);

      try {
        const settings = await getMobileUserSettings();
        if (cancelled) return;
        setNotificationPrefs(readMobileNotificationPreferences(settings));
        setCapturePrefs(readMobileCapturePreferences(settings));
      } catch {
        if (!cancelled) {
          setNotificationPrefs(defaultMobileNotificationPreferences);
          setCapturePrefs(defaultMobileCapturePreferences);
        }
      } finally {
        if (!cancelled) {
          setNotificationPrefsLoading(false);
          setCapturePrefsLoading(false);
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

  const openLegalLink = async (path: 'docs' | 'privacy' | 'terms' | 'whats-new') => {
    try {
      await WebBrowser.openBrowserAsync(`https://ledgerworkspace.com/${path}`, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
      });
    } catch {
      Alert.alert('Could not open link', 'Please try again.');
    }
  };

  const openDisplayNameSheet = () => setSheetMode('display_name');
  const openPasswordSheet = () => setSheetMode('password');
  const openWorkspaceSheet = (target: 'default_capture' | 'today_scope' | 'default_siri') => {
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

  const patchCapturePreferences = async (nextPreferences: typeof defaultMobileCapturePreferences) => {
    const previousPreferences = capturePrefs;
    setCapturePrefs(nextPreferences);

    try {
      await updateMobileUserSettings({
        preferences: {
          mobileCapturePreferences: nextPreferences,
        },
      });
    } catch {
      setCapturePrefs(previousPreferences);
      Alert.alert('Could not save capture settings', 'You can change this later in Settings.');
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
            paddingTop: MOBILE_PAGE_HEADER_SCROLL_SPACE,
            paddingHorizontal: theme.spacing.screenX,
            paddingBottom: theme.spacing['3xl'] + 96,
            flexGrow: 1,
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
            <SettingsRow
              title="Shared items"
              value={
                capturePrefsLoading
                  ? 'Loading...'
                  : capturePrefs.sharedItemsDestination === 'inbox'
                  ? 'Save to Inbox'
                  : 'Save to Notes'
              }
              chevron
              onPress={() => setCaptureSheetTarget('shared_items')}
            />
            <SettingsRow
              title="Default capture type"
              value={capturePrefsLoading ? 'Loading...' : captureTypeLabel}
              chevron
              onPress={() => setCaptureSheetTarget('default_type')}
            />
          </Section>

          <Section title="Siri Shortcuts">
            <SettingsRow
              title="Default Siri workspace"
              value={workspaceState.isLoading ? 'Loading...' : defaultSiriWorkspaceLabel}
              chevron
              onPress={() => {
                if (workspaceState.isLoading) return;
                setWorkspaceSheetTarget('default_siri');
              }}
            />
            
            <SettingsRow
              title="Siri Shortcuts"
              subtitle="Preview the phrases Ledger can use with Siri."
              chevron
              onPress={() => setSiriShortcutsVisible(true)}
            />
          </Section>

          <Section title="App">
            <SettingsRow
              title="Haptics"
              right={
                <Switch
                  value={appPreferences.hapticsEnabled}
                  onValueChange={setHapticsEnabled}
                  disabled={appPreferences.isLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
            <SettingsRow
              title="Reduce motion"
              right={
                <Switch
                  value={appPreferences.reduceMotionEnabled}
                  onValueChange={setReduceMotionEnabled}
                  disabled={appPreferences.isLoading}
                  trackColor={switchTrackColor}
                  thumbColor={theme.colors.surface}
                />
              }
            />
          </Section>

          <Section title="About">
            <SettingsRow title="Help" chevron onPress={() => void openLegalLink('docs')} />
            <SettingsRow title="Privacy Policy" chevron onPress={() => void openLegalLink('privacy')} />
            <SettingsRow title="Terms" chevron onPress={() => void openLegalLink('terms')} />
            <SettingsRow title="Version" value={mockProfile.version} chevron onPress={() => void openLegalLink('whats-new')} />
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
            : workspaceSheetTarget === 'default_siri'
              ? workspaceState.defaultSiriWorkspaceId
            : workspaceState.todayScopeWorkspaceId
        }
        workspaces={
          workspaceSheetTarget === 'default_capture' || workspaceSheetTarget === 'default_siri'
            ? captureWorkspaceOptions
            : workspaceState.options
        }
        onSelect={(workspaceId) => {
          if (workspaceSheetTarget === 'default_capture') {
            setDefaultCaptureWorkspace(workspaceId);
          } else if (workspaceSheetTarget === 'default_siri') {
            setDefaultSiriWorkspace(workspaceId);
          } else if (workspaceSheetTarget === 'today_scope') {
            setTodayScopeWorkspace(workspaceId);
          }
          setWorkspaceSheetTarget(null);
        }}
        onClose={() => setWorkspaceSheetTarget(null)}
      />

      <SettingsChoiceSheet
        visible={captureSheetTarget === 'shared_items'}
        title="Shared items"
        subtitle="Choose where shared items should go on this device."
        selectedValue={capturePrefs.sharedItemsDestination}
        options={[
          { value: 'inbox', title: 'Save to Inbox', subtitle: 'Recommended for quick triage.' },
          { value: 'notes', title: 'Save to Notes', subtitle: 'For things you want to keep as reference.' },
        ]}
        onSelect={(value) =>
          void patchCapturePreferences({
            ...capturePrefs,
            sharedItemsDestination: value as typeof capturePrefs.sharedItemsDestination,
          })
        }
        onClose={() => setCaptureSheetTarget(null)}
      />

      <SiriShortcutsSheet
        visible={siriShortcutsVisible}
        onClose={() => setSiriShortcutsVisible(false)}
      />

      <SettingsChoiceSheet
        visible={captureSheetTarget === 'default_type'}
        title="Default capture type"
        subtitle="Choose which capture form should be preselected for mobile capture."
        selectedValue={capturePrefs.defaultCaptureType}
        options={[
          { value: 'reminder', title: 'Reminder' },
          { value: 'task', title: 'Task' },
          { value: 'event', title: 'Event' },
          { value: 'note', title: 'Note' },
          { value: 'project-action', title: 'Project action' },
        ]}
        onSelect={(value) =>
          void patchCapturePreferences({
            ...capturePrefs,
            defaultCaptureType: value as typeof capturePrefs.defaultCaptureType,
          })
        }
        onClose={() => setCaptureSheetTarget(null)}
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

function formatCaptureTypeLabel(captureType: string) {
  if (captureType === 'project-action') return 'Project action';
  if (!captureType) return 'Reminder';
  return captureType.charAt(0).toUpperCase() + captureType.slice(1);
}
