import { useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';

import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { createMobileEvent } from '@/api/captures';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useLedgerTheme } from '@/theme';
import { buildLocalIsoDateTime } from '@/utils/captureDates';
import { formatCaptureDateLabel, formatCaptureTimeLabel, parseMobileDateInput, parseMobileDateTimeInput } from '@/features/capture/dateUtils';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  useWorkspaceState,
} from '@/store/workspaceStore';

type EventFormProps = {
  onSave?: () => void;
  initialTitle?: string;
  initialDateInput?: string;
  initialStartTimeInput?: string;
  initialEndTimeInput?: string;
  initialLocation?: string;
  initialNotes?: string;
  autoSubmit?: boolean;
};

export function EventForm({
  onSave,
  initialTitle,
  initialDateInput,
  initialStartTimeInput,
  initialEndTimeInput,
  initialLocation,
  initialNotes,
  autoSubmit = false,
}: EventFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceId, workspaceState.options),
    [workspaceId, workspaceState.options],
  );
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [dateInput, setDateInput] = useState(initialDateInput ?? 'tomorrow');
  const [startTimeInput, setStartTimeInput] = useState(initialStartTimeInput ?? '11:00 AM');
  const [endTimeInput, setEndTimeInput] = useState(initialEndTimeInput ?? '12:00 PM');
  const [location, setLocation] = useState(initialLocation ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [startTimePickerOpen, setStartTimePickerOpen] = useState(false);
  const [endTimePickerOpen, setEndTimePickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedStartTime = useMemo(() => parseMobileDateTimeInput(startTimeInput, parsedDate), [parsedDate, startTimeInput]);
  const parsedEndTime = useMemo(() => parseMobileDateTimeInput(endTimeInput, parsedDate), [parsedDate, endTimeInput]);

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

    const startAt = buildLocalIsoDateTime({
      dateInput,
      timeInput: startTimeInput,
      fallbackTime: '11:00 AM',
    });
    if (!startAt) {
      setError('Enter a valid start date and time.');
      return;
    }

    const endAt =
      dateInput.trim() && endTimeInput.trim()
        ? buildLocalIsoDateTime({
            dateInput,
            timeInput: endTimeInput,
            fallbackTime: '12:00 PM',
          })
        : null;

    setIsSaving(true);
    setError(null);

    try {
      await createMobileEvent(workspaceId, {
        title: title.trim(),
        start_at: startAt,
        end_at: endAt,
        location: location.trim() || null,
        notes: notes.trim() || null,
        project_id: projectId,
      });
      onSave?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save event.');
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
          title={isSaving ? 'Saving…' : 'Save event'}
          size="lg"
          disabled={!canSave || isSaving}
          onPress={handleSave}
        />
      }>
      <Section childrenGap={theme.spacing.md}>
        <AppTextInput label="Title" placeholder="Add title" value={title} onChangeText={setTitle} />
        <Row
          title="Date"
          subtitle={formatCaptureDateLabel(dateInput)}
          onPress={() => setDatePickerOpen(true)}
          chevron
        />
        <Row
          title="Start time"
          subtitle={formatCaptureTimeLabel(startTimeInput)}
          onPress={() => setStartTimePickerOpen(true)}
          chevron
        />
        <Row
          title="End time"
          subtitle={formatCaptureTimeLabel(endTimeInput)}
          onPress={() => setEndTimePickerOpen(true)}
          chevron
        />
        <AppTextInput label="Location" placeholder="Optional" value={location} onChangeText={setLocation} />
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
        title="Select date"
        mode="date"
        value={parsedDate}
        onSelect={(next) => setDateInput(next.toISOString().slice(0, 10))}
        onClose={() => setDatePickerOpen(false)}
      />
      <CaptureDateTimePickerSheet
        visible={startTimePickerOpen}
        title="Select start time"
        mode="time"
        value={parsedStartTime}
        onSelect={(next) => setStartTimeInput(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(next))}
        onClose={() => setStartTimePickerOpen(false)}
      />
      <CaptureDateTimePickerSheet
        visible={endTimePickerOpen}
        title="Select end time"
        mode="time"
        value={parsedEndTime}
        onSelect={(next) => setEndTimeInput(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(next))}
        onClose={() => setEndTimePickerOpen(false)}
      />
    </CaptureFormShell>
  );
}
