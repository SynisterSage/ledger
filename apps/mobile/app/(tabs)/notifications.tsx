import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import {
  MobilePageHeader,
  MOBILE_PAGE_HEADER_SCROLL_SPACE,
  MOBILE_PULL_TO_REFRESH_OFFSET,
} from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { NotificationActionsSheet } from '@/features/notifications/NotificationActionsSheet';
import { NotificationDetailSheet } from '@/features/notifications/NotificationDetailSheet';
import { NotificationList } from '@/features/notifications/NotificationList';
import { NotificationSkeleton } from '@/features/notifications/NotificationSkeleton';
import { getMobileNotifications, performMobileNotificationAction } from '@/api/notifications';
import { useFollowUpSheet } from '@/features/followup/FollowUpSheetContext';
import { useQuickNoteSheet } from '@/features/quicknote/QuickNoteSheetContext';
import { mobileRequest } from '@/api/client';
import { triggerLightHaptic } from '@/lib/haptics';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import type { MobileNotificationCenterItem, MobileNotificationCenterResponse } from '@/types/ledger';
import { getNotificationSourceLabel, mapNotificationSourceTypeToFollowUpSourceType } from '@/features/notifications/notificationAdapters';

const EMPTY_NOTIFICATIONS: MobileNotificationCenterResponse = {
  active: [],
  earlier: [],
  counts: {
    active: 0,
    earlier: 0,
    total: 0,
  },
};

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeValue(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const params = useLocalSearchParams<{ notificationId?: string | string[] }>();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const { openFollowUpSheet } = useFollowUpSheet();
  const { openQuickNoteSheet } = useQuickNoteSheet();
  const [notifications, setNotifications] = useState<MobileNotificationCenterResponse>(EMPTY_NOTIFICATIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<MobileNotificationCenterItem | null>(null);
  const [sheetMode, setSheetMode] = useState<'detail' | 'actions'>('detail');
  const hasLoadedOnceRef = useRef(false);
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedNotificationIdRef = useRef<string | null>(null);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  useEffect(() => {
    return () => {
      if (followUpTimerRef.current) {
        clearTimeout(followUpTimerRef.current);
        followUpTimerRef.current = null;
      }
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }
    };
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

  const closeNotificationSheet = useCallback(() => {
    setSelectedNotification(null);
    setSheetMode('detail');
  }, []);

  const openNotificationSheet = useCallback((item: MobileNotificationCenterItem, mode: 'detail' | 'actions') => {
    setSelectedNotification(item);
    setSheetMode(mode);
  }, []);

  const notificationTapId = useMemo(() => {
    const value = params.notificationId;
    return Array.isArray(value) ? value[0] : value ?? null;
  }, [params.notificationId]);

  useEffect(() => {
    closeNotificationSheet();
  }, [closeNotificationSheet, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    if (!notificationTapId) {
      openedNotificationIdRef.current = null;
      return;
    }

    if (openedNotificationIdRef.current === notificationTapId) {
      return;
    }

    const foundItem =
      notifications.active.find((item) => item.id === notificationTapId) ??
      notifications.earlier.find((item) => item.id === notificationTapId) ??
      null;

    if (!foundItem) {
      return;
    }

    openedNotificationIdRef.current = notificationTapId;
    openNotificationSheet(foundItem, 'detail');
  }, [notificationTapId, notifications.active, notifications.earlier, openNotificationSheet]);

  const scheduleFollowUpSheet = useCallback(
    (item: MobileNotificationCenterItem) => {
      if (followUpTimerRef.current) {
        clearTimeout(followUpTimerRef.current);
        followUpTimerRef.current = null;
      }

      closeNotificationSheet();
      followUpTimerRef.current = setTimeout(() => {
        followUpTimerRef.current = null;
        openFollowUpSheet({
          title: `Follow up: ${item.title}`,
          notes: item.body?.trim() || item.context?.trim() || null,
          workspaceId: item.workspaceId,
          sourceLabel: getNotificationSourceLabel(item),
          sourceTitle: item.title,
          sourceType: mapNotificationSourceTypeToFollowUpSourceType(item.sourceType),
          sourceId: item.sourceId,
          onSaved: () => {
            void refreshNotifications();
          },
        });
      }, 220);
    },
    [closeNotificationSheet, openFollowUpSheet, refreshNotifications],
  );

  const scheduleQuickNoteSheet = useCallback(
    (item: MobileNotificationCenterItem) => {
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }

      closeNotificationSheet();
      noteTimerRef.current = setTimeout(() => {
        noteTimerRef.current = null;
        openQuickNoteSheet({
          sourceLabel: getNotificationSourceLabel(item),
          workspaceId: item.workspaceId,
          onSaved: () => {
            void refreshNotifications();
          },
        });
      }, 220);
    },
    [closeNotificationSheet, openQuickNoteSheet, refreshNotifications],
  );

  const applyOptimisticNotificationAction = useCallback(
    (current: MobileNotificationCenterResponse, itemId: string) => {
      const removeItem = (items: MobileNotificationCenterItem[]) =>
        items.filter((candidate) => candidate.id !== itemId);

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
    },
    [],
  );

  const handleTaskMoveTomorrow = useCallback(
    async (item: MobileNotificationCenterItem) => {
      const base = item.scheduledFor ? new Date(item.scheduledFor) : new Date();
      const next = new Date(base);
      next.setDate(next.getDate() + 1);

      const dueDate = toLocalDateKey(next);
      const dueTime = toLocalTimeValue(next);

      await mobileRequest(`/api/tasks/${item.sourceId}`, {
        method: 'PATCH',
        headers: item.workspaceId ? { 'x-workspace-id': item.workspaceId } : undefined,
        body: JSON.stringify({
          due_date: dueDate,
          due_time: dueTime,
          show_in_today: false,
          is_today_focus: false,
        }),
      });
    },
    [],
  );

  const handleTaskFocus = useCallback(async (item: MobileNotificationCenterItem) => {
    await mobileRequest(`/api/tasks/${item.sourceId}`, {
      method: 'PATCH',
      headers: item.workspaceId ? { 'x-workspace-id': item.workspaceId } : undefined,
      body: JSON.stringify({
        show_in_today: true,
        is_today_focus: true,
      }),
    });
  }, []);

  const handleInboxConvert = useCallback(
    async (item: MobileNotificationCenterItem, type: 'task' | 'reminder' | 'note' | 'event') => {
      await mobileRequest(`/api/inbox/${item.sourceId}/convert`, {
        method: 'POST',
        headers: item.workspaceId ? { 'x-workspace-id': item.workspaceId } : undefined,
        body: JSON.stringify({
          type,
          title: item.title,
          body: item.body ?? item.context ?? item.title,
          status: type === 'note' ? 'active' : undefined,
          priority: 'medium',
          show_in_today: type === 'task',
          is_today_focus: false,
        }),
      });
    },
    [],
  );

  const handleInboxArchive = useCallback(async (item: MobileNotificationCenterItem) => {
    await mobileRequest(`/api/inbox/${item.sourceId}/archive`, {
      method: 'POST',
      headers: item.workspaceId ? { 'x-workspace-id': item.workspaceId } : undefined,
    });
  }, []);

  const handleNotificationAction = useCallback(
    async (actionId: string, item: MobileNotificationCenterItem) => {
      if (actionId === 'add_note' && (item.sourceType === 'event' || item.sourceType === 'project')) {
        scheduleQuickNoteSheet(item);
        return;
      }

      if (
        actionId === 'create_follow_up' &&
        (item.sourceType === 'event' || item.sourceType === 'project' || item.sourceType === 'task' || item.sourceType === 'reminder')
      ) {
        scheduleFollowUpSheet(item);
        return;
      }

      if (actionId === 'convert_task' && item.sourceType === 'inbox') {
        setActionBusyId(item.id);
        try {
          await handleInboxConvert(item, 'task');
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'convert_reminder' && item.sourceType === 'inbox') {
        setActionBusyId(item.id);
        try {
          await handleInboxConvert(item, 'reminder');
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'convert_note' && item.sourceType === 'inbox') {
        setActionBusyId(item.id);
        try {
          await handleInboxConvert(item, 'note');
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'convert_event' && item.sourceType === 'inbox') {
        setActionBusyId(item.id);
        try {
          await handleInboxConvert(item, 'event');
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'archive' && item.sourceType === 'inbox') {
        setActionBusyId(item.id);
        try {
          await handleInboxArchive(item);
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'move_tomorrow' && item.sourceType === 'task') {
        setActionBusyId(item.id);
        const previousNotifications = notifications;
        setNotifications((current) => applyOptimisticNotificationAction(current, item.id));
        try {
          await handleTaskMoveTomorrow(item);
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setNotifications(previousNotifications);
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'add_to_focus' && item.sourceType === 'task') {
        setActionBusyId(item.id);
        try {
          await handleTaskFocus(item);
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'mark_done' || actionId === 'complete' || actionId === 'dismiss' || actionId === 'snooze_10' || actionId === 'snooze_1_hour') {
        setActionBusyId(item.id);
        const previousNotifications = notifications;
        const shouldOptimisticallyRemove = true;
        if (shouldOptimisticallyRemove) {
          setNotifications((current) => applyOptimisticNotificationAction(current, item.id));
        }

        try {
          if (item.sourceType === 'reminder') {
            if (actionId === 'mark_done' || actionId === 'complete') {
              await performMobileNotificationAction(item.id, 'complete');
            } else if (actionId === 'snooze_10' || actionId === 'snooze_1_hour') {
              const snoozeMinutes = actionId === 'snooze_10' ? 10 : 60;
              await performMobileNotificationAction(item.id, 'snooze', {
                snoozeUntil: new Date(Date.now() + snoozeMinutes * 60 * 1000).toISOString(),
              });
            } else {
              await performMobileNotificationAction(item.id, 'dismiss');
            }
          } else if (item.sourceType === 'task') {
            if (actionId === 'mark_done' || actionId === 'complete') {
              await performMobileNotificationAction(item.id, 'complete');
            } else {
              await performMobileNotificationAction(item.id, 'dismiss');
            }
          } else {
            await performMobileNotificationAction(item.id, actionId === 'dismiss' ? 'dismiss' : 'complete');
          }

          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          if (shouldOptimisticallyRemove) {
            setNotifications(previousNotifications);
          }
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }

      if (actionId === 'move_tomorrow' && item.sourceType === 'reminder') {
        setActionBusyId(item.id);
        const previousNotifications = notifications;
        setNotifications((current) => applyOptimisticNotificationAction(current, item.id));
        try {
          const base = item.scheduledFor ? new Date(item.scheduledFor) : new Date();
          const next = new Date(base);
          next.setDate(next.getDate() + 1);
          await performMobileNotificationAction(item.id, 'snooze', { snoozeUntil: next.toISOString() });
          await refreshNotifications();
          closeNotificationSheet();
        } catch (err) {
          setNotifications(previousNotifications);
          setError(err instanceof Error ? err.message : 'Could not update notification.');
        } finally {
          setActionBusyId(null);
        }
        return;
      }
    },
    [
      applyOptimisticNotificationAction,
      closeNotificationSheet,
      handleInboxArchive,
      handleInboxConvert,
      handleTaskFocus,
      handleTaskMoveTomorrow,
      notifications,
      refreshNotifications,
      scheduleFollowUpSheet,
      scheduleQuickNoteSheet,
    ],
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
            flexGrow: 1,
          }}
          contentInsetAdjustmentBehavior="always"
          automaticallyAdjustsScrollIndicatorInsets
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
          <View style={{ gap: theme.spacing['2xl'], flex: 1 }}>
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
                  onPress={(item) => {
                    openNotificationSheet(item, 'detail');
                  }}
                  onLongPress={async (item) => {
                    await triggerLightHaptic();
                    openNotificationSheet(item, 'actions');
                  }}
                  busyItemId={actionBusyId}
                />
              </View>
            ) : (
              <EmptyState
                iconName="bell"
                title="Nothing needs attention."
                description="Notifications will show up here when Ledger needs your attention."
              />
            )}
          </View>
        </Animated.ScrollView>

        <NotificationDetailSheet
          visible={sheetMode === 'detail' && Boolean(selectedNotification)}
          item={sheetMode === 'detail' ? selectedNotification : null}
          showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
          onClose={closeNotificationSheet}
          onAction={handleNotificationAction}
        />

        <NotificationActionsSheet
          visible={sheetMode === 'actions' && Boolean(selectedNotification)}
          item={sheetMode === 'actions' ? selectedNotification : null}
          showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
          onClose={closeNotificationSheet}
          onAction={handleNotificationAction}
        />
      </View>
    </Screen>
  );
}
