import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { MobilePageHeader, MOBILE_PAGE_HEADER_SCROLL_SPACE } from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { NotificationList } from '@/features/notifications/NotificationList';
import { getMobileNotifications } from '@/api/notifications';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import type { MobileNotificationCenterResponse } from '@/types/ledger';

const EMPTY_NOTIFICATIONS: MobileNotificationCenterResponse = {
  active: [],
  earlier: [],
  counts: {
    active: 0,
    earlier: 0,
    total: 0,
  },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const [notifications, setNotifications] = useState<MobileNotificationCenterResponse>(EMPTY_NOTIFICATIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  const refreshNotifications = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshNotifications();
    }, [refreshNotifications]),
  );

  useEffect(() => {
    let cancelled = false;

    const loadNotifications = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getMobileNotifications(workspaceState.selectedWorkspaceId);
        if (cancelled) return;
        setNotifications(response);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load Notifications.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, workspaceState.selectedWorkspaceId]);

  const openWorkspaceSwitcher = () => {
    if (workspaceState.options.length <= 1) return;
    setWorkspacePickerOpen(true);
  };

  const hasContent = notifications.active.length > 0 || notifications.earlier.length > 0;

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <MobilePageHeader
          title="Notifications"
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceLoading={workspaceState.isLoading}
          workspaceExpanded={workspacePickerOpen}
          onWorkspacePress={openWorkspaceSwitcher}
          onSettingsPress={() => router.push('/settings')}
          scrollY={scrollY}
        />

        <WorkspaceSelectorSheet
          visible={workspacePickerOpen}
          selectedWorkspaceId={workspaceState.selectedWorkspaceId}
          workspaces={workspaceState.options}
          onSelect={(workspaceId) => {
            selectWorkspace(workspaceId);
          }}
          onClose={() => setWorkspacePickerOpen(false)}
        />

        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: MOBILE_PAGE_HEADER_SCROLL_SPACE,
            paddingBottom: theme.spacing['3xl'] + 132,
          }}
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={{ gap: theme.spacing['2xl'] }}>
            {isLoading ? (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">Loading notifications…</AppText>
                <AppText variant="meta">Checking what needs attention.</AppText>
              </View>
            ) : error ? (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">{error || 'Could not load Notifications.'}</AppText>
                <AppButton
                  title="Retry"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setRefreshNonce((value) => value + 1)}
                />
              </View>
            ) : hasContent ? (
              <View style={{ gap: theme.spacing.xl }}>
                <AppText variant="body">{
                  notifications.counts.active > 0
                    ? `${notifications.counts.active} active`
                    : 'Nothing active'
                }</AppText>
                <NotificationList
                  active={notifications.active}
                  earlier={notifications.earlier}
                  showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                />
              </View>
            ) : (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">Nothing needs attention.</AppText>
                <AppText variant="meta">Notifications will show up here when Ledger needs your attention.</AppText>
              </View>
            )}
          </View>
        </Animated.ScrollView>
      </View>
    </Screen>
  );
}
