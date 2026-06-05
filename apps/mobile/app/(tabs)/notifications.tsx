import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import {
  MobilePageHeader,
  MOBILE_PAGE_HEADER_SCROLL_SPACE,
  MOBILE_PULL_TO_REFRESH_OFFSET,
} from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { NotificationList } from '@/features/notifications/NotificationList';
import { NotificationSkeleton } from '@/features/notifications/NotificationSkeleton';
import { getMobileNotifications, performMobileNotificationAction } from '@/api/notifications';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import type { MobileNotificationCenterItem, MobileNotificationCenterResponse } from '@/types/ledger';

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
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  const loadNotifications = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const silent = Boolean(options.silent);
      const isInitialLoad = !hasLoadedOnceRef.current;

      if (!silent && isInitialLoad) {
        setIsLoading(true);
      }
      if (!silent) {
        setError(null);
      }

      try {
        const response = await getMobileNotifications(workspaceState.selectedWorkspaceId);
        setNotifications(response);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Could not load Notifications.');
        }
      } finally {
        if (!silent && isInitialLoad) {
          setIsLoading(false);
        }
      }
    },
    [workspaceState.selectedWorkspaceId],
  );

  const refreshNotifications = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadNotifications({ silent: false });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadNotifications]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, workspaceState.selectedWorkspaceId]);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications({ silent: true });
    }, [loadNotifications]),
  );

  const openWorkspaceSwitcher = () => {
    if (workspaceState.options.length <= 1) return;
    setWorkspacePickerOpen(true);
  };

  const handleNotificationAction = useCallback(
    async (
      action: 'open' | 'dismiss' | 'complete' | 'snooze',
      item: import('@/types/ledger').MobileNotificationCenterItem,
    ) => {
      setActionBusyId(item.id);
      const shouldOptimisticallyRemove = action !== 'open';
      const previousNotifications = notifications;
      if (shouldOptimisticallyRemove) {
        setNotifications((current) => {
          const removeItem = (items: MobileNotificationCenterItem[]) =>
            items.filter((candidate) => candidate.id !== item.id);

          const active = removeItem(current.active);
          const earlier = removeItem(current.earlier);
          return {
            active,
            earlier,
            counts: {
              active: active.length,
              earlier: earlier.length,
              total: active.length + earlier.length,
            },
          };
        });
      }

      try {
        await performMobileNotificationAction(item.id, action);
      } catch (err) {
        if (shouldOptimisticallyRemove) {
          setNotifications(previousNotifications);
        }
        setError(err instanceof Error ? err.message : 'Could not update notification.');
      } finally {
        setActionBusyId(null);
      }
    },
    [notifications],
  );

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
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refreshNotifications()}
              progressViewOffset={MOBILE_PULL_TO_REFRESH_OFFSET}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.surfaceMuted}
            />
          }
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={{ gap: theme.spacing['2xl'] }}>
            {isLoading ? (
              <NotificationSkeleton />
            ) : error ? (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">{error || 'Could not load Notifications.'}</AppText>
                <AppButton
                  title="Retry"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => void loadNotifications({ silent: false })}
                />
              </View>
            ) : hasContent ? (
              <View style={{ gap: theme.spacing.xl }}>
                <NotificationList
                  active={notifications.active}
                  earlier={notifications.earlier}
                  showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                  onAction={handleNotificationAction}
                  busyItemId={actionBusyId}
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
