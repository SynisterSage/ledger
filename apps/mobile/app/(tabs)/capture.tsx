import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { TODAY_HEADER_SCROLL_SPACE, TodayHeader } from '@/features/today/TodayHeader';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { listCaptureOptions } from '@/api/captures';
import { CalendarCreateSheet, type CalendarCreateItemType } from '@/features/calendar/CalendarSheets';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, resolveCaptureWorkspaceId, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import type { CaptureType } from '@/types/ledger';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';

export default function CaptureScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const { openSearch } = useSearchSheet();
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [createType, setCreateType] = useState<CalendarCreateItemType>('event');
  const [recentCaptures, setRecentCaptures] = useState<Array<{ id: string; title: string; type: string; time: string }>>([]);
  const [selectedRecent, setSelectedRecent] = useState<{ id: string; title: string; type: string; time: string } | null>(null);

  const selectedScopeLabel = useMemo(() => {
    return getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options);
  }, [workspaceState.options, workspaceState.selectedWorkspaceId]);
  const captureWorkspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const structuredOptions = useMemo(() => {
    const optionsById = new Map(listCaptureOptions().map((option) => [option.id, option]));
    const captureOrder: CaptureType[] = ['task', 'reminder', 'event', 'note', 'project-action'];
    return captureOrder
      .map((id) => optionsById.get(id))
      .filter((option): option is NonNullable<typeof option> => Boolean(option));
  }, []);

  useEffect(() => {
    void bootstrapWorkspaceState();
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <View style={{ flex: 1 }}>
        <TodayHeader
          workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : selectedScopeLabel}
          workspaceLoading={workspaceState.isLoading}
          workspaceExpanded={workspacePickerOpen}
          onWorkspacePress={() => setWorkspacePickerOpen(true)}
          onSearchPress={openSearch}
          onNotificationsPress={() => router.push({ pathname: '/notifications', params: { returnTo: '/(tabs)/capture' } })}
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
            paddingTop: TODAY_HEADER_SCROLL_SPACE,
            paddingBottom: theme.spacing['3xl'] + 132,
          }}
          contentInsetAdjustmentBehavior="always"
          automaticallyAdjustsScrollIndicatorInsets
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <View style={styles.captureContent}>
            <AppText variant="meta" style={styles.sectionLabel}>Create</AppText>
            <View style={styles.actionList}>
              {structuredOptions.map((option) => (
                <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={`Create ${option.title}`} onPress={() => { setCreateType(option.id === 'project-action' ? 'project_action' : option.id); setCreateSheetOpen(true); }} style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' }]}>
                  <SymbolView name={option.id === 'task' ? { ios: 'checkmark.square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' } : option.id === 'reminder' ? { ios: 'bell', android: 'notifications_none', web: 'notifications_none' } : option.id === 'event' ? { ios: 'calendar', android: 'event', web: 'event' } : option.id === 'note' ? { ios: 'note.text', android: 'note', web: 'note' } : { ios: 'arrow.forward', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' }} size={17} tintColor={theme.colors.textSecondary} />
                  <AppText variant="bodyStrong">{option.title === 'Project action' ? 'Project action' : option.title}</AppText>
                </Pressable>
              ))}
            </View>

            {recentCaptures.length ? <View style={styles.recentSection}><AppText variant="meta" style={styles.sectionLabel}>Recent</AppText>{recentCaptures.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.type}`} onLongPress={() => setSelectedRecent(item)} style={({ pressed }) => [styles.recentRow, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.65 : 1 }]}><View style={styles.recentIcon}><SymbolView name={{ ios: 'note.text', android: 'note', web: 'note' }} size={15} tintColor={theme.colors.textSecondary} /></View><View style={styles.recentCopy}><AppText variant="bodyStrong" numberOfLines={1}>{item.title}</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{item.type} · {item.time}</AppText></View></Pressable>)}</View> : null}
          </View>
        </Animated.ScrollView>
        <AppBottomSheet visible={Boolean(selectedRecent)} onClose={() => setSelectedRecent(null)} title={selectedRecent?.title ?? 'Recent capture'} snapPoints={['30%', '42%']} initialSnapPointIndex={0}>
          <View style={styles.recentActions}>
            <Pressable accessibilityRole="button" onPress={() => { setSelectedRecent(null); router.push('/capture/note'); }} style={styles.recentAction}><AppText variant="bodyStrong">Open</AppText></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { if (selectedRecent) setRecentCaptures((current) => current.filter((item) => item.id !== selectedRecent.id)); setSelectedRecent(null); }} style={styles.recentAction}><AppText variant="bodyStrong" style={{ color: theme.colors.danger }}>Clear from Recent</AppText></Pressable>
          </View>
        </AppBottomSheet>
        <CalendarCreateSheet
          visible={createSheetOpen}
          workspaceId={captureWorkspaceId}
          initialDateKey={formatDateToLocalIsoDate(new Date())}
          initialType={createType}
          onClose={() => setCreateSheetOpen(false)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  captureContent: { gap: 12 },
  sectionLabel: { paddingTop: 10, paddingBottom: 2, fontWeight: '600' },
  actionList: { gap: 2 },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 8, borderRadius: 8 },
  recentSection: { paddingTop: 4 },
  recentRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  recentIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  recentCopy: { flex: 1, gap: 1 },
  recentActions: { gap: 2 },
  recentAction: { minHeight: 48, justifyContent: 'center' },
});
