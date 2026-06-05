import { useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { createMobileEvent } from '@/api/captures';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { useLedgerTheme } from '@/theme';
import { buildLocalIsoDateTime } from '@/utils/captureDates';
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
  const [title, setTitle] = useState(initialTitle ?? 'Remote internship');
  const [dateInput, setDateInput] = useState(initialDateInput ?? 'tomorrow');
  const [startTimeInput, setStartTimeInput] = useState(initialStartTimeInput ?? '11:00 AM');
  const [endTimeInput, setEndTimeInput] = useState(initialEndTimeInput ?? '12:00 PM');
  const [location, setLocation] = useState(initialLocation ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);

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
    <Section>
      <AppTextInput label="Title" placeholder="Remote internship" value={title} onChangeText={setTitle} />
      <AppTextInput label="Date" placeholder="Tomorrow" value={dateInput} onChangeText={setDateInput} />
      <AppTextInput label="Start time" placeholder="11:00 AM" value={startTimeInput} onChangeText={setStartTimeInput} />
      <AppTextInput label="End time" placeholder="12:00 PM" value={endTimeInput} onChangeText={setEndTimeInput} />
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
      <AppButton title={isSaving ? 'Saving…' : 'Save event'} disabled={!canSave || isSaving} onPress={handleSave} />

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
