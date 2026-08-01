import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { getMobileToday } from '@/api/today';
import { useLedgerTheme } from '@/theme';
import { useWorkspaceState } from '@/store/workspaceStore';
import type { MobileTodayProject } from '@/types/ledger';

export default function MobileProjectScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const params = useLocalSearchParams<{ id: string }>();
  const [project, setProject] = useState<MobileTodayProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMobileToday({ workspaceId: workspaceState.selectedWorkspaceId }).then(
      (response) => {
        if (!cancelled) {
          setProject((response.projects ?? []).find((item) => item.sourceId === params.id || item.id === params.id) ?? null);
        }
      },
      () => {
        if (!cancelled) setError('Could not load this project.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [params.id, workspaceState.selectedWorkspaceId]);

  return (
    <Screen contentStyle={{ paddingTop: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={8}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={18} tintColor={theme.colors.textSecondary} />
        </Pressable>
        {error ? <AppText variant="body" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
        {project ? (
          <View style={{ gap: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="screenTitle">{project.title}</AppText>
              <AppText variant="meta">{[project.projectStatus, project.dueLabel].filter(Boolean).join(' · ')}</AppText>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderSubtle }]}>
              <View style={[styles.progressFill, { width: `${project.progress}%`, backgroundColor: theme.colors.accent }]} />
            </View>
            <View style={styles.rows}>
              <ProjectDetailRow label="Progress" value={`${project.progress}%`} />
              <ProjectDetailRow label="Due" value={project.dueLabel} />
              <ProjectDetailRow label="Next action" value={project.nextAction ?? 'No next action'} />
              <ProjectDetailRow label="Today" value={`${project.itemsDueToday} item${project.itemsDueToday === 1 ? '' : 's'} due`} />
            </View>
            {project.attentionReason ? (
              <AppText variant="meta" style={{ color: theme.colors.danger }}>{project.attentionReason}</AppText>
            ) : null}
          </View>
        ) : !error ? (
          <AppText variant="meta">Loading project…</AppText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ProjectDetailRow({ label, value }: { label: string; value: string }) {
  const theme = useLedgerTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: theme.colors.borderSubtle }]}>
      <AppText variant="meta">{label}</AppText>
      <AppText variant="body" numberOfLines={2} style={styles.detailValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 24,
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
  },
  rows: {
    gap: 0,
  },
  detailRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
  },
});
