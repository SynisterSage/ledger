import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Alert, Animated, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter, useFocusEffect } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { MOBILE_PULL_TO_REFRESH_OFFSET } from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TodayList } from '@/features/today/TodayList';
import { FocusPickerSheet } from '@/features/today/FocusPickerSheet';
import {
  TodayItemDetailSheet,
  type TodayDetailSheetMode,
} from '@/features/today/TodayItemDetailSheet';
import { TodayItemActionsSheet } from '@/features/today/TodayItemActionsSheet';
import { openMobileNote } from '@/features/notes/openMobileNote';
import { TodayItemEditSheet } from '@/features/today/TodayItemEditSheet';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { TODAY_HEADER_SCROLL_SPACE, TodayHeader } from '@/features/today/TodayHeader';
import { useFollowUpSheet } from '@/features/followup/FollowUpSheetContext';
import { useQuickNoteSheet } from '@/features/quicknote/QuickNoteSheetContext';
import type { QuickNoteSavedNote } from '@/features/quicknote/QuickNoteSheetContext';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { triggerLightHaptic } from '@/lib/haptics';
import { getMobileToday } from '@/api/today';
import { performMobileTodayAction } from '@/api/todayActions';
import { useMobileUnreadNotificationCount } from '@/features/notifications/useMobileUnreadNotificationCount';
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
  projects: [],
  mentions: [],
  teamActivity: [],
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
  const { openSearch } = useSearchSheet();
  const [today, setToday] = useState<MobileTodayResponse>(EMPTY_TODAY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MobileTodayInteractionItem | null>(null);
  const [sheetMode, setSheetMode] = useState<TodayDetailSheetMode>('detail');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const unreadNotificationCount = useMobileUnreadNotificationCount(workspaceState.selectedWorkspaceId);
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const [surfaceSection, setSurfaceSection] = useState<'today' | 'attention' | 'next-up' | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<
    Partial<
      Record<'focus' | 'next-up' | 'attention' | 'today' | 'projects' | 'intake' | 'notes' | 'team-activity', boolean>
    >
  >({});
  const scrollViewRef = useRef<ScrollView | null>(null);

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
        setFocusOrder((current) => {
          const responseOrder = response.today.filter((item) => item.type === 'focus').map((item) => item.id);
          return current.length
            ? current
                .filter((id) => responseOrder.includes(id))
                .concat(responseOrder.filter((id) => !current.includes(id)))
            : responseOrder;
        });
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

  const toggleSection = (
    section: 'focus' | 'next-up' | 'attention' | 'today' | 'projects' | 'intake' | 'notes' | 'team-activity',
  ) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const surface = (section: 'today' | 'attention' | 'next-up') => {
    setSurfaceSection((current) => (current === section ? null : section));
  };

  const attentionCount = new Set([
    ...today.today.filter((item) => item.status === 'overdue').map((item) => item.id),
    ...(today.projects ?? []).filter((project) => Boolean(project.attentionReason)).map((project) => project.id),
  ]).size;
  const teamMentionCount = workspaceState.selectedWorkspaceId !== 'all' ? (today.mentions ?? []).length : 0;
  const todayCount = today.today.filter((item) => item.type !== 'focus' && item.status !== 'overdue').length;
  const eventCount =
    today.upcoming.filter((item) => item.type === 'event').length +
    today.today.filter((item) => item.type === 'event').length;
  const focusedItems = today.today.filter((item) => item.type === 'focus');
  const focusCandidates = useMemo(() => {
    const candidates = [
      ...today.today.filter((item) => item.type === 'task' && item.status !== 'overdue'),
      ...today.today.filter((item) => item.type === 'task' && item.status === 'overdue'),
      ...today.upcoming.filter((item) => item.type === 'task'),
    ];
    const focusedIds = new Set(focusedItems.map((item) => item.id));
    return candidates.filter(
      (item, index, all) =>
        !focusedIds.has(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index,
    );
  }, [focusedItems, today.today, today.upcoming]);

  const moveFocus = (item: MobileTodayItem, direction: -1 | 1) => {
    setFocusOrder((current) => {
      const ids = current.length ? [...current] : focusedItems.map((entry) => entry.id);
      const index = ids.indexOf(item.id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
      [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
      return ids;
    });
  };

  const openCalendarDay = () => {
    const baseUrl = process.env.VITE_LEDGER_WEB_URL;
    if (!baseUrl) {
      showActionError('Calendar is available from Ledger desktop.');
      return;
    }
    void Linking.openURL(
      `${baseUrl.replace(/\/$/, '')}/calendar?view=day&date=${encodeURIComponent(today.date)}`,
    );
  };

  const handleQuickNoteSaved = (note: QuickNoteSavedNote) => {
    setToday((current) => {
      const noteId = note.id ? `note:${note.id}` : `note:quick:${Date.now()}`;
      const nextNote = {
        id: noteId,
        type: 'note' as const,
        title: note.title,
        workspaceId: note.workspaceId,
        workspaceName: workspaceState.options.find((option) => option.id === note.workspaceId)?.name ?? null,
        sourceType: 'note' as const,
        sourceId: note.id ?? noteId,
        body: note.content,
        updatedAt: note.createdAt,
        createdAt: note.createdAt,
      };
      return {
        ...current,
        notes: [nextNote, ...current.notes.filter((entry) => entry.id !== noteId)].slice(0, 10),
      };
    });
  };

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
          const nextUrgency = item.type === 'focus' ? item.urgency ?? 'Low' : 'Low';
          const nextFocusItem = 'dueLabel' in item
            ? ({
                ...item,
                type: 'focus',
                meta: `Focus · ${nextUrgency}`,
                urgency: nextUrgency,
                dueLabel: 'Today',
              } as MobileTodayItem)
            : ({
                id: item.id,
                title: item.title,
                workspaceId: item.workspaceId,
                workspaceName: item.workspaceName,
                meta: `Focus · ${nextUrgency}`,
                dueLabel: 'Today',
                status: 'active',
                sourceType: 'task',
                sourceId: item.sourceId,
                startsAt: item.startsAt,
                endsAt: item.endsAt,
                timeLabel: item.timeLabel,
                dateLabel: item.dateLabel,
                urgency: nextUrgency,
                type: 'focus',
              } as MobileTodayItem);
          return {
            ...current,
            upcoming: current.upcoming.filter((entry) => entry.id !== item.id),
            today: current.today.some((entry) => entry.id === item.id)
              ? current.today.map((entry) => (entry.id === item.id ? nextFocusItem : entry))
              : [...current.today, nextFocusItem],
          };
        }

        if (actionId === 'remove_focus' && item.type === 'focus') {
          return {
            ...current,
            today: current.today.map((entry) =>
              entry.id === item.id
                ? ({
                    ...entry,
                    type: 'task',
                    meta: entry.meta.replace(/^Focus\s*·\s*/, ''),
                    urgency: null,
                  } as MobileTodayItem)
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
    async (actionId: string, item: MobileTodayInteractionItem, confirmed = false) => {
      if (actionId === 'delete' && !confirmed) {
        Alert.alert(
          'Delete item?',
          `This will permanently delete “${item.title}”.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => void handleTodayItemAction(actionId, item, true),
            },
          ],
        );
        return;
      }

      if (actionId === 'open_project' && 'type' in item && item.type === 'project') {
        closeItemSheet();
        router.push(`/project/${encodeURIComponent(item.sourceId)}`);
        return;
      }

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
            ? `Follow-up from ${sourceLabel.toLowerCase().replace('from ', '')}: ${item.title}\n\n${
                item.body
              }`
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
        const canStayOptimistic = 'source' in item && (actionId === 'archive' || actionId === 'delete');
        if (result.refresh && !canStayOptimistic) {
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
        <TodayHeader
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceLoading={workspaceState.isLoading}
          workspaceExpanded={workspacePickerOpen}
          unreadCount={unreadNotificationCount}
          onWorkspacePress={openWorkspaceSwitcher}
          onSearchPress={openSearch}
          onNotificationsPress={() => router.push({ pathname: '/notifications', params: { returnTo: '/(tabs)/today' } })}
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
        <FocusPickerSheet
          visible={focusPickerOpen}
          focused={focusedItems}
          candidates={focusCandidates}
          onClose={() => setFocusPickerOpen(false)}
          onSelect={(item) => {
            void triggerLightHaptic();
            void handleTodayItemAction('add_focus', item);
          }}
          onRemove={(item) => {
            void triggerLightHaptic();
            void handleTodayItemAction('remove_focus', item);
          }}
          onMove={moveFocus}
          onCreateTask={() => {
            setFocusPickerOpen(false);
            router.push('/capture/task');
          }}
        />

        <Animated.ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: TODAY_HEADER_SCROLL_SPACE,
            paddingBottom: theme.spacing['3xl'] + 132,
            flexGrow: 1,
          }}
          contentInsetAdjustmentBehavior="always"
          automaticallyAdjustsScrollIndicatorInsets
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
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: theme.spacing.lg, flex: 1 }}>
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
            ) : (
              <>
                <View style={[styles.summary, { borderColor: theme.colors.borderSubtle }]}>
                  <SummaryButton
                    icon={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
                    label={`${todayCount} today`}
                    active={surfaceSection === 'today'}
                    onPress={() => surface('today')}
                  />
                  <SummaryButton
                    icon={{ ios: 'exclamationmark.triangle', android: 'warning_amber', web: 'warning_amber' }}
                    label={`${attentionCount + teamMentionCount} attention`}
                    active={surfaceSection === 'attention'}
                    onPress={() => surface('attention')}
                  />
                  <SummaryButton
                    icon={{ ios: 'calendar', android: 'event', web: 'event' }}
                    label={`${eventCount} events`}
                    active={surfaceSection === 'next-up'}
                    onPress={() => surface('next-up')}
                  />
                </View>
                <TodayList
                  upcoming={today.upcoming}
                  today={today.today}
                  captures={today.captures}
                  projects={today.projects ?? []}
                  notes={today.notes ?? []}
                  mentions={today.mentions ?? []}
                  teamActivity={today.teamActivity ?? []}
                  isTeamWorkspace={workspaceState.selectedWorkspaceId !== 'all' && workspaceState.options.find((option) => option.id === workspaceState.selectedWorkspaceId)?.type === 'workspace'}
                  focusOrder={focusOrder}
                  showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                  collapsedSections={collapsedSections}
                  surfaceSection={surfaceSection}
                  onToggleSection={toggleSection}
                  onAddFocus={() => setFocusPickerOpen(true)}
                  onViewDay={openCalendarDay}
                  onQuickNote={() =>
                    openQuickNoteSheet({
                      workspaceId:
                        workspaceState.selectedWorkspaceId === 'all'
                          ? null
                          : workspaceState.selectedWorkspaceId,
                      onSaved: handleQuickNoteSaved,
                    })
                  }
                  onTeamItemPress={(sourceType, sourceId) => {
                    if (sourceType === 'mention') {
                      router.push({ pathname: '/notifications', params: { returnTo: '/(tabs)/today' } });
                    } else if (sourceId) {
                      router.push({ pathname: '/notifications', params: { returnTo: '/(tabs)/today' } });
                    }
                  }}
                  onItemPress={(item) => {
                    if ('type' in item && item.type === 'project') {
                      router.push(`/project/${encodeURIComponent(item.sourceId)}`);
                    } else if ('type' in item && item.type === 'note') {
                      openMobileNote(router, item.sourceId, { workspaceId: item.workspaceId, returnTo: '/(tabs)/today' });
                    } else {
                      openItemSheet(item, 'detail');
                    }
                  }}
                  onItemLongPress={async (item) => {
                    await triggerLightHaptic();
                    openItemSheet(item, 'actions');
                  }}
                  onItemComplete={(item) => {
                    void triggerLightHaptic();
                    void handleTodayItemAction(
                      'type' in item && item.type === 'focus' ? 'mark_done' : 'complete',
                      item,
                    );
                  }}
                  onItemAction={(actionId, item) => {
                    void triggerLightHaptic();
                    void handleTodayItemAction(actionId, item);
                  }}
                />
                {surfaceSection === 'today' && todayCount === 0 ? (
                  <SurfaceEmptyState message="Nothing due today" />
                ) : null}
                {surfaceSection === 'attention' && attentionCount + teamMentionCount === 0 ? (
                  <SurfaceEmptyState message="Nothing needs attention" />
                ) : null}
                {surfaceSection === 'next-up' && eventCount === 0 ? (
                  <SurfaceEmptyState message="No events coming up" />
                ) : null}
              </>
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
                onOpen={(item) => {
                  if ('type' in item && item.type === 'project') {
                    closeItemSheet();
                    router.push(`/project/${encodeURIComponent(item.sourceId)}`);
                  } else if ('type' in item && item.type === 'note') {
                    closeItemSheet();
                    openMobileNote(router, item.sourceId, { workspaceId: item.workspaceId, returnTo: '/(tabs)/today' });
                  } else {
                    openItemSheet(item, 'detail');
                  }
                }}
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

function SummaryButton({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: ComponentProps<typeof SymbolView>['name'];
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useLedgerTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.summaryButton, { opacity: pressed ? 0.55 : active ? 1 : 0.86 }]}
    >
      <View style={styles.summaryButtonContent}>
        <SymbolView name={icon} size={14} weight="medium" tintColor={active ? theme.colors.textPrimary : theme.colors.textMuted} />
        <AppText variant="meta" style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary }}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

function SurfaceEmptyState({ message }: { message: string }) {
  const theme = useLedgerTheme();
  return (
    <View style={styles.surfaceEmpty}>
      <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    marginBottom: 2,
  },
  summaryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  summaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  surfaceEmpty: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
