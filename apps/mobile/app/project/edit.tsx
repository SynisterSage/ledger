import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { getMobileProjectDetail } from '@/api/projectDetail';
import { updateMobileProject } from '@/api/projects';
import { useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';

export default function EditProjectScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const { id, workspaceId } = useLocalSearchParams<{ id: string; workspaceId?: string }>();
  const permissions = getMobileProjectPermissions(workspaceId ?? workspaceState.selectedWorkspaceId, workspaceState.options);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [progress, setProgress] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void getMobileProjectDetail(id, workspaceState.selectedWorkspaceId).then(({ project }) => { setName(project.name); setStatus(project.status ?? 'InProgress'); setStartDate(project.start_date ?? ''); setDueDate(project.end_date ?? ''); setProgress(project.completeness == null ? '' : String(project.completeness)); setDescription(project.description ?? ''); }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load project.')).finally(() => setLoading(false)); }, [id, workspaceState.selectedWorkspaceId]);
  const save = async () => { if (!name.trim()) { setError('Project name is required.'); return; } setSaving(true); setError(null); try { await updateMobileProject(workspaceId ?? workspaceState.selectedWorkspaceId, id, { name: name.trim(), status: status || undefined, start_date: startDate.trim() || null, end_date: dueDate.trim() || null, completeness: progress.trim() ? Number(progress) : null, description: description.trim() || null }); router.back(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not update project.'); } finally { setSaving(false); } };
  return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Edit project" />{!loading && !permissions.canEdit ? <View style={styles.unavailable}><AppText variant="bodyStrong">Project is read-only</AppText><AppText variant="meta">You do not have permission to edit this project.</AppText></View> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{loading ? <AppText variant="meta">Loading project…</AppText> : <><AppTextInput label="Name" value={name} onChangeText={setName} /><View style={styles.status}><AppText variant="body">Status</AppText><AppText variant="caption">{status || 'Active'}</AppText></View><AppTextInput label="Start date" placeholder="YYYY-MM-DD" value={startDate} onChangeText={setStartDate} /><AppTextInput label="Due date" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} /><AppTextInput label="Progress" placeholder="0–100" keyboardType="numeric" value={progress} onChangeText={setProgress} /><AppTextInput label="Description" value={description} onChangeText={setDescription} multiline />{error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}<AppButton title={saving ? 'Saving…' : 'Save changes'} size="lg" disabled={saving} onPress={() => void save()} /></>}</ScrollView>}</Screen>;
}
const styles = StyleSheet.create({ content: { gap: 18, paddingBottom: 48 }, status: { minHeight: 44, gap: 4 }, unavailable: { gap: 10, paddingTop: 24 } });
