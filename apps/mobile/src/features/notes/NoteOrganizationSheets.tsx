import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { listMobileProjects } from '@/api/captures';
import { deleteMobileNoteSection, getMobileWorkspaceNoteLinks, updateMobileNoteSection, type MobileNoteSection, type MobileNoteSummary, type MobileProjectNoteLink, linkMobileNoteToProject, unlinkMobileNoteFromProject } from '@/api/notes';
import { useLedgerTheme } from '@/theme';
import type { MobileNotePermissions } from './notePermissions';

export function NoteActionSheet({ visible, note, onClose, onOpen, onTogglePin, onMove, onDuplicate, onChild, onProjects, onDelete, onVersionHistory, pinned, permissions }: { visible: boolean; note: MobileNoteSummary | null; onClose: () => void; onOpen: () => void; onTogglePin: () => void; onMove: () => void; onDuplicate: () => void; onChild: () => void; onProjects: () => void; onDelete: () => void; onVersionHistory?: () => void; pinned: boolean; permissions?: MobileNotePermissions }) {
  if (!note) return null;
  const access = permissions ?? { canPin: true, canMove: true, canDuplicate: true, canCreateChild: true, canLinkProject: true, canDelete: true };
  const actions = [['Open', onOpen], ...(onVersionHistory ? [['Version history', onVersionHistory] as const] : []), ...(access.canPin ? [[pinned ? 'Unpin' : 'Pin', onTogglePin] as const] : []), ...(access.canMove ? [['Move', onMove] as const] : []), ...(access.canDuplicate ? [['Duplicate', onDuplicate] as const] : []), ...(access.canCreateChild ? [['Create child note', onChild] as const] : []), ...(access.canLinkProject ? [['Link to project', onProjects] as const] : []), ...(access.canDelete ? [['Delete', onDelete] as const] : [])] as ReadonlyArray<readonly [string, () => void]>;
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">{note.title || 'Untitled'}</AppText>} snapPoints={['66%', '84%']} initialSnapPointIndex={0}><View>{actions.map(([label, action]) => <Pressable key={label} onPress={() => { onClose(); action(); }} style={styles.actionMenuRow}><AppText variant="body" style={label === 'Delete' ? styles.destructive : undefined}>{label}</AppText><AppText variant="caption">›</AppText></Pressable>)}</View></AppBottomSheet>;
}

export function NoteMoveSheet({ visible, note, sections, notes = [], onClose, onMove, onParentMove }: { visible: boolean; note: MobileNoteSummary | null; sections: MobileNoteSection[]; notes?: MobileNoteSummary[]; onClose: () => void; onMove: (sectionId: string | null) => void; onParentMove?: (parentId: string | null) => void }) {
  const theme = useLedgerTheme();
  const roots = sections.filter((section) => !section.parent_id);
  const invalidParents = new Set<string>();
  if (note) {
    invalidParents.add(note.id);
    notes.forEach((candidate) => {
      let cursor = candidate;
      while (cursor.parent_id) {
        if (cursor.parent_id === note.id) { invalidParents.add(candidate.id); break; }
        const next = notes.find((item) => item.id === cursor.parent_id);
        if (!next) break;
        cursor = next;
      }
    });
  }
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">Move note</AppText>} snapPoints={['58%', '84%']} initialSnapPointIndex={0}><ScrollView><Pressable onPress={() => onMove(null)} style={[styles.actionRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body">Unsorted</AppText>{!note?.section_id ? <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText> : null}</Pressable>{roots.map((section) => <SectionChoice key={section.id} section={section} sections={sections} selected={note?.section_id === section.id} onMove={onMove} />)}{onParentMove ? <><AppText variant="label" style={styles.groupLabel}>PARENT NOTE</AppText><Pressable onPress={() => onParentMove(null)} style={[styles.actionRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body">Root level</AppText>{!note?.parent_id ? <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText> : null}</Pressable>{notes.filter((item) => !invalidParents.has(item.id)).slice(0, 30).map((item) => <Pressable key={item.id} onPress={() => onParentMove(item.id)} style={[styles.actionRow, styles.nestedRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body" numberOfLines={1}>{item.title || 'Untitled'}</AppText>{note?.parent_id === item.id ? <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText> : null}</Pressable>)}</> : null}</ScrollView></AppBottomSheet>;
}

function SectionChoice({ section, sections, selected, onMove }: { section: MobileNoteSection; sections: MobileNoteSection[]; selected: boolean; onMove: (sectionId: string) => void }) {
  const theme = useLedgerTheme();
  const children = sections.filter((item) => item.parent_id === section.id);
  return <View><Pressable onPress={() => onMove(section.id)} style={[styles.actionRow, { borderBottomColor: theme.colors.borderSubtle }]}><View style={styles.choiceCopy}><AppText variant="body">{section.name}</AppText>{children.length ? <AppText variant="caption">{children.length} subsections</AppText> : null}</View>{selected ? <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText> : null}</Pressable>{children.map((child) => <Pressable key={child.id} onPress={() => onMove(child.id)} style={[styles.actionRow, styles.nestedRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body">{child.name}</AppText>{selected && <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText>}</Pressable>)}</View>;
}

export function NoteProjectSheet({ visible, workspaceId, note, onClose, onChanged }: { visible: boolean; workspaceId: string; note: MobileNoteSummary | null; onClose: () => void; onChanged: () => void }) {
  const theme = useLedgerTheme();
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [links, setLinks] = useState<MobileProjectNoteLink[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (!visible || !note) return; void Promise.all([listMobileProjects(workspaceId), getMobileWorkspaceNoteLinks(workspaceId, note.id)]).then(([nextProjects, nextLinks]) => { setProjects(nextProjects as Array<{ id: string; name: string }>); setLinks(nextLinks); }).catch(() => undefined); }, [note, visible, workspaceId]);
  const filtered = useMemo(() => projects.filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);
  if (!note) return null;
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">Link to project</AppText>} snapPoints={['70%', '90%']} initialSnapPointIndex={0}><View style={[styles.search, { borderColor: theme.colors.borderSubtle }]}><TextInput value={query} onChangeText={setQuery} placeholder="Search projects…" placeholderTextColor={theme.colors.placeholder} style={{ color: theme.colors.textPrimary, flex: 1 }} /></View><ScrollView>{filtered.map((project) => { const linked = links.some((link) => link.project_id === project.id); return <Pressable key={project.id} disabled={busy === project.id} onPress={async () => { setBusy(project.id); try { if (linked) { await unlinkMobileNoteFromProject(workspaceId, project.id, note.id); setLinks((current) => current.filter((link) => link.project_id !== project.id)); } else { await linkMobileNoteToProject(workspaceId, project.id, note.id); setLinks((current) => [...current, { id: `${project.id}-${note.id}`, note_id: note.id, project_id: project.id, project_name: project.name }]); } onChanged(); } catch (error) { Alert.alert('Could not update project link', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(null); } }} style={[styles.actionRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body">{project.name}</AppText><AppText variant="caption" style={{ color: linked ? theme.colors.accent : theme.colors.textMuted }}>{linked ? 'Linked' : 'Link'}</AppText></Pressable>; })}</ScrollView></AppBottomSheet>;
}

export function SectionActionSheet({ visible, workspaceId, section, onClose, onOpen, onNewNote, onNewSubsection, onChanged }: { visible: boolean; workspaceId: string; section: MobileNoteSection | null; onClose: () => void; onOpen: () => void; onNewNote: () => void; onNewSubsection: () => void; onChanged: () => void }) {
  const theme = useLedgerTheme();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (section) { setName(section.name); setRenaming(false); } }, [section]);
  if (!section) return null;
  const rename = async () => { if (!name.trim()) return; setBusy(true); try { await updateMobileNoteSection(workspaceId, section.id, { name: name.trim() }); onChanged(); onClose(); } catch (error) { Alert.alert('Could not rename section', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } };
  const remove = () => Alert.alert('Delete this section?', 'Notes in this section will become Unsorted. Child sections will be detached; notes will not be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteMobileNoteSection(workspaceId, section.id); onChanged(); onClose(); } catch (error) { Alert.alert('Could not delete section', error instanceof Error ? error.message : 'Please try again.'); } } }]);
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">{section.name}</AppText>} snapPoints={['55%', '72%']} initialSnapPointIndex={0}>{renaming ? <><TextInput autoFocus value={name} onChangeText={setName} style={[styles.input, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.borderSubtle }]} /><Pressable disabled={busy} onPress={() => void rename()} style={styles.submit}><AppText variant="button" style={{ color: '#fff' }}>{busy ? 'Saving…' : 'Rename section'}</AppText></Pressable></> : <View>{[['Open', onOpen], ['New note here', onNewNote], ['New subsection', onNewSubsection], ['Rename', () => setRenaming(true)], ['Delete', remove]].map(([label, action]) => <Pressable key={String(label)} onPress={() => { if (label !== 'Rename') onClose(); (action as () => void)(); }} style={styles.actionRow}><AppText variant="body" style={label === 'Delete' ? styles.destructive : undefined}>{String(label)}</AppText><AppText variant="caption">›</AppText></Pressable>)}</View>}</AppBottomSheet>;
}

const styles = StyleSheet.create({ actionRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, actionMenuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, nestedRow: { paddingLeft: 22 }, choiceCopy: { flex: 1, gap: 2 }, groupLabel: { marginTop: 16, marginBottom: 4 }, destructive: { color: '#B42318' }, search: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center', marginBottom: 10 }, input: { minHeight: 46, borderBottomWidth: 1, fontSize: 16, marginVertical: 12 }, submit: { alignItems: 'center', backgroundColor: '#FF5F40', borderRadius: 10, paddingVertical: 13, marginTop: 14 } });
