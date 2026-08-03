import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { createMobileNote } from '@/api/captures';
import { createMobileNoteFromTemplate, getMobileNoteTemplates, type MobileNoteTemplate } from '@/api/notes';
import { createMeetingNoteFromCalendar } from '@/api/calendar';
import { createMobileNoteSection } from '@/api/notes';
import { useLedgerTheme } from '@/theme';

type CreationKind = 'text' | 'meeting_note' | 'mind_map' | 'template' | 'section';

type Props = {
  visible: boolean;
  workspaceId: string;
  sectionId?: string | null;
  parentId?: string | null;
  meetings?: Array<{ id: string; title: string; sourceId?: string | null; startAt?: string | null; readOnly?: boolean; projectId?: string | null }>;
  sections?: Array<{ id: string; name: string; parent_id?: string | null }>;
  onClose: () => void;
  onCreated: (noteId: string) => void;
  onSectionCreated?: () => void;
};

export function NoteCreationSheet({ visible, workspaceId, sectionId = null, parentId = null, meetings = [], sections = [], onClose, onCreated, onSectionCreated }: Props) {
  const theme = useLedgerTheme();
  const [kind, setKind] = useState<CreationKind | null>(null);
  const [title, setTitle] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MobileNoteTemplate[]>([]);
  const [templateQuery, setTemplateQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    setKind(null);
    setTitle('');
    setSectionName('');
    setError(null);
  }, [visible]);

  useEffect(() => {
    if (kind !== 'template') return;
    void getMobileNoteTemplates(workspaceId).then(setTemplates).catch((err) => setError(err instanceof Error ? err.message : 'Could not load templates.'));
  }, [kind, workspaceId]);

  const filteredTemplates = useMemo(() => templates.filter((template) => `${template.name} ${template.description ?? ''} ${template.category ?? ''}`.toLowerCase().includes(templateQuery.trim().toLowerCase())), [templateQuery, templates]);

  const templateContent = <><View style={[styles.search, { backgroundColor: theme.colors.surfaceMuted }]}><TextInput value={templateQuery} onChangeText={setTemplateQuery} placeholder="Search templates…" placeholderTextColor={theme.colors.placeholder} style={[styles.searchInput, { color: theme.colors.textPrimary }]} /></View><View style={[styles.templateList, { backgroundColor: theme.colors.surfaceMuted }]}>{filteredTemplates.map((template) => <Pressable key={template.id} onPress={async () => { setBusy(true); try { const created = await createMobileNoteFromTemplate(workspaceId, template.id, { section_id: sectionId }); onClose(); onCreated(created.id); } catch (err) { setError(err instanceof Error ? err.message : 'Could not use template.'); } finally { setBusy(false); } }} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.65 : 1 }]}><View style={styles.rowCopy}><AppText variant="bodyStrong" numberOfLines={1}>{template.name}</AppText><AppText variant="caption" numberOfLines={1}>{template.category ?? (template.is_system ? 'System' : 'Personal')}{template.pinned ? ' · Pinned' : ''}{template.description ? ` · ${template.description}` : ''}</AppText></View><AppText variant="caption" style={styles.rowChevron}>›</AppText></Pressable>)}</View></>;

  const create = async (nextKind: Exclude<CreationKind, 'template' | 'section'>, meeting?: { id: string; title: string; sourceId?: string | null; startAt?: string | null; readOnly?: boolean; projectId?: string | null }) => {
    setBusy(true);
    setError(null);
    try {
      const html = nextKind === 'meeting_note' ? '<h2>Agenda</h2><p></p><h2>Notes</h2><p></p><h2>Decisions</h2><p></p><h2>Action Items</h2><ul><li></li></ul>' : '<p></p>';
      const rootId = `root-${Date.now()}`;
      const created = meeting?.sourceId
        ? await createMeetingNoteFromCalendar(workspaceId, { eventId: meeting.sourceId, provider: meeting.readOnly ? 'google' : 'ledger', eventKey: meeting.sourceId, projectId: meeting.projectId ?? null })
        : await createMobileNote(workspaceId, { title: title.trim(), content_html: html, source: nextKind === 'meeting_note' ? 'meeting' : 'mobile', section_id: sectionId, parent_id: parentId, mode: nextKind, mind_map_structure: nextKind === 'mind_map' ? { rootId, nodes: { [rootId]: { id: rootId, label: title.trim() || 'Central Idea', children: [], x: 80, y: 80 } } } : null });
      const id = typeof created === 'object' && created && 'id' in created && typeof created.id === 'string' ? created.id : typeof created === 'object' && created && 'note' in created && created.note && typeof created.note === 'object' && 'id' in created.note && typeof created.note.id === 'string' ? created.note.id : null;
      if (!id) throw new Error('The new note did not return an id.');
      onClose();
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create note.');
    } finally {
      setBusy(false);
    }
  };

  const content = kind === 'template' ? templateContent : kind === 'section' ? <><View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="sectionTitle">New section</AppText><TextInput value={sectionName} onChangeText={setSectionName} placeholder="Section name" placeholderTextColor={theme.colors.placeholder} style={[styles.input, styles.cardInput, { color: theme.colors.textPrimary }]} /></View><Pressable disabled={!sectionName.trim() || busy} onPress={async () => { setBusy(true); try { await createMobileNoteSection(workspaceId, { name: sectionName.trim(), parent_id: sectionId }); onClose(); onSectionCreated?.(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create section.'); } finally { setBusy(false); } }} style={styles.submit}><AppText variant="button" style={{ color: '#fff' }}>{busy ? 'Creating…' : 'Create section'}</AppText></Pressable></> : kind ? <><View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="sectionTitle">{kind === 'meeting_note' ? 'Meeting note' : kind === 'mind_map' ? 'Mind map' : 'New note'}</AppText><TextInput value={title} onChangeText={setTitle} placeholder={kind === 'mind_map' ? 'Central idea' : 'Title'} placeholderTextColor={theme.colors.placeholder} style={[styles.input, styles.cardInput, { color: theme.colors.textPrimary }]} /></View>{kind === 'meeting_note' && meetings.length ? <View style={[styles.meetingList, { backgroundColor: theme.colors.surfaceMuted }]}>{meetings.slice(0, 5).map((meeting) => <Pressable key={meeting.id} onPress={() => void create('meeting_note', meeting)} style={[styles.row, { opacity: 1 }]}><View style={styles.rowCopy}><AppText variant="bodyStrong">{meeting.title}</AppText><AppText variant="caption">Create from upcoming event</AppText></View></Pressable>)}</View> : null}<Pressable disabled={busy} onPress={() => void create(kind)} style={styles.submit}><AppText variant="button" style={{ color: '#fff' }}>{busy ? 'Creating…' : kind === 'meeting_note' ? 'Create meeting note' : kind === 'mind_map' ? 'Create mind map' : 'Create note'}</AppText></Pressable></> : <View style={styles.options}>{[['text', 'New note'], ['meeting_note', 'Meeting note'], ['mind_map', 'Mind map'], ['template', 'From template'], ['section', 'New section']].map(([value, label]) => <Pressable key={value} onPress={() => setKind(value as CreationKind)} style={({ pressed }) => [styles.option, { opacity: pressed ? 0.65 : 1 }]}><AppText variant="body">{label}</AppText><AppText variant="caption">›</AppText></Pressable>)}</View>;

  return <AppBottomSheet visible={visible} onClose={onClose} title={kind ? <View style={styles.templateHeader}><Pressable onPress={() => setKind(null)}><AppText variant="caption">‹ New note</AppText></Pressable>{kind === 'template' ? <AppText variant="sectionTitle">From template</AppText> : null}</View> : <AppText variant="sectionTitle">New note</AppText>} snapPoints={kind ? ['78%', '92%'] : ['56%', '78%']} initialSnapPointIndex={0}>{error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}{content}</AppBottomSheet>;
}

const styles = StyleSheet.create({ options: { gap: 0 }, option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, templateHeader: { gap: 2 }, templateList: { gap: 2, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6 }, row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }, rowCopy: { flex: 1, minWidth: 0, gap: 2 }, rowChevron: { marginLeft: 10 }, search: { minHeight: 42, borderRadius: 16, paddingHorizontal: 16, justifyContent: 'center', marginTop: 4, marginBottom: 10 }, searchInput: { flex: 1, height: 40, paddingVertical: 0, fontSize: 16, lineHeight: 20, textAlignVertical: 'center' }, inputCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, gap: 10 }, input: { minHeight: 46, borderBottomWidth: 1, fontSize: 16, marginVertical: 12 }, cardInput: { borderBottomWidth: 0, marginVertical: 0 }, submit: { alignItems: 'center', backgroundColor: '#FF5F40', borderRadius: 14, paddingVertical: 13, marginTop: 14 }, meetingList: { marginTop: 8, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6 } });
