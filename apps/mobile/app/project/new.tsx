import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { createMobileProject } from '@/api/projects';
import { createMobileProjectAction } from '@/api/captures';
import { getWorkspaceLabel, resolveCaptureWorkspaceId, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';

export default function NewProjectScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => workspaceState.selectedWorkspaceId === 'all' ? resolveCaptureWorkspaceId(workspaceState) : workspaceState.selectedWorkspaceId, [workspaceState]);
  const permissions = useMemo(() => getMobileProjectPermissions(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('NotStarted');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [firstAction, setFirstAction] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setError('Project name is required.'); return; }
    if (workspaceId === 'all') { setError('Choose a workspace before creating a project.'); return; }
    setIsSaving(true); setError(null);
    try {
      const project = await createMobileProject(workspaceId, { name: name.trim(), status, end_date: dueDate.trim() || null, description: description.trim() || null });
      if (firstAction.trim()) {
        try { await createMobileProjectAction(workspaceId, { title: firstAction.trim(), project_id: project.id, show_in_today: true }); }
        catch { Alert.alert('Project created', 'The project was created, but the first action could not be added. You can retry it from the project.'); }
      }
      router.replace(`/project/${project.id}`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not create project.'); }
    finally { setIsSaving(false); }
  };

  if (!permissions.canCreate) return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="New project" /><View style={styles.unavailable}><AppText variant="bodyStrong">Project creation unavailable</AppText><AppText variant="meta">You do not have permission to create projects in this workspace.</AppText><Pressable onPress={() => router.back()}><AppText variant="caption" style={{ color: theme.colors.accent }}>Return</AppText></Pressable></View></Screen>;
  return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
    <CaptureHeader title="New project" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppTextInput label="Project name" placeholder="Name this project" value={name} onChangeText={setName} autoFocus />
      <View style={styles.choice}><AppText variant="body">Workspace</AppText><AppText variant="caption">{getWorkspaceLabel(workspaceId, workspaceState.options)}</AppText></View>
      <View style={styles.choice}><AppText variant="body">Status</AppText><View style={styles.statusRow}>{(['NotStarted', 'InProgress'] as const).map((value) => <Pressable key={value} onPress={() => setStatus(value)}><AppText variant="caption" style={{ color: status === value ? theme.colors.accent : theme.colors.textMuted }}>{value === 'NotStarted' ? 'Planned' : 'Active'}</AppText></Pressable>)}</View></View>
      <AppTextInput label="Due date" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} autoCapitalize="none" />
      <AppTextInput label="First next action" placeholder="Optional" value={firstAction} onChangeText={setFirstAction} />
      <AppTextInput label="Description" placeholder="Optional" value={description} onChangeText={setDescription} multiline />
      {error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
      <AppButton title={isSaving ? 'Creating…' : 'Create project'} size="lg" disabled={isSaving} onPress={() => void save()} />
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({ content: { gap: 18, paddingBottom: 48 }, choice: { minHeight: 44, gap: 4 }, statusRow: { flexDirection: 'row', gap: 20 }, unavailable: { gap: 10, paddingTop: 24 } });
