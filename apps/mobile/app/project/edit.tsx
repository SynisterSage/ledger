import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureFormShell } from '@/components/CaptureFormShell';
import { Row } from '@/components/Row';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { getMobileProjectDetail } from '@/api/projectDetail';
import { updateMobileProject } from '@/api/projects';
import { useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { formatCaptureDateLabel, parseMobileDateInput } from '@/features/capture/dateUtils';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';

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
  const [datePicker, setDatePicker] = useState<'start' | 'due' | null>(null);
  const parsedStartDate = useMemo(() => parseMobileDateInput(startDate, new Date()), [startDate]);
  const parsedDueDate = useMemo(() => parseMobileDateInput(dueDate, new Date()), [dueDate]);
  useEffect(() => { void getMobileProjectDetail(id, workspaceState.selectedWorkspaceId).then(({ project }) => { setName(project.name); setStatus(project.status ?? 'InProgress'); setStartDate(project.start_date ?? ''); setDueDate(project.end_date ?? ''); setProgress(project.completeness == null ? '' : String(project.completeness)); setDescription(project.description ?? ''); }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load project.')).finally(() => setLoading(false)); }, [id, workspaceState.selectedWorkspaceId]);
  const save = async () => { if (!name.trim()) { setError('Project name is required.'); return; } setSaving(true); setError(null); try { await updateMobileProject(workspaceId ?? workspaceState.selectedWorkspaceId, id, { name: name.trim(), status: status || undefined, start_date: startDate.trim() || null, end_date: dueDate.trim() || null, completeness: progress.trim() ? Number(progress) : null, description: description.trim() || null }); router.back(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not update project.'); } finally { setSaving(false); } };
  return <Screen topFade={false} contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Edit project" />{!loading && !permissions.canEdit ? <View style={styles.unavailable}><AppText variant="bodyStrong">Project is read-only</AppText><AppText variant="meta">You do not have permission to edit this project.</AppText></View> : <CaptureFormShell footer={!loading ? <AppButton title={saving ? 'Saving…' : 'Save changes'} size="lg" disabled={saving} onPress={() => void save()} /> : undefined}><View style={styles.content}>{loading ? <AppText variant="meta">Loading project…</AppText> : <><View style={[styles.titleCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput label="Name" value={name} onChangeText={setName} style={styles.cardInput} /></View><View style={[styles.detailsCard, { backgroundColor: theme.colors.surfaceMuted }]}><View style={styles.status}><AppText variant="body">Status</AppText><AppText variant="caption">{status || 'Active'}</AppText></View><Row title="Start date" subtitle={startDate ? formatCaptureDateLabel(startDate) : 'Optional'} onPress={() => setDatePicker('start')} chevron titleVariant="body" bordered={false} /><Row title="Due date" subtitle={dueDate ? formatCaptureDateLabel(dueDate) : 'Optional'} onPress={() => setDatePicker('due')} chevron titleVariant="body" bordered={false} /><AppTextInput label="Progress" placeholder="0–100" keyboardType="numeric" value={progress} onChangeText={setProgress} style={styles.cardInput} /></View><View style={[styles.descriptionCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput label="Description" value={description} onChangeText={setDescription} multiline style={styles.cardInput} /></View>{error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}</>}</View><CaptureDateTimePickerSheet visible={datePicker === 'start'} title="Select start date" mode="date" value={parsedStartDate} onSelect={(value) => { setStartDate(formatDateToLocalIsoDate(value)); setDatePicker(null); }} onClose={() => setDatePicker(null)} /><CaptureDateTimePickerSheet visible={datePicker === 'due'} title="Select due date" mode="date" value={parsedDueDate} onSelect={(value) => { setDueDate(formatDateToLocalIsoDate(value)); setDatePicker(null); }} onClose={() => setDatePicker(null)} /></CaptureFormShell>}</Screen>;
}
const styles = StyleSheet.create({ content: { gap: 14 }, titleCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 }, detailsCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10, gap: 4 }, descriptionCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 }, cardInput: { borderBottomWidth: 0 }, status: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, unavailable: { gap: 10, paddingTop: 24 } });
