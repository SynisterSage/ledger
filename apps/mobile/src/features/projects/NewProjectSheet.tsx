import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { createMobileProjectAction } from '@/api/captures';
import { createMobileProject, createMobileProjectMilestone } from '@/api/projects';
import { getWorkspaceLabel, resolveCaptureWorkspaceId, useWorkspaceState } from '@/store/workspaceStore';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';
import { formatCaptureDateLabel, parseMobileDateInput } from '@/features/capture/dateUtils';
import { getMobileProjectPermissions } from './projectPermissions';
import { useLedgerTheme } from '@/theme';

type CreateMode = 'project' | 'milestone';

type NewProjectSheetProps = {
  visible: boolean;
  initialMode?: CreateMode;
  onClose: () => void;
  onCreated: (projectId?: string) => void;
};

export function NewProjectSheet({ visible, initialMode = 'project', onClose, onCreated }: NewProjectSheetProps) {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => workspaceState.selectedWorkspaceId === 'all' ? resolveCaptureWorkspaceId(workspaceState) : workspaceState.selectedWorkspaceId, [workspaceState]);
  const permissions = useMemo(() => getMobileProjectPermissions(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const [mode, setMode] = useState<CreateMode>('project');
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState('NotStarted');
  const [dueDate, setDueDate] = useState('');
  const [firstAction, setFirstAction] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDate, setMilestoneDate] = useState('');
  const [milestoneNote, setMilestoneNote] = useState('');
  const [milestoneProjectId, setMilestoneProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [dueDatePickerOpen, setDueDatePickerOpen] = useState(false);
  const [milestoneDatePickerOpen, setMilestoneDatePickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) { setMode(initialMode); return; }
    setMode(initialMode); setProjectName(''); setStatus('NotStarted'); setDueDate(''); setFirstAction(''); setDescription(''); setMilestoneTitle(''); setMilestoneDate(''); setMilestoneNote(''); setMilestoneProjectId(null); setError(null);
    setProjectPickerOpen(false); setDueDatePickerOpen(false); setMilestoneDatePickerOpen(false);
  }, [initialMode, visible]);

  const selectedProjectLabel = projects.find((project) => project.id === milestoneProjectId)?.name ?? 'Choose project';
  const parsedDueDate = useMemo(() => parseMobileDateInput(dueDate, new Date()), [dueDate]);
  const parsedMilestoneDate = useMemo(() => parseMobileDateInput(milestoneDate, new Date()), [milestoneDate]);
  const typeLabel = mode === 'project' ? 'Project' : 'Milestone';
  const save = async () => {
    if (!permissions.canCreate || workspaceId === 'all') { setError('Creation is unavailable in this workspace.'); return; }
    if (mode === 'project' && !projectName.trim()) { setError('Project name is required.'); return; }
    if (mode === 'milestone' && (!milestoneTitle.trim() || !milestoneDate.trim() || !milestoneProjectId)) { setError('Milestone, date, and project are required.'); return; }
    setSaving(true); setError(null);
    try {
      if (mode === 'project') {
        const project = await createMobileProject(workspaceId, { name: projectName.trim(), status, end_date: dueDate.trim() || null, description: description.trim() || null });
        if (firstAction.trim()) {
          try { await createMobileProjectAction(workspaceId, { title: firstAction.trim(), project_id: project.id, show_in_today: true }); }
          catch { Alert.alert('Project created', 'The project was created, but the first action could not be added.'); }
        }
        onClose(); onCreated(project.id);
      } else {
        await createMobileProjectMilestone(workspaceId, milestoneProjectId!, { title: milestoneTitle.trim(), milestone_date: milestoneDate.trim(), note: milestoneNote.trim() || null });
        onClose(); onCreated();
      }
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : `Could not create ${typeLabel.toLowerCase()}.`); }
    finally { setSaving(false); }
  };

  const titleContent = <View style={styles.createHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close create sheet" onPress={onClose} style={styles.createHeaderButton}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={theme.colors.textPrimary} /></Pressable><View style={styles.typeSwitcher}><Pressable accessibilityRole="button" accessibilityLabel="Create project" onPress={() => { setMode('project'); setError(null); }} style={[styles.typeSwitchButton, mode === 'project' && { backgroundColor: theme.colors.surfaceMuted }]}><SymbolView name={{ ios: 'folder', android: 'folder', web: 'folder' }} size={17} tintColor={mode === 'project' ? theme.colors.accent : theme.colors.textSecondary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Create milestone" onPress={() => { setMode('milestone'); setError(null); }} style={[styles.typeSwitchButton, mode === 'milestone' && { backgroundColor: theme.colors.surfaceMuted }]}><SymbolView name={{ ios: 'flag', android: 'flag', web: 'flag' }} size={17} tintColor={mode === 'milestone' ? theme.colors.accent : theme.colors.textSecondary} /></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel={`Save ${typeLabel}`} onPress={() => void save()} disabled={saving} style={styles.createHeaderButton}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={21} tintColor={saving ? theme.colors.textMuted : theme.colors.accent} /></Pressable></View>;
  const form = (
    <View style={styles.form}>
      <View style={styles.formIntro}>
        <AppText variant="sectionTitle">New {typeLabel.toLowerCase()}</AppText>
        <AppText variant="caption">{mode === 'project' ? 'Start organizing work in Ledger.' : 'Add a date to a project.'}</AppText>
      </View>

      {mode === 'project' ? (
        <>
          <View style={[styles.titleGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppTextInput label="Project name" placeholder="Name this project" value={projectName} onChangeText={setProjectName} />
          </View>

          <View style={[styles.fieldGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View style={styles.choice}>
              <AppText variant="body">Workspace</AppText>
              <AppText variant="caption">{getWorkspaceLabel(workspaceId, workspaceState.options)}</AppText>
            </View>
            <View style={styles.choice}>
              <AppText variant="body">Status</AppText>
              <View style={[styles.statusSwitcher, { backgroundColor: theme.colors.surface }]}>
                {(['NotStarted', 'InProgress'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: status === value }}
                    onPress={() => setStatus(value)}
                    style={[styles.statusOption, status === value && { backgroundColor: theme.colors.surfaceMuted }]}>
                    <AppText
                      variant="caption"
                      style={{ color: status === value ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: status === value ? '600' : '400' }}>
                      {value === 'NotStarted' ? 'Planned' : 'Active'}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
            <Row
              title="Due date"
              subtitle={dueDate ? formatCaptureDateLabel(dueDate) : 'Optional'}
              onPress={() => setDueDatePickerOpen(true)}
              chevron
              titleVariant="body"
              bordered={false}
            />
          </View>

          <View style={[styles.inputGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppTextInput label="First next action" placeholder="Optional" value={firstAction} onChangeText={setFirstAction} style={styles.cardInput} />
            <AppTextInput label="Description" placeholder="Optional" value={description} onChangeText={setDescription} multiline style={styles.cardInput} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.titleGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppTextInput label="Milestone name" placeholder="What is due?" value={milestoneTitle} onChangeText={setMilestoneTitle} />
          </View>
          <View style={[styles.fieldGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Row
              title="Date"
              subtitle={milestoneDate ? formatCaptureDateLabel(milestoneDate) : 'Choose date'}
              onPress={() => setMilestoneDatePickerOpen(true)}
              chevron
              titleVariant="body"
              bordered={false}
            />
            <Row title="Project" subtitle={selectedProjectLabel} onPress={() => setProjectPickerOpen(true)} chevron titleVariant="body" bordered={false} />
          </View>
          <View style={[styles.inputGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppTextInput label="Notes" placeholder="Optional" value={milestoneNote} onChangeText={setMilestoneNote} multiline style={styles.cardInput} />
          </View>
        </>
      )}

      {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
    </View>
  );

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={titleContent} snapPoints={['82%', '100%']} initialSnapPointIndex={1} maxHeight={Math.max(560, windowHeight - insets.top)} dragCloseThreshold={24} dragCloseVelocityThreshold={0.35} dragCloseSnapMargin={4} dismissKeyboardOnBackdropPress>
      {form}
      <ProjectPickerSheet visible={projectPickerOpen} projects={projects} selectedProjectId={milestoneProjectId} onSelect={(next) => { setMilestoneProjectId(next); setProjectPickerOpen(false); }} onClose={() => setProjectPickerOpen(false)} loading={projectsLoading} />
      <CaptureDateTimePickerSheet visible={dueDatePickerOpen} title="Select due date" mode="date" value={parsedDueDate} onSelect={(next) => setDueDate(formatDateToLocalIsoDate(next))} onClose={() => setDueDatePickerOpen(false)} />
      <CaptureDateTimePickerSheet visible={milestoneDatePickerOpen} title="Select date" mode="date" value={parsedMilestoneDate} onSelect={(next) => setMilestoneDate(formatDateToLocalIsoDate(next))} onClose={() => setMilestoneDatePickerOpen(false)} />
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14, paddingBottom: 8 },
  formIntro: { gap: 2, paddingTop: 2 },
  createHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  createHeaderButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  typeSwitcher: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  typeSwitchButton: { width: 34, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  titleGroup: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
  fieldGroup: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 18, gap: 2 },
  inputGroup: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, gap: 14 },
  cardInput: { borderBottomWidth: 0 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusSwitcher: { flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 10, gap: 2 },
  statusOption: { minWidth: 64, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
});
