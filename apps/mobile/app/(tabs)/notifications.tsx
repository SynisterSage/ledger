import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { MobilePageHeader, MOBILE_PAGE_HEADER_SCROLL_SPACE } from '@/components/MobilePageHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { NotificationList } from '@/features/notifications/NotificationList';
import { listNotifications } from '@/api/notifications';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';

export default function NotificationsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);

  const items = useMemo(() => {
    const all = listNotifications();
    if (workspaceState.selectedWorkspaceId === 'all') return all;
    return all.filter((item) => item.workspace.id === workspaceState.selectedWorkspaceId);
  }, [workspaceState.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <MobilePageHeader
          title="Notifications"
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceExpanded={workspacePickerOpen}
          onWorkspacePress={() => setWorkspacePickerOpen(true)}
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
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.lg }}>
            <AppText variant="body">3 active</AppText>
          </View>
          <NotificationList items={items} />
        </Animated.ScrollView>
      </View>
    </Screen>
  );
}
