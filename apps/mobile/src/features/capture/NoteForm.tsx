import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptureFormShell } from '@/components/CaptureFormShell';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { SymbolView } from 'expo-symbols';
import { createMobileNote } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import {
  getWorkspaceLabel,
  resolveCaptureWorkspaceId,
  setDefaultCaptureWorkspace,
  useWorkspaceState,
} from '@/store/workspaceStore';

type NoteFormProps = {
  onSave?: () => void;
  initialTitle?: string;
  initialBody?: string;
  autoSubmit?: boolean;
};

export function NoteForm({ onSave, initialTitle, initialBody, autoSubmit = false }: NoteFormProps) {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const workspaceId = useMemo(() => resolveCaptureWorkspaceId(workspaceState), [workspaceState]);
  const [captureWorkspaceId, setCaptureWorkspaceId] = useState(workspaceId);
  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(captureWorkspaceId, workspaceState.options),
    [captureWorkspaceId, workspaceState.options],
  );
  const [title, setTitle] = useState(initialTitle ?? '');
  const [body, setBody] = useState(initialBody ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const autoSubmittedRef = useRef(false);
  const canSave = Boolean(title.trim()) && captureWorkspaceId !== 'all';

  useEffect(() => {
    setCaptureWorkspaceId(workspaceId);
  }, [workspaceId]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createMobileNote(captureWorkspaceId, {
        title: title.trim(),
        content: body.trim() || null,
        source: 'mobile',
      });
      onSave?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save note.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!autoSubmit || autoSubmittedRef.current || isSaving) {
      return;
    }

    if (!title.trim() || captureWorkspaceId === 'all') {
      return;
    }

    autoSubmittedRef.current = true;
    void handleSave();
  }, [autoSubmit, captureWorkspaceId, handleSave, isSaving, title]);

  return (
    <CaptureFormShell
      footer={
        <AppButton
          title={isSaving ? 'Saving…' : 'Save note'}
          size="lg"
          disabled={!canSave || isSaving}
          onPress={handleSave}
        />
      }>
      <Section childrenGap={theme.spacing.sm}>
        <AppTextInput label="Title" labelVariant="body" placeholder="Add title" value={title} onChangeText={setTitle} />
        <AppTextInput
          label="Body"
          labelVariant="body"
          placeholder="Write a plain text note"
          multiline
          value={body}
          onChangeText={setBody}
        />
        <Row
          title="Workspace"
          subtitle={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel}
          onPress={() => setWorkspacePickerOpen(true)}
          right={<SymbolView name="chevron.down" size={14} weight="regular" tintColor={theme.colors.textSecondary} />}
          titleVariant="body"
        />
        {error ? (
          <AppText variant="meta" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}
      </Section>
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
    </CaptureFormShell>
  );
}
