import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { NotificationFilterSheet } from '@/features/notifications/NotificationFilterSheet';
import { NotificationList } from '@/features/notifications/NotificationList';
import { NotificationSkeleton } from '@/features/notifications/NotificationSkeleton';
import { getMobileNotifications, markAllMobileNotificationsRead, performMobileNotificationAction } from '@/api/notifications';
import { useFollowUpSheet } from '@/features/followup/FollowUpSheetContext';
import { useQuickNoteSheet } from '@/features/quicknote/QuickNoteSheetContext';
import { mobileRequest } from '@/api/client';
import { triggerLightHaptic } from '@/lib/haptics';
import { useLedgerTheme } from '@/theme';
import { FollowUpSheetProvider } from '@/features/followup/FollowUpSheetContext';
import { QuickNoteSheetProvider } from '@/features/quicknote/QuickNoteSheetContext';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import type { MobileNotificationCenterItem, MobileNotificationCenterResponse } from '@/types/ledger';
import {
  buildNotificationSections,
  buildPresentedNotifications,
  getNotificationDisplayState,
  getNotificationSourceLabel,
  mapNotificationSourceTypeToFollowUpSourceType,
} from '@/features/notifications/notificationAdapters';
import {
  DEFAULT_NOTIFICATION_FILTERS,
  countActiveNotificationFilters,
  filterNotifications,
  type NotificationFilterState,
} from '@/features/notifications/notificationFilters';

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

function NotificationsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const params = useLocalSearchParams<{ notificationId?: string | string[]; returnTo?: string | string[] }>();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const { openFollowUpSheet } = useFollowUpSheet();
  const { openQuickNoteSheet } = useQuickNoteSheet();
  const [notifications, setNotifications] = useState<MobileNotificationCenterResponse>(EMPTY_NOTIFICATIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [notificationFilters, setNotificationFilters] = useState<NotificationFilterState>(DEFAULT_NOTIFICATION_FILTERS);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<MobileNotificationCenterItem | null>(null);
  const [sheetMode, setSheetMode] = useState<'detail' | 'actions'>('detail');
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [undoDismissal, setUndoDismissal] = useState<MobileNotificationCenterItem | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedNotificationIdRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationIdsRef = useRef(new Set<string>());
  const pageTranslateX = useRef(new Animated.Value(0)).current;

  const navigateBack = useCallback(() => {
    const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
    const destination = returnTo === '/(tabs)/calendar' || returnTo === '/(tabs)/capture' || returnTo === '/(tabs)/projects' || returnTo === '/(tabs)/notes' || returnTo === '/(tabs)/today'
      ? returnTo
      : '/(tabs)/today';
    router.replace(destination as never);
  }, [params.returnTo, router]);

  const completeSwipeBack = useCallback((direction: 'left' | 'right') => {
    Animated.timing(pageTranslateX, {
      toValue: direction === 'left' ? -windowWidth : windowWidth,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) navigateBack();
    });
  }, [navigateBack, pageTranslateX, windowWidth]);

  const resetSwipeBack = useCallback(() => {
    Animated.spring(pageTranslateX, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [pageTranslateX]);

  const leftEdgePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => pageTranslateX.setValue(Math.max(0, gestureState.dx)),
    onPanResponderRelease: (_, gestureState) => gestureState.dx > 72 || gestureState.vx > 0.65 ? completeSwipeBack('right') : resetSwipeBack(),
    onPanResponderTerminate: resetSwipeBack,
  }), [completeSwipeBack, pageTranslateX, resetSwipeBack]);

  const rightEdgePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => pageTranslateX.setValue(Math.min(0, gestureState.dx)),
    onPanResponderRelease: (_, gestureState) => gestureState.dx < -72 || gestureState.vx < -0.65 ? completeSwipeBack('left') : resetSwipeBack(),
    onPanResponderTerminate: resetSwipeBack,
  }), [completeSwipeBack, pageTranslateX, resetSwipeBack]);

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
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (actionMessageTimerRef.current) clearTimeout(actionMessageTimerRef.current);
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

  const showActionMessage = useCallback((message: string) => {
    setActionMessage(message);
    if (actionMessageTimerRef.current) clearTimeout(actionMessageTimerRef.current);
    actionMessageTimerRef.current = setTimeout(() => setActionMessage(null), 2800);
  }, []);

  const updateNotification = useCallback((current: MobileNotificationCenterResponse, itemId: string, update: (item: MobileNotificationCenterItem) => MobileNotificationCenterItem) => ({
    ...current,
    active: current.active.map((item) => item.id === itemId ? update(item) : item),
    earlier: current.earlier.map((item) => item.id === itemId ? update(item) : item),
  }), []);

  const markNotificationRead = useCallback(async (item: MobileNotificationCenterItem) => {
    if (mutationIdsRef.current.has(item.id) || getNotificationDisplayState(item) !== 'unread') return;
    mutationIdsRef.current.add(item.id);
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) => updateNotification(current, item.id, (candidate) => ({ ...candidate, unread: false, readAt })));
    try {
      await performMobileNotificationAction(item.id, 'read');
    } catch {
      setNotifications(previous);
      showActionMessage('Couldn’t mark notification as read');
    } finally {
      mutationIdsRef.current.delete(item.id);
    }
  }, [notifications, showActionMessage, updateNotification]);

  const commitDismissal = useCallback(async (item: MobileNotificationCenterItem) => {
    mutationIdsRef.current.add(item.id);
    try {
      await performMobileNotificationAction(item.id, 'dismiss');
    } catch {
      setNotifications((current) => ({ ...current, active: [...current.active, item], earlier: current.earlier.filter((candidate) => candidate.id !== item.id) }));
      showActionMessage('Couldn’t dismiss notification');
    } finally {
      mutationIdsRef.current.delete(item.id);
    }
  }, [showActionMessage]);

  const dismissNotification = useCallback((item: MobileNotificationCenterItem) => {
    if (mutationIdsRef.current.has(item.id)) return;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setUndoDismissal(item);
    setOpenRowId(null);
    setNotifications((current) => ({ ...current, active: current.active.filter((candidate) => candidate.id !== item.id), earlier: current.earlier.filter((candidate) => candidate.id !== item.id) }));
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setUndoDismissal(null);
      void commitDismissal(item);
    }, 3200);
  }, [commitDismissal]);

  const undoDismissalAction = useCallback(() => {
    if (!undoDismissal) return;
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
    setNotifications((current) => {
      const exists = [...current.active, ...current.earlier].some((candidate) => candidate.id === undoDismissal.id);
      if (exists) return current;
      return undoDismissal.status === 'active'
        ? { ...current, active: [...current.active, undoDismissal] }
        : { ...current, earlier: [...current.earlier, undoDismissal] };
    });
    setUndoDismissal(null);
  }, [undoDismissal]);

  const markAllRead = useCallback(async () => {
    const unreadItems = [...notifications.active, ...notifications.earlier].filter((item) => getNotificationDisplayState(item) === 'unread');
    if (!unreadItems.length) return;
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) => ({
      ...current,
      active: current.active.map((item) => unreadItems.some((candidate) => candidate.id === item.id) ? { ...item, unread: false, readAt, actionTaken: 'open' } : item),
      earlier: current.earlier.map((item) => unreadItems.some((candidate) => candidate.id === item.id) ? { ...item, unread: false, readAt, actionTaken: 'open' } : item),
    }));
    try {
      await markAllMobileNotificationsRead(workspaceState.selectedWorkspaceId);
    } catch {
      setNotifications(previous);
      showActionMessage('Couldn’t mark notifications as read');
    }
  }, [notifications, showActionMessage, workspaceState.selectedWorkspaceId]);

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
      if (actionId === 'open') {
        if (getNotificationDisplayState(item) === 'unread') void markNotificationRead(item);
        setSheetMode('detail');
        return;
      }

      if (actionId === 'notification_settings') {
        closeNotificationSheet();
        router.push('/settings');
        return;
      }

      if (actionId === 'mark_read') {
        await markNotificationRead(item);
        closeNotificationSheet();
        return;
      }

      if (actionId === 'mark_unread') {
        await performMobileNotificationAction(item.id, 'unread');
        setNotifications((current) => updateNotification(current, item.id, (candidate) => ({ ...candidate, unread: true, readAt: null })));
        closeNotificationSheet();
        return;
      }

      if (actionId === 'dismiss') {
        dismissNotification(item);
        closeNotificationSheet();
        return;
      }

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
      dismissNotification,
      handleInboxArchive,
      handleInboxConvert,
      handleTaskFocus,
      handleTaskMoveTomorrow,
      notifications,
      markNotificationRead,
      refreshNotifications,
      router,
      scheduleFollowUpSheet,
      scheduleQuickNoteSheet,
    ],
  );

  const showWorkspaceNames = workspaceState.selectedWorkspaceId === 'all';
  const activeFilterCount = countActiveNotificationFilters(notificationFilters);
  const filteredNotificationItems = useMemo(
    () => filterNotifications([...notifications.active, ...notifications.earlier], notificationFilters),
    [notificationFilters, notifications.active, notifications.earlier],
  );
  const presentedNotifications = useMemo(
    () => buildPresentedNotifications(filteredNotificationItems, showWorkspaceNames),
    [filteredNotificationItems, showWorkspaceNames],
  );
  const notificationSections = useMemo(
    () => buildNotificationSections(presentedNotifications),
    [presentedNotifications],
  );
  const hasContent = notificationSections.length > 0;
  const getSwipeActions = useCallback((item: MobileNotificationCenterItem) => [
    ...(getNotificationDisplayState(item) === 'unread' ? [{ id: 'mark_read', label: 'Read', onPress: () => { void markNotificationRead(item); } }] : []),
    { id: 'dismiss', label: 'Dismiss', destructive: true, onPress: () => dismissNotification(item) },
  ], [dismissNotification, markNotificationRead]);

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[styles.pageSurface, { transform: [{ translateX: pageTranslateX }] }]}>
        <MobilePageHeader
          title="Notifications"
          showBack
          onBackPress={navigateBack}
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceLoading={workspaceState.isLoading}
          workspaceExpanded={workspacePickerOpen}
          onWorkspacePress={openWorkspaceSwitcher}
          showSettings={false}
          rightAccessory={(
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter notifications"
                accessibilityHint={activeFilterCount ? `${activeFilterCount} filters active` : undefined}
                hitSlop={8}
                onPress={() => setFilterSheetOpen(true)}
                style={({ pressed }) => [styles.headerIconButton, { opacity: pressed ? 0.72 : 1 }]}
              >
                <SymbolView
                  name={{ ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' }}
                  size={20}
                  weight="regular"
                  tintColor={activeFilterCount ? theme.colors.accent : theme.colors.textSecondary}
                />
                {activeFilterCount ? <View style={[styles.filterBadge, { backgroundColor: theme.colors.accent }]} /> : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                hitSlop={8}
                onPress={() => router.push('/settings')}
                style={({ pressed }) => [styles.headerIconButton, { opacity: pressed ? 0.72 : 1 }]}
              >
                <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={20} weight="regular" tintColor={theme.colors.textSecondary} />
              </Pressable>
            </View>
          )}
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

        <NotificationFilterSheet
          visible={filterSheetOpen}
          filters={notificationFilters}
          onChange={setNotificationFilters}
          onReset={() => setNotificationFilters(DEFAULT_NOTIFICATION_FILTERS)}
          onClose={() => setFilterSheetOpen(false)}
        />

        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: MOBILE_PAGE_HEADER_SCROLL_SPACE,
            paddingBottom: theme.spacing['3xl'] + insets.bottom + 24,
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
                  sections={notificationSections}
                  onPress={(item) => {
                    if (getNotificationDisplayState(item) === 'unread') void markNotificationRead(item);
                    setOpenRowId(null);
                    openNotificationSheet(item, 'detail');
                  }}
                  onLongPress={async (item) => {
                    await triggerLightHaptic();
                    setOpenRowId(null);
                    openNotificationSheet(item, 'actions');
                  }}
                  openRowId={openRowId}
                  onOpenRow={setOpenRowId}
                  onCloseRow={() => setOpenRowId(null)}
                  getSwipeActions={getSwipeActions}
                  onMarkAllRead={() => void markAllRead()}
                  busyItemId={actionBusyId}
                />
              </View>
            ) : activeFilterCount ? (
              <View style={styles.filteredEmptyState}>
                <AppText variant="body" style={styles.filteredEmptyTitle}>No matching notifications</AppText>
                <AppText variant="caption" style={styles.filteredEmptyDescription}>Try another type or clear the filters.</AppText>
                <AppButton title="Clear filters" variant="secondary" fullWidth={false} onPress={() => setNotificationFilters(DEFAULT_NOTIFICATION_FILTERS)} />
              </View>
            ) : (
              <EmptyState
                iconName="bell"
                title="You’re all caught up"
                description="New reminders, assignments, project updates, and integration activity will appear here."
              />
            )}
          </View>
        </Animated.ScrollView>

        <NotificationDetailSheet
          visible={sheetMode === 'detail' && Boolean(selectedNotification)}
          item={sheetMode === 'detail' ? selectedNotification : null}
          showWorkspaceNames={showWorkspaceNames}
          onClose={closeNotificationSheet}
          onAction={handleNotificationAction}
        />

        <NotificationActionsSheet
          visible={sheetMode === 'actions' && Boolean(selectedNotification)}
          item={sheetMode === 'actions' ? selectedNotification : null}
          showWorkspaceNames={showWorkspaceNames}
          onClose={closeNotificationSheet}
          onAction={handleNotificationAction}
        />

        {undoDismissal || actionMessage ? (
          <View style={[styles.feedback, { bottom: insets.bottom + 16, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
            <AppText variant="caption" numberOfLines={1} style={styles.feedbackText}>{undoDismissal ? 'Notification dismissed' : actionMessage}</AppText>
            {undoDismissal ? <Pressable accessibilityRole="button" accessibilityLabel="Undo notification dismissal" hitSlop={8} onPress={undoDismissalAction}><AppText variant="caption" style={{ color: theme.colors.accent, fontWeight: '600' }}>Undo</AppText></Pressable> : null}
          </View>
        ) : null}
        </Animated.View>
        <View style={styles.leftEdgeGesture} {...leftEdgePanResponder.panHandlers} />
        <View style={styles.rightEdgeGesture} {...rightEdgePanResponder.panHandlers} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pageSurface: { flex: 1 },
  leftEdgeGesture: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 28, zIndex: 20 },
  rightEdgeGesture: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, zIndex: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerIconButton: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  filterBadge: { position: 'absolute', right: -1, top: 2, width: 5, height: 5, borderRadius: 3 },
  filteredEmptyState: { alignItems: 'center', gap: 8, paddingTop: 28 },
  filteredEmptyTitle: { fontWeight: '600' },
  filteredEmptyDescription: { color: '#6B7280', textAlign: 'center' },
  feedback: { position: 'absolute', left: 12, right: 12, minHeight: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  feedbackText: { flex: 1 },
});

export default function NotificationsRoute() {
  return (
    <FollowUpSheetProvider>
      <QuickNoteSheetProvider>
        <NotificationsScreen />
      </QuickNoteSheetProvider>
    </FollowUpSheetProvider>
  );
}
