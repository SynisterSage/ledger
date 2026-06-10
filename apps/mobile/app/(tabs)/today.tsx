import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import {
  MobilePageHeader,
  MOBILE_PAGE_HEADER_SCROLL_SPACE,
  MOBILE_PULL_TO_REFRESH_OFFSET,
} from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TodayList } from '@/features/today/TodayList';
import { TodayItemDetailSheet, type TodayDetailSheetMode } from '@/features/today/TodayItemDetailSheet';
import { TodayItemActionsSheet } from '@/features/today/TodayItemActionsSheet';
import { TodayItemEditSheet } from '@/features/today/TodayItemEditSheet';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { useFollowUpSheet } from '@/features/followup/FollowUpSheetContext';
import { useQuickNoteSheet } from '@/features/quicknote/QuickNoteSheetContext';
import { triggerLightHaptic } from '@/lib/haptics';
import { getMobileToday } from '@/api/today';
import { performMobileTodayAction } from '@/api/todayActions';
import { useLedgerTheme } from '@/theme';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';
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
  date: formatDateToLocalIsoDate(new Date()),
  scope: { workspaceId: 'all', label: 'All Workspaces' },
  upcoming: [],
  today: [],
  captures: { count: 0, items: [] },
  notes: [],
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
  const { openFollowUpSheet } = useFollowUpSheet();
  const { openQuickNoteSheet } = useQuickNoteSheet();
  const [today, setToday] = useState<MobileTodayResponse>(EMPTY_TODAY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MobileTodayInteractionItem | null>(null);
  const [sheetMode, setSheetMode] = useState<TodayDetailSheetMode>('detail');
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
    today.upcoming.length > 0 || today.today.length > 0 || today.captures.count > 0 || today.notes.length > 0;

  const closeItemSheet = () => {
    setSelectedItem(null);
    setSheetMode('detail');
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
        notes: current.notes.filter((entry) => entry.id !== item.id),
      });

      if ('source' in item) {
        if (actionId === 'add_note' || actionId === 'open' || actionId === 'create_follow_up') {
          return current;
        }

        return removeFromFeed();
      }

      if (item.type === 'note') {
        if (actionId === 'add_follow_up' || actionId === 'edit' || actionId === 'open') {
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
      if (actionId === 'edit') {
        setSheetMode('edit');
        return;
      }

      if (actionId === 'reschedule' && !('source' in item) && item.type === 'event') {
        setSheetMode('reschedule');
        return;
      }

      if (actionId === 'add_follow_up' || actionId === 'create_follow_up') {
        const sourceLabel =
          'source' in item ? 'From capture' : item.type === 'note' ? 'From note' : 'From event';
        const followUpNotes =
          'body' in item && item.body
            ? `Follow-up from ${sourceLabel.toLowerCase().replace('from ', '')}: ${item.title}\n\n${item.body}`
            : `Follow-up from ${sourceLabel.toLowerCase().replace('from ', '')}: ${item.title}`;
        const sourceType =
          'source' in item
            ? null
            : item.type === 'event'
              ? 'calendar_event'
              : item.type === 'note'
                ? 'note'
                : item.type === 'task'
                  ? 'task'
                  : item.type === 'project_action'
                    ? 'project'
                    : null;

        closeItemSheet();
        openFollowUpSheet({
          title: `Follow up: ${item.title}`,
          notes: followUpNotes,
          workspaceId: item.workspaceId,
          sourceTitle: item.title,
          sourceType,
          sourceId: 'source' in item ? null : item.sourceId,
          sourceLabel,
          onSaved: () => {
            void loadToday({ silent: true });
          },
        });
        return;
      }

      if (actionId === 'add_note' && 'type' in item && item.type === 'event') {
        closeItemSheet();
        openQuickNoteSheet({
          sourceLabel: `From event · ${item.title}`,
          workspaceId: item.workspaceId,
          onSaved: () => {
            void loadToday({ silent: true });
          },
        });
        return;
      }

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
    [applyOptimisticTodayAction, loadToday, openFollowUpSheet, openQuickNoteSheet, showActionError],
  );

  const openItemSheet = (item: MobileTodayInteractionItem, mode: TodayDetailSheetMode) => {
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
            flexGrow: 1,
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
          <View style={{ gap: theme.spacing['2xl'], flex: 1 }}>
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
                notes={today.notes ?? []}
                showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                onItemPress={(item) => {
                  openItemSheet(item, 'detail');
                }}
            onItemLongPress={async (item) => {
                    await triggerLightHaptic();
                    openItemSheet(item, 'actions');
                  }}
                />
            ) : (
              <EmptyState
                iconName="tray"
                title="Nothing needs attention."
                description="Capture something new or enjoy the quiet."
              />
            )}
          </View>
        </Animated.ScrollView>

        {sheetMode === 'detail' ? (
          <TodayItemDetailSheet
            visible={Boolean(selectedItem)}
            item={selectedItem}
            mode={sheetMode}
            onClose={closeItemSheet}
            onAction={handleTodayItemAction}
          />
        ) : (
          <>
            {sheetMode === 'actions' ? (
              <TodayItemActionsSheet
                visible={Boolean(selectedItem)}
                item={selectedItem}
                onClose={closeItemSheet}
                onAction={handleTodayItemAction}
              />
            ) : null}
            {sheetMode === 'edit' || sheetMode === 'reschedule' ? (
              <TodayItemEditSheet
                visible={Boolean(selectedItem)}
                item={selectedItem}
                mode={sheetMode}
                onClose={closeItemSheet}
                onSaved={() => void loadToday({ silent: true })}
              />
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
