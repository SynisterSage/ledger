import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { MobilePageHeader, MOBILE_PAGE_HEADER_SCROLL_SPACE } from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TodayList } from '@/features/today/TodayList';
import { TodayItemSheet, type TodaySheetMode } from '@/features/today/TodayItemSheet';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { getMobileToday } from '@/api/today';
import { useLedgerTheme } from '@/theme';
import type {
  MobileTodayInteractionItem,
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
  const workspaceState = useWorkspaceState();
  const [today, setToday] = useState<MobileTodayResponse>(EMPTY_TODAY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MobileTodayInteractionItem | null>(null);
  const [sheetMode, setSheetMode] = useState<TodaySheetMode>('detail');

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  const refreshToday = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshToday();
    }, [refreshToday]),
  );

  useEffect(() => {
    let cancelled = false;

    const loadToday = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getMobileToday({ workspaceId: workspaceState.selectedWorkspaceId });
        if (cancelled) return;
        setToday(response);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load Today.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadToday();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, workspaceState.selectedWorkspaceId]);

  const openWorkspaceSwitcher = () => {
    if (workspaceState.options.length <= 1) return;
    setWorkspacePickerOpen(true);
  };

  const hasContent =
    today.upcoming.length > 0 || today.today.length > 0 || today.captures.count > 0;

  const closeItemSheet = () => {
    setSelectedItem(null);
  };

  const handleTodayItemAction = (actionId: string, item: MobileTodayInteractionItem) => {
    console.log('[mobile.today.action]', { actionId, itemId: item.id, type: 'source' in item ? 'capture' : item.type });
    closeItemSheet();
  };

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
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={{ gap: theme.spacing['2xl'] }}>
            {isLoading ? (
              <TodaySkeleton />
            ) : error ? (
              <View style={{ gap: theme.spacing.md }}>
                <AppText variant="body">{error || 'Could not load Today.'}</AppText>
                <AppButton
                  title="Retry"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setRefreshNonce((value) => value + 1)}
                />
              </View>
            ) : hasContent ? (
              <TodayList
                upcoming={today.upcoming}
                today={today.today}
                captures={today.captures}
                showWorkspaceNames={workspaceState.selectedWorkspaceId === 'all'}
                onItemPress={(item) => openItemSheet(item, 'detail')}
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
