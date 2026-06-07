import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import {
  updateMobileEvent,
  updateMobileNote,
  updateMobileReminder,
  updateMobileTask,
} from '@/api/captures';
import { getMobileNote } from '@/api/notes';
import { useLedgerTheme } from '@/theme';
import type { MobileTodayInteractionItem } from '@/types/ledger';

type TodayItemEditSheetProps = {
  visible: boolean;
  item: MobileTodayInteractionItem | null;
  onClose: () => void;
  onSaved: () => void;
};

type LoadedEditData = {
  title: string;
  notes: string;
};

function getEditTitle(item: MobileTodayInteractionItem) {
  if ('source' in item) {
    return 'Capture';
  }

  if (item.type === 'focus') {
    return 'Focus';
  }

  if (item.type === 'project_action') {
    return 'Project action';
  }

  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getItemContext(item: MobileTodayInteractionItem) {
  const parts = [item.workspaceName];

  if ('dateLabel' in item && item.dateLabel) {
    parts.push(item.dateLabel);
  } else if ('dueLabel' in item && item.dueLabel) {
    parts.push(item.dueLabel);
  } else if ('createdAt' in item && item.createdAt) {
    parts.push(new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(item.createdAt)));
  }

  return parts.filter(Boolean).join(' · ');
}

export function TodayItemEditSheet({ visible, item, onClose, onSaved }: TodayItemEditSheetProps) {
  const theme = useLedgerTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoadedEditData>({ title: '', notes: '' });
  const editableItem = useMemo(() => (item && !('source' in item) ? item : null), [item]);
  const sheetTitle = useMemo(() => (editableItem ? `Edit ${getEditTitle(editableItem).toLowerCase()}` : 'Edit'), [editableItem]);
  const context = useMemo(() => (editableItem ? getItemContext(editableItem) : ''), [editableItem]);

  useEffect(() => {
    if (!visible || !editableItem) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setDraft({
      title: editableItem.title ?? '',
      notes: 'body' in editableItem && editableItem.body ? editableItem.body : '',
    });

    const load = async () => {
      try {
        if (editableItem.type === 'note') {
          const note = await getMobileNote(editableItem.sourceId);
          if (cancelled) return;
          setDraft({
            title: note.title ?? editableItem.title ?? '',
            notes: note.content ?? '',
          });
          return;
        }

        if (editableItem.type === 'event') {
          // Minimal edit tray: keep the title/body available and preserve the current schedule via backend defaults.
          return;
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load item.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [editableItem, visible]);

  if (!editableItem) {
    return null;
  }

  const save = async () => {
    if (isSaving) return;

    const title = draft.title.trim();
    if (!title) {
      setError('Title is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (editableItem.type === 'note') {
        await updateMobileNote(editableItem.workspaceId, editableItem.sourceId, {
          title,
          content: draft.notes.trim() || null,
        });
      } else if (editableItem.type === 'event') {
        await updateMobileEvent(editableItem.workspaceId, editableItem.sourceId, {
          title,
          notes: draft.notes.trim() || null,
        });
      } else if (editableItem.type === 'reminder') {
        await updateMobileReminder(editableItem.workspaceId, editableItem.sourceId, {
          title,
          body: draft.notes.trim() || null,
        });
      } else {
        await updateMobileTask(editableItem.workspaceId, editableItem.sourceId, {
          title,
          notes: draft.notes.trim() || null,
        });
      }

      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const notesLabel = editableItem.type === 'note' ? 'Body' : 'Notes';
  const notesPlaceholder = editableItem.type === 'note' ? 'Add details or context' : 'Add notes';

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={sheetTitle}
      snapPoints={['72%', '88%']}
      initialSnapPointIndex={1}>
      <View style={{ gap: theme.spacing.lg }}>
        {context ? (
          <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
            {context}
          </AppText>
        ) : null}

        {isLoading ? (
          <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
            Loading…
          </AppText>
        ) : null}

        <AppTextInput
          label="Title"
          labelVariant="body"
          placeholder="Add title"
          value={draft.title}
          onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))}
        />

        <AppTextInput
          label={notesLabel}
          labelVariant="body"
          placeholder={notesPlaceholder}
          multiline
          value={draft.notes}
          onChangeText={(value) => setDraft((current) => ({ ...current, notes: value }))}
        />

        {error ? (
          <AppText variant="meta" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}

        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.xs }}>
          <AppButton
            title={isSaving ? 'Saving…' : 'Save changes'}
            size="lg"
            disabled={isSaving || isLoading}
            onPress={save}
          />
          <AppButton title="Cancel" variant="secondary" size="lg" onPress={onClose} />
        </View>
      </View>
    </AppBottomSheet>
  );
}
