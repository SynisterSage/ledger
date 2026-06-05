import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import {
  MobilePageHeader,
  MOBILE_PAGE_HEADER_SCROLL_SPACE,
  MOBILE_PULL_TO_REFRESH_OFFSET,
} from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TodayList } from '@/features/today/TodayList';
import { TodayItemSheet, type TodaySheetMode } from '@/features/today/TodayItemSheet';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { getMobileToday } from '@/api/today';
import { performMobileTodayAction } from '@/api/todayActions';
import { useLedgerTheme } from '@/theme';
import type {
  MobileTodayInteractionItem,
  MobileTodayItem,
  MobileTodayResponse,
} from '@/types/ledger';
import {
  bootstrapWorkspaceState,
  getWorkspaceLabel,
  selectWorkspace,
  useWorkspaceState,
} from '@/store/workspaceStore';

const EMPTY_TODAY: MobileTodayResponse = {
  date: new Date().toISOString().slice(0, 10),
  scope: { workspaceId: 'all', label: 'All Workspaces' },
  upcoming: [],
  today: [],
  captures: { count: 0, items: [] },
};

export default function TodayScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const loadTokenRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceState = useWorkspaceState();
  const [today, setToday] = useState<MobileTodayResponse>(EMPTY_TODAY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MobileTodayInteractionItem | null>(null);
  const [sheetMode, setSheetMode] = useState<TodaySheetMode>('detail');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  const showActionError = useCallback((message: string) => {
    setActionError(message);
    if (actionErrorTimerRef.current) {
      clearTimeout(actionErrorTimerRef.current);
    }
    actionErrorTimerRef.current = setTimeout(() => {
      setActionError(null);
    }, 2500);
  }, []);

  const loadToday = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const loadToken = ++loadTokenRef.current;
      const isFirstLoad = !hasLoadedRef.current;

      if (isFirstLoad && !silent) {
        setIsLoading(true);
      }

      if (!silent) {
        setError(null);
      }

      try {
        const response = await getMobileToday({ workspaceId: workspaceState.selectedWorkspaceId });
        if (loadToken !== loadTokenRef.current) return;
        setToday(response);
        hasLoadedRef.current = true;
        setActionError(null);
      } catch (err) {
        if (loadToken !== loadTokenRef.current) return;

        if (!silent && isFirstLoad) {
          setError(err instanceof Error ? err.message : 'Could not load Today.');
        } else if (!silent) {
          showActionError(err instanceof Error ? err.message : 'Could not update Today.');
        } else {
          showActionError(err instanceof Error ? err.message : 'Could not update Today.');
        }
      } finally {
        if (loadToken === loadTokenRef.current && isFirstLoad && !silent) {
          setIsLoading(false);
        }
      }
    },
    [showActionError, workspaceState.selectedWorkspaceId],
  );

  const refreshToday = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadToday({ silent: false });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadToday]);

  useFocusEffect(
    useCallback(() => {
      void loadToday({ silent: hasLoadedRef.current });
    }, [loadToday]),
  );

  useEffect(() => {
    if (hasLoadedRef.current) {
      void loadToday({ silent: true });
    }
  }, [loadToday, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    return () => {
      if (actionErrorTimerRef.current) {
        clearTimeout(actionErrorTimerRef.current);
      }
    };
  }, []);

  const openWorkspaceSwitcher = () => {
    if (workspaceState.options.length <= 1) return;
    setWorkspacePickerOpen(true);
  };

  const hasContent =
    today.upcoming.length > 0 || today.today.length > 0 || today.captures.count > 0;

  const closeItemSheet = () => {
    setSelectedItem(null);
  };

  const applyOptimisticTodayAction = useCallback(
    (current: MobileTodayResponse, actionId: string, item: MobileTodayInteractionItem) => {
      const removeFromFeed = () => ({
        ...current,
        upcoming: current.upcoming.filter((entry) => entry.id !== item.id),
        today: current.today.filter((entry) => entry.id !== item.id),
        captures: {
          ...current.captures,
          count: Math.max(0, current.captures.count - ('source' in item ? 1 : 0)),
          items: current.captures.items.filter((entry) => entry.id !== item.id),
        },
      });

      if ('source' in item) {
        if (actionId === 'add_note' || actionId === 'open' || actionId === 'create_follow_up') {
          return current;
        }

        return removeFromFeed();
      }

      if (item.type === 'event') {
        if (actionId === 'add_note' || actionId === 'open' || actionId === 'edit') {
          return current;
        }

        if (actionId === 'create_follow_up') {
          return current;
        }

        return removeFromFeed();
      }

      if (item.type === 'focus' || item.type === 'task') {
        if (actionId === 'add_focus') {
          const nextUrgency =
            item.type === 'focus' ? item.urgency ?? 'Low' : 'Low';
          return {
            ...current,
            today: current.today.map((entry) =>
              entry.id === item.id
                ? {
                    ...(entry as MobileTodayItem),
                    ...entry,
                    type: 'focus',
                    meta: `Focus · ${nextUrgency}`,
                    urgency: nextUrgency,
                    dueLabel: 'Today',
                  } as MobileTodayItem
                : entry,
            ),
          };
        }

        if (actionId === 'edit') {
          return current;
        }

        return removeFromFeed();
      }

      if (item.type === 'reminder') {
        if (actionId === 'edit') {
          return current;
        }

        return removeFromFeed();
      }

      if (item.type === 'project_action') {
        if (actionId === 'open_project' || actionId === 'edit') {
          return current;
        }

        return removeFromFeed();
      }

      return current;
    },
    [],
  );

  const handleTodayItemAction = useCallback(
    async (actionId: string, item: MobileTodayInteractionItem) => {
      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;
      setActionError(null);
      closeItemSheet();

      let previousSnapshot: MobileTodayResponse | null = null;
      setToday((current) => {
        previousSnapshot = current;
        return applyOptimisticTodayAction(current, actionId, item);
      });

      try {
        const result = await performMobileTodayAction({ actionId, item });
        if (result.refresh) {
          await loadToday({ silent: true });
        }
      } catch (err) {
        if (previousSnapshot) {
          setToday(previousSnapshot);
        }
        showActionError(err instanceof Error ? err.message : 'Could not update Today.');
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [applyOptimisticTodayAction, loadToday, showActionError],
  );

  const openItemSheet = (item: MobileTodayInteractionItem, mode: TodaySheetMode) => {
    setSelectedItem(item);
    setSheetMode(mode);
  };

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <MobilePageHeader
          title="Today"
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceLoading={workspaceState.isLoading}
          onWorkspacePress={openWorkspaceSwitcher}
          workspaceExpanded={workspacePickerOpen}
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
              onRefresh={() => void refreshToday()}
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
            {actionError ? (
              <AppText variant="meta" style={{ color: theme.colors.danger }}>
                {actionError}
              </AppText>
            ) : null}
            {isLoading ? (
              <TodaySkeleton />
            ) : error ? (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">{error || 'Could not load Today.'}</AppText>
                <AppButton
                  title="Retry"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => void loadToday({ silent: false })}
                />
              </View>
            ) : hasContent ? (
              <TodayList
                upcoming={today.upcoming}
                today={today.today}
                captures={today.captures}
                showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                onItemLongPress={async (item) => {
                  try {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  } catch {
                    // Ignore haptic failures on unsupported devices.
                  }
                  openItemSheet(item, 'actions');
                }}
              />
            ) : (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">Nothing needs attention.</AppText>
                <AppText variant="meta">Capture something new or enjoy the quiet.</AppText>
              </View>
            )}
          </View>
        </Animated.ScrollView>

        <TodayItemSheet
          visible={Boolean(selectedItem)}
          item={selectedItem}
          mode={sheetMode}
          onClose={closeItemSheet}
          onAction={handleTodayItemAction}
        />
      </View>
    </Screen>
  );
}
