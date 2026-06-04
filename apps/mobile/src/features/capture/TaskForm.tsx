import { useMemo, useState } from 'react';
import { Switch } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { createMobileTask } from '@/api/captures';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useLedgerTheme } from '@/theme';
import { parseDateInputToIsoDate, parseTimeInputTo24Hour } from '@/utils/captureDates';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  useWorkspaceState,
} from '@/store/workspaceStore';

type TaskFormProps = {
  onSave?: () => void;
};

export function TaskForm({ onSave }: TaskFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceId, workspaceState.options),
    [workspaceId, workspaceState.options],
  );
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const [title, setTitle] = useState('Export homepage video');
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showInToday, setShowInToday] = useState(true);
  const [isFocus, setIsFocus] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProjectLabel = useMemo(() => {
    if (!projectId) return 'No project';
    return projects.find((project) => project.id === projectId)?.name ?? 'No project';
  }, [projectId, projects]);
  const canSave = Boolean(title.trim()) && workspaceId !== 'all';

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    const dueDate = parseDateInputToIsoDate(dateInput);
    const dueTime = dueDate ? parseTimeInputTo24Hour(timeInput) : null;

    setIsSaving(true);
    setError(null);

    try {
      await createMobileTask(workspaceId, {
        title: title.trim(),
        due_date: dueDate,
        due_time: dueTime,
        notes: notes.trim() || null,
        project_id: projectId,
        show_in_today: showInToday,
        is_today_focus: isFocus,
      });
      onSave?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save task.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section>
      <AppTextInput label="Title" placeholder="Export homepage video" value={title} onChangeText={setTitle} />
      <AppTextInput label="Due date" placeholder="Optional" value={dateInput} onChangeText={setDateInput} />
      <AppTextInput label="Due time" placeholder="Optional" value={timeInput} onChangeText={setTimeInput} />
      <AppTextInput label="Notes" placeholder="Add details or context" multiline value={notes} onChangeText={setNotes} />
      <Row
        title="Workspace"
        subtitle={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel}
      />
      <Row
        title="Project"
        subtitle={selectedProjectLabel}
        onPress={() => setProjectPickerOpen(true)}
        right={<SymbolView name="chevron.down" size={14} weight="regular" tintColor={theme.colors.textSecondary} />}
      />
      <Row
        title="Show in Today"
        subtitle={showInToday ? 'On' : 'Off'}
        right={
          <Switch
            value={showInToday}
            onValueChange={setShowInToday}
            thumbColor={theme.colors.surface}
            trackColor={{ false: theme.colors.borderSubtle, true: theme.colors.accent }}
          />
        }
      />
      <Row
        title="Focus item"
        subtitle={isFocus ? 'On' : 'Off'}
        right={
          <Switch
            value={isFocus}
            onValueChange={setIsFocus}
            thumbColor={theme.colors.surface}
            trackColor={{ false: theme.colors.borderSubtle, true: theme.colors.accent }}
          />
        }
      />
      {error ? (
        <AppText variant="meta" style={{ color: theme.colors.danger }}>
          {error}
        </AppText>
      ) : null}
      <AppButton title={isSaving ? 'Saving…' : 'Save task'} disabled={!canSave || isSaving} onPress={handleSave} />

      <ProjectPickerSheet
        visible={projectPickerOpen}
        projects={projects}
        selectedProjectId={projectId}
        onSelect={setProjectId}
        onClose={() => setProjectPickerOpen(false)}
        loading={projectsLoading}
      />
    </Section>
  );
}
