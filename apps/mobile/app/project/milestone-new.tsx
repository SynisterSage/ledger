import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureFormShell } from '@/components/CaptureFormShell';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { createMobileProjectMilestone } from '@/api/projects';
import { useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';

export default function NewMilestoneScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const { projectId, workspaceId } = useLocalSearchParams<{ projectId: string; workspaceId?: string }>();
  const permissions = getMobileProjectPermissions(workspaceId ?? workspaceState.selectedWorkspaceId, workspaceState.options);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim() || !date.trim()) { setError('Milestone name and date are required.'); return; }
    setSaving(true); setError(null);
    try { await createMobileProjectMilestone(workspaceId ?? workspaceState.selectedWorkspaceId, projectId, { title: title.trim(), milestone_date: date.trim(), note: note.trim() || null }); router.back(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not add milestone.'); }
    finally { setSaving(false); }
  };
  return <Screen topFade={false} contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Add milestone" />{!permissions.canAddMilestone ? <EmptyState iconName={{ ios: 'flag', android: 'flag', web: 'flag' }} title="Milestones are read-only here" description="You can view this project, but milestone creation is unavailable in this workspace." kind="permission" density="compact" primaryAction={{ label: 'Back to project', variant: 'link', onPress: () => router.back() }} /> : <CaptureFormShell footer={<AppButton title={saving ? 'Saving…' : 'Add milestone'} size="lg" disabled={saving} onPress={() => void save()} />}><View style={styles.content}><View style={[styles.titleCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput label="Milestone name" placeholder="What is due?" value={title} onChangeText={setTitle} autoFocus style={styles.cardInput} /></View><View style={[styles.dateCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} autoCapitalize="none" style={styles.cardInput} /></View><View style={[styles.notesCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput label="Notes" placeholder="Optional" value={note} onChangeText={setNote} multiline style={styles.cardInput} /></View>{error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}</View></CaptureFormShell>}</Screen>;
}
const styles = StyleSheet.create({ content: { gap: 14, paddingBottom: 48 }, titleCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 }, dateCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 }, notesCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 }, cardInput: { borderBottomWidth: 0 }, unavailable: { paddingTop: 24 } });
