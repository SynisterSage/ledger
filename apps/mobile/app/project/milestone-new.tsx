import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
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
  return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Add milestone" />{!permissions.canAddMilestone ? <AppText variant="meta" style={styles.unavailable}>Milestone creation is unavailable in this workspace.</AppText> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><AppTextInput label="Milestone name" placeholder="What is due?" value={title} onChangeText={setTitle} autoFocus /><AppTextInput label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} autoCapitalize="none" /><AppTextInput label="Notes" placeholder="Optional" value={note} onChangeText={setNote} multiline />{error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}<AppButton title={saving ? 'Saving…' : 'Add milestone'} size="lg" disabled={saving} onPress={() => void save()} /></ScrollView>}</Screen>;
}
const styles = StyleSheet.create({ content: { gap: 18, paddingBottom: 48 }, unavailable: { paddingTop: 24 } });
