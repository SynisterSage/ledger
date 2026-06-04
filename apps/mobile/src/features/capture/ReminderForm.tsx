import { useMemo, useState } from 'react';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { createMobileReminder } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import { buildLocalIsoDateTime } from '@/utils/captureDates';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  useWorkspaceState,
} from '@/store/workspaceStore';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type ReminderFormProps = {
  onSave?: () => void;
};

export function ReminderForm({ onSave }: ReminderFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceId, workspaceState.options),
    [workspaceId, workspaceState.options],
  );
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const [title, setTitle] = useState('Submit Alfa hours');
  const [dateInput, setDateInput] = useState('tomorrow');
  const [timeInput, setTimeInput] = useState('2:00 PM');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
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

    const remindAt = buildLocalIsoDateTime({
      dateInput,
      timeInput,
      fallbackTime: '2:00 PM',
    });
    if (!remindAt) {
      setError('Enter a valid date and time.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createMobileReminder(workspaceId, {
        title: title.trim(),
        remind_at: remindAt,
        body: notes.trim() || null,
        project_id: projectId,
      });
      onSave?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save reminder.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section>
      <AppTextInput label="Title" placeholder="Submit Alfa hours" value={title} onChangeText={setTitle} />
      <AppTextInput label="Date" placeholder="Tomorrow" value={dateInput} onChangeText={setDateInput} />
      <AppTextInput label="Time" placeholder="2:00 PM" value={timeInput} onChangeText={setTimeInput} />
      <AppTextInput
        label="Notes"
        placeholder="Add details or context"
        multiline
        value={notes}
        onChangeText={setNotes}
      />
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
      {error ? (
        <AppText variant="meta" style={{ color: theme.colors.danger }}>
          {error}
        </AppText>
      ) : null}
      <AppButton title={isSaving ? 'Saving…' : 'Save reminder'} disabled={!canSave || isSaving} onPress={handleSave} />

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
