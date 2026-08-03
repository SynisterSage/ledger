import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import type { MobileNoteSummary } from '@/api/notes';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

export type MobileNoteType = 'text' | 'meeting_note' | 'mind_map';
export type NoteRowVariant = 'default' | 'compact' | 'section' | 'meeting' | 'disabled';

export type MobileNoteRowData = {
  id: string;
  title: string;
  preview?: string | null;
  mode: MobileNoteType;
  metadata: string;
  pinned?: boolean;
  shared?: boolean;
  readOnly?: boolean;
};

export type NoteRowProps = {
  note: MobileNoteRowData;
  variant?: NoteRowVariant;
  showPreview?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  childCount?: number;
  onOpenChildren?: () => void;
};

type NoteRowContext = {
  projectTitle?: string | null;
  sectionName?: string | null;
  meetingContext?: string | null;
  showContext?: boolean;
  showUpdated?: boolean;
  pinned?: boolean;
  shared?: boolean;
  readOnly?: boolean;
};

function plainText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function relativeUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Recently';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function noteTypeLabel(mode: MobileNoteType) {
  if (mode === 'meeting_note') return 'Meeting note';
  if (mode === 'mind_map') return 'Mind map';
  return null;
}

/** Convert the desktop-backed summary row into the small view model used by NoteRow. */
export function normalizeMobileNoteRow(
  note: MobileNoteSummary,
  context: NoteRowContext = {},
): MobileNoteRowData {
  const mode = note.mode ?? 'text';
  const usefulContext = context.showContext === false
    ? null
    : context.projectTitle?.trim() || context.sectionName?.trim() || context.meetingContext?.trim() || null;
  const typeLabel = noteTypeLabel(mode);
  const updatedLabel = context.showUpdated === false ? null : `Updated ${relativeUpdatedAt(note.updated_at)}`;
  const metadata = [usefulContext, typeLabel, updatedLabel].filter(Boolean).slice(0, 3).join(' · ');

  return {
    id: note.id,
    title: note.title?.trim() || 'Untitled note',
    preview: plainText(note.preview),
    mode,
    metadata,
    pinned: Boolean(context.pinned),
    shared: Boolean(context.shared),
    readOnly: Boolean(context.readOnly),
  };
}

export const NoteRow = memo(function NoteRow({ note, variant = 'default', showPreview, onPress, onLongPress, childCount = 0, onOpenChildren }: NoteRowProps) {
  const theme = useLedgerTheme();
  const isCompact = variant === 'compact';
  const displayPreview = showPreview ?? !isCompact;
  const icon = note.mode === 'meeting_note'
    ? { ios: 'mic' as const, android: 'mic' as const, web: 'mic' as const }
    : note.mode === 'mind_map'
      ? { ios: 'arrow.triangle.branch' as const, android: 'account_tree' as const, web: 'account_tree' as const }
      : { ios: 'note.text' as const, android: 'note' as const, web: 'note' as const };
  const stateLabel = [note.pinned ? 'Pinned' : null, note.shared ? 'Shared' : null, note.readOnly ? 'Read only' : null].filter(Boolean).join(', ');
  const accessibilityLabel = [note.title, note.metadata, displayPreview ? note.preview : null, stateLabel].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onLongPress ? 'Opens note. Long press for actions.' : 'Opens note.'}
      accessibilityState={{ disabled: variant === 'disabled' }}
      disabled={variant === 'disabled'}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        variant === 'meeting' && styles.meetingRow,
        { backgroundColor: pressed ? theme.colors.surfaceHover : 'transparent', opacity: variant === 'disabled' ? 0.42 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: theme.colors.surfaceMuted }]} accessible={false}>
        <SymbolView name={icon} size={20} tintColor={theme.colors.textMuted} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleLine}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>{note.title}</AppText>
          {note.pinned ? <SymbolView name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }} size={13} tintColor={theme.colors.textMuted} accessible={false} /> : null}
          {note.shared ? <SymbolView name={{ ios: 'person.2.fill', android: 'people', web: 'people' }} size={14} tintColor={theme.colors.textMuted} accessible={false} /> : null}
          {childCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${childCount} child notes`} onPress={(event) => { event.stopPropagation(); onOpenChildren?.(); }} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{childCount} ›</AppText></Pressable> : null}
        </View>
        {note.metadata ? <AppText variant="caption" numberOfLines={1}>{note.metadata}</AppText> : null}
        {displayPreview && note.preview ? <AppText variant="caption" numberOfLines={1} style={{ color: theme.colors.textMuted }}>{note.preview}</AppText> : null}
      </View>
    </Pressable>
  );
});

export function noteRowDataFromSummary(note: MobileNoteSummary, context?: NoteRowContext) {
  return normalizeMobileNoteRow(note, context);
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8 },
  meetingRow: { minHeight: 68 },
  iconWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  content: { minWidth: 0, flex: 1, gap: 2 },
  titleLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1 },
});
