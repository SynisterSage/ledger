import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TODAY_HEADER_SCROLL_SPACE, TodayHeader } from '@/features/today/TodayHeader';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';

export function MobileEmptyTabPage() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const { openSearch } = useSearchSheet();
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options),
    [workspaceState.options, workspaceState.selectedWorkspaceId],
  );

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <TodayHeader
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel}
          workspaceLoading={workspaceState.isLoading}
          workspaceExpanded={workspacePickerOpen}
          onWorkspacePress={() => setWorkspacePickerOpen(true)}
          onSearchPress={openSearch}
          onNotificationsPress={() => router.push('/(tabs)/notifications')}
          scrollY={scrollY}
        />
        <WorkspaceSelectorSheet
          visible={workspacePickerOpen}
          selectedWorkspaceId={workspaceState.selectedWorkspaceId}
          workspaces={workspaceState.options}
          onSelect={(workspaceId) => selectWorkspace(workspaceId)}
          onClose={() => setWorkspacePickerOpen(false)}
        />
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: TODAY_HEADER_SCROLL_SPACE,
            paddingBottom: theme.spacing['3xl'] + 132,
            flexGrow: 1,
          }}
          contentInsetAdjustmentBehavior="always"
          automaticallyAdjustsScrollIndicatorInsets
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </Screen>
  );
}
