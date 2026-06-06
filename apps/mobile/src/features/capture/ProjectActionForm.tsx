import { useEffect, useMemo, useState } from 'react';
import { Switch } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { createMobileProjectAction } from '@/api/captures';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useLedgerTheme } from '@/theme';
import { parseDateInputToIsoDate, parseTimeInputTo24Hour } from '@/utils/captureDates';
import { formatCaptureDateLabel, formatCaptureTimeLabel, parseMobileDateInput, parseMobileDateTimeInput } from '@/features/capture/dateUtils';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  setDefaultCaptureWorkspace,
  useWorkspaceState,
} from '@/store/workspaceStore';

type ProjectActionFormProps = {
  onSave?: () => void;
};

export function ProjectActionForm({ onSave }: ProjectActionFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const [captureWorkspaceId, setCaptureWorkspaceId] = useState(workspaceId);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(captureWorkspaceId, workspaceState.options),
    [captureWorkspaceId, workspaceState.options],
  );
  const { projects, isLoading: projectsLoading } = useCaptureProjects(captureWorkspaceId);
  const [title, setTitle] = useState('');
  const [dateInput, setDateInput] = useState('tomorrow');
  const [timeInput, setTimeInput] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [showInToday, setShowInToday] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedTime = useMemo(() => parseMobileDateTimeInput(timeInput, parsedDate), [parsedDate, timeInput]);

  useEffect(() => {
    setCaptureWorkspaceId(workspaceId);
  }, [workspaceId]);

  const selectedProjectLabel = useMemo(() => {
    if (!projectId) return 'No project';
    return projects.find((project) => project.id === projectId)?.name ?? 'No project';
  }, [projectId, projects]);
  const canSave = Boolean(title.trim()) && captureWorkspaceId !== 'all';

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Action is required.');
      return;
    }

    const dueDate = parseDateInputToIsoDate(dateInput);
    const dueTime = dueDate ? parseTimeInputTo24Hour(timeInput) : null;

    setIsSaving(true);
    setError(null);

    try {
      await createMobileProjectAction(captureWorkspaceId, {
        title: title.trim(),
        due_date: dueDate,
        due_time: dueTime,
        notes: notes.trim() || null,
        project_id: projectId,
        show_in_today: showInToday,
      });
      onSave?.();
    } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save action.');
      } finally {
        setIsSaving(false);
      }
  };

  return (
    <CaptureFormShell
      footer={
        <AppButton
          title={isSaving ? 'Saving…' : 'Save action'}
          size="lg"
          disabled={!canSave || isSaving}
          onPress={handleSave}
        />
      }>
      <Section childrenGap={theme.spacing.sm}>
        <AppTextInput label="Action" labelVariant="body" placeholder="Add title" value={title} onChangeText={setTitle} />
        <Row
          title="Due date"
          subtitle={formatCaptureDateLabel(dateInput)}
          onPress={() => setDatePickerOpen(true)}
          chevron
          titleVariant="body"
        />
        <Row
          title="Due time"
          subtitle={formatCaptureTimeLabel(timeInput)}
          onPress={() => setTimePickerOpen(true)}
          chevron
          titleVariant="body"
        />
        <AppTextInput
          label="Notes"
          labelVariant="body"
          placeholder="Add details or context"
          multiline
          value={notes}
          onChangeText={setNotes}
        />
        <Row
          title="Workspace"
          subtitle={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel}
          onPress={() => setWorkspacePickerOpen(true)}
          right={<SymbolView name="chevron.down" size={14} weight="regular" tintColor={theme.colors.textSecondary} />}
          titleVariant="body"
        />
        <Row
          title="Project"
          subtitle={selectedProjectLabel}
          onPress={() => setProjectPickerOpen(true)}
          right={<SymbolView name="chevron.down" size={14} weight="regular" tintColor={theme.colors.textSecondary} />}
          titleVariant="body"
        />
        <Row
          title="Show in Today"
          subtitle={showInToday ? 'On' : 'Off'}
          titleVariant="body"
          right={
            <Switch
              value={showInToday}
              onValueChange={setShowInToday}
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
      </Section>
      <ProjectPickerSheet
        visible={projectPickerOpen}
        projects={projects}
        selectedProjectId={projectId}
        onSelect={setProjectId}
        onClose={() => setProjectPickerOpen(false)}
        loading={projectsLoading}
      />
      <WorkspaceSelectorSheet
        visible={workspacePickerOpen}
        selectedWorkspaceId={captureWorkspaceId}
        workspaces={workspaceState.options}
        onSelect={(nextWorkspaceId) => {
          setCaptureWorkspaceId(nextWorkspaceId);
          setDefaultCaptureWorkspace(nextWorkspaceId);
        }}
        onClose={() => setWorkspacePickerOpen(false)}
      />
      <CaptureDateTimePickerSheet
        visible={datePickerOpen}
        title="Select due date"
        mode="date"
        value={parsedDate}
        onSelect={(next) => setDateInput(next.toISOString().slice(0, 10))}
        onClose={() => setDatePickerOpen(false)}
      />
      <CaptureDateTimePickerSheet
        visible={timePickerOpen}
        title="Select due time"
        mode="time"
        value={parsedTime}
        onSelect={(next) => setTimeInput(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(next))}
        onClose={() => setTimePickerOpen(false)}
      />
    </CaptureFormShell>
  );
}
