import { useEffect, useMemo, useRef, useState } from 'react';
import { Switch } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { createMobileTask } from '@/api/captures';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useLedgerTheme } from '@/theme';
import { parseDateInputToIsoDate, parseTimeInputTo24Hour } from '@/utils/captureDates';
import { formatCaptureDateLabel, formatCaptureTimeLabel, parseMobileDateInput, parseMobileDateTimeInput } from '@/features/capture/dateUtils';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  useWorkspaceState,
} from '@/store/workspaceStore';

type TaskFormProps = {
  onSave?: () => void;
  initialTitle?: string;
  initialDateInput?: string;
  initialTimeInput?: string;
  initialNotes?: string;
  initialShowInToday?: boolean;
  initialIsFocus?: boolean;
  autoSubmit?: boolean;
};

export function TaskForm({
  onSave,
  initialTitle,
  initialDateInput,
  initialTimeInput,
  initialNotes,
  initialShowInToday,
  initialIsFocus,
  autoSubmit = false,
}: TaskFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceId, workspaceState.options),
    [workspaceId, workspaceState.options],
  );
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [dateInput, setDateInput] = useState(initialDateInput ?? '');
  const [timeInput, setTimeInput] = useState(initialTimeInput ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [showInToday, setShowInToday] = useState(initialShowInToday ?? true);
  const [isFocus, setIsFocus] = useState(initialIsFocus ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedTime = useMemo(() => parseMobileDateTimeInput(timeInput, parsedDate), [parsedDate, timeInput]);

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

  useEffect(() => {
    if (!autoSubmit || autoSubmittedRef.current || isSaving) {
      return;
    }

    if (!title.trim() || workspaceId === 'all') {
      return;
    }

    autoSubmittedRef.current = true;
    void handleSave();
  }, [autoSubmit, handleSave, isSaving, title, workspaceId]);

  return (
    <CaptureFormShell
      footer={
        <AppButton
          title={isSaving ? 'Saving…' : 'Save task'}
          size="lg"
          disabled={!canSave || isSaving}
          onPress={handleSave}
        />
      }>
      <Section childrenGap={theme.spacing.md}>
        <AppTextInput label="Title" placeholder="Add title" value={title} onChangeText={setTitle} />
        <Row
          title="Due date"
          subtitle={formatCaptureDateLabel(dateInput)}
          onPress={() => setDatePickerOpen(true)}
          chevron
        />
        <Row
          title="Due time"
          subtitle={formatCaptureTimeLabel(timeInput)}
          onPress={() => setTimePickerOpen(true)}
          chevron
        />
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
      </Section>
      <ProjectPickerSheet
        visible={projectPickerOpen}
        projects={projects}
        selectedProjectId={projectId}
        onSelect={setProjectId}
        onClose={() => setProjectPickerOpen(false)}
        loading={projectsLoading}
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
