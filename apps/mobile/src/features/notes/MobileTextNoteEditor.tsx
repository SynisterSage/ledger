import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { createMobileChildNote, deleteMobileNote, duplicateMobileNote, getMobileMeetingMetadata, getMobileNote, getMobileNoteSections, getMobilePins, moveMobileNote, pinMobileNote, unpinMobileObject, type MobileMeetingMetadata, type MobileMindMapStructure, type MobileNoteSection, type MobileNoteSummary } from '@/api/notes';
import { createMobileNote, updateMobileNote } from '@/api/captures';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { resolveCaptureWorkspaceId, useWorkspaceState } from '@/store/workspaceStore';
import { NoteActionSheet, NoteMoveSheet, NoteProjectSheet } from './NoteOrganizationSheets';
import { NoteVersionSheet } from './NoteVersionSheet';
import { MobileTranscriptView } from './MobileTranscriptView';
import { MobileMindMapView } from './MobileMindMapView';
import { NoteSelectionActionsSheet } from './NoteSelectionActionsSheet';
import { getMobileNoteDraft, saveMobileNoteDraft, clearMobileNoteDraft } from './mobileNoteDrafts';
import { getMobileNotePermissions } from './notePermissions';
import { MobileLexicalEditor, type MobileLexicalEditorHandle } from '../dev/MobileLexicalEditor';
import type { EditorNativeEvent } from '@/bridge/messages';

type Props = { noteId?: string; workspaceId?: string };
type SaveState = 'saved' | 'saving' | 'offline' | 'error' | 'remote';

const EMPTY_HTML = '<p></p>';
const EMPTY_MAP: MobileMindMapStructure = { rootId: 'mobile-root', nodes: { 'mobile-root': { id: 'mobile-root', label: 'Central Idea', children: [], x: 80, y: 80 } } };

function htmlToPlainText(value: string) {
  return String(value ?? '')
    .replace(/<br\s*\/?>(?=\s*<)/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/li>\s*<li[^>]*>/gi, '\n')
    .replace(/<\/(h[1-6]|p|li|blockquote|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plainTextToHtml(value: string, block: 'paragraph' | 'heading' | 'bullet' | 'check') {
  const lines = value.split('\n');
  if (block === 'bullet') return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
  if (block === 'check') return `<ul data-type="check-list">${lines.map((line) => `<li data-checked="false">${escapeHtml(line)}</li>`).join('')}</ul>`;
  const tag = block === 'heading' ? 'h2' : 'p';
  return lines.map((line) => `<${tag}>${escapeHtml(line) || '<br>'}</${tag}>`).join('');
}

function serializeBody(body: string, initialHtml: string, initialPlain: string, block: 'paragraph' | 'heading' | 'bullet' | 'check', inlineFormat: 'none' | 'bold' | 'italic' | 'underline') {
  if (body === initialPlain) return initialHtml || EMPTY_HTML;
  const formatted = plainTextToHtml(body, block);
  const inlineTag = inlineFormat === 'none' ? null : inlineFormat === 'bold' ? 'strong' : inlineFormat === 'italic' ? 'em' : 'u';
  const editableHtml = inlineTag ? `<${inlineTag}>${formatted}</${inlineTag}>` : formatted;
  // Images, dividers, tables, callouts, and attachments remain canonical HTML. They
  // are carried forward as read-only blocks when the native text surface changes.
  const preservedBlocks = (initialHtml.match(/<(?:img|hr|figure|table|aside|div)[^>]*>[\s\S]*?<\/(?:figure|table|aside|div)>|<(?:img|hr)[^>]*\/?>(?![\s\S]*<\/)/gi) ?? []).join('');
  return `${editableHtml}${preservedBlocks}` || EMPTY_HTML;
}

export function MobileTextNoteEditor({ noteId, workspaceId: requestedWorkspaceId }: Props) {
  const theme = useLedgerTheme();
  const router = useRouter();
  const workspaceState = useWorkspaceState();
  const workspaceId = requestedWorkspaceId ?? resolveCaptureWorkspaceId(workspaceState);
  const permissions = getMobileNotePermissions(workspaceState.options.find((option) => option.id === workspaceId));
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [initialHtml, setInitialHtml] = useState(EMPTY_HTML);
  const [initialPlain, setInitialPlain] = useState('');
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'mind_map' | 'meeting_note'>('text');
  const [meetingMetadata, setMeetingMetadata] = useState<MobileMeetingMetadata | null>(null);
  const [meetingView, setMeetingView] = useState<'write' | 'transcript'>('write');
  const [mapView, setMapView] = useState<'map' | 'outline'>('map');
  const [mapStructure, setMapStructure] = useState<unknown>(EMPTY_MAP);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [block, setBlock] = useState<'paragraph' | 'heading' | 'bullet' | 'check'>('paragraph');
  const [inlineFormat, setInlineFormat] = useState<'none' | 'bold' | 'italic' | 'underline'>('none');
  const [remoteVersion, setRemoteVersion] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pinId, setPinId] = useState<string | null>(null);
  const [sections, setSections] = useState<MobileNoteSection[]>([]);
  const [actionOpen, setActionOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [lexicalSelectedText, setLexicalSelectedText] = useState('');
  const [versionOpen, setVersionOpen] = useState(false);
  const titleRef = useRef<TextInput>(null);
  const bodyRef = useRef<TextInput>(null);
  const lexicalRef = useRef<MobileLexicalEditorHandle>(null);
  const lexicalLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const blockRef = useRef<'paragraph' | 'heading' | 'bullet' | 'check'>('paragraph');
  const inlineFormatRef = useRef<'none' | 'bold' | 'italic' | 'underline'>('none');
  const loadedIdRef = useRef<string | undefined>(noteId);
  const draftRef = useRef({ title: '', body: '', initialHtml: EMPTY_HTML, initialPlain: '', date: null as string | null });
  const mapStructureRef = useRef<unknown>(EMPTY_MAP);

  const setDraftDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    if (mountedRef.current) setDirty(next);
  }, []);

  const load = useCallback(async () => {
    if (!noteId) {
      setHydrating(false);
      setLoadError('Note unavailable');
      return;
    }
    setHydrating(true);
    setLoadError(null);
    loadedIdRef.current = noteId;
    try {
      const note = await getMobileNote(noteId);
      if (!mountedRef.current || loadedIdRef.current !== noteId) return;
      if (note.content_html == null && note.content == null && note.mode !== 'mind_map') throw new Error('The full note content is unavailable.');
      const html = note.content_html ?? note.content ?? EMPTY_HTML;
      const plain = htmlToPlainText(html);
      setTitle(note.title ?? '');
      setBody(plain);
      setInitialHtml(html || EMPTY_HTML);
      setInitialPlain(plain);
      setDate(note.date ?? null);
      setMood(note.mood ?? null);
      setMode(note.mode ?? 'text');
      const loadedMap = note.mind_map_structure ?? EMPTY_MAP;
      setMapStructure(loadedMap);
      mapStructureRef.current = loadedMap;
      setSectionId(note.section_id ?? null);
      setParentId(note.parent_id ?? null);
      const [pinResult, sectionResult] = await Promise.allSettled([getMobilePins(workspaceId), getMobileNoteSections(workspaceId)]);
      if (pinResult.status === 'fulfilled') { const pin = pinResult.value.pins?.find((item) => item.object_id === note.id); setPinned(Boolean(pin)); setPinId(pin?.id ?? null); }
      if (sectionResult.status === 'fulfilled') setSections(sectionResult.value);
      if (note.mode === 'meeting_note') {
        try { setMeetingMetadata(await getMobileMeetingMetadata(note.id)); } catch { setMeetingMetadata(null); }
      }
      setLoadedAt(note.updated_at ?? null);
      draftRef.current = { title: note.title ?? '', body: plain, initialHtml: html || EMPTY_HTML, initialPlain: plain, date: note.date ?? null };
      setDraftDirty(false);
      setSaveState('saved');
      setRemoteVersion(false);
      const localDraft = permissions.canEdit ? await getMobileNoteDraft(workspaceId, noteId) : null;
      if (localDraft && (localDraft.title !== (note.title ?? '') || localDraft.body !== plain || Boolean(localDraft.contentHtml && localDraft.contentHtml !== html))) {
        const restoreDraft = () => {
          const restoredHtml = localDraft.contentHtml ?? html;
          const restoredPlain = localDraft.contentHtml ? htmlToPlainText(restoredHtml) : localDraft.body;
          setTitle(localDraft.title); setBody(restoredPlain); setInitialHtml(restoredHtml); setInitialPlain(restoredPlain);
          draftRef.current = { ...draftRef.current, title: localDraft.title, body: restoredPlain, initialHtml: restoredHtml, initialPlain: restoredPlain };
          setDraftDirty(true); setSaveState('offline');
        };
        Alert.alert('Unsaved changes found', note.updated_at === localDraft.baseServerUpdatedAt ? 'Unsaved changes restored.' : 'The note changed on the server while this draft was pending.', [
          { text: 'Discard local changes', style: 'destructive', onPress: () => void clearMobileNoteDraft(workspaceId, noteId) },
          { text: 'Continue with local changes', onPress: restoreDraft },
          ...(note.updated_at !== localDraft.baseServerUpdatedAt ? [{ text: 'Load server version', onPress: () => void clearMobileNoteDraft(workspaceId, noteId) }] : []),
        ]);
      }
    } catch (error) {
      if (mountedRef.current) setLoadError(error instanceof Error ? error.message : 'Could not load this note.');
    } finally {
      if (mountedRef.current) setHydrating(false);
    }
  }, [noteId, permissions.canEdit, setDraftDirty, workspaceId]);

  useEffect(() => {
    if (hydrating || !noteId || mode === 'mind_map' || (mode === 'meeting_note' && meetingView === 'transcript') || !initialHtml) return;
    lexicalLoadedRef.current = false;
    lexicalRef.current?.loadDocument({ noteId, html: initialHtml, readOnly: !permissions.canEdit });
  }, [hydrating, initialHtml, meetingView, mode, noteId, permissions.canEdit]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (mapSaveTimerRef.current) clearTimeout(mapSaveTimerRef.current);
    };
  }, [load]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const save = useCallback(async (contentHtmlOverride?: string) => {
    if (!noteId || !workspaceId || hydrating || !dirtyRef.current || loadedIdRef.current !== noteId || savingRef.current) return false;
    if (contentHtmlOverride === undefined && lexicalLoadedRef.current && (mode === 'text' || mode === 'meeting_note')) {
      lexicalRef.current?.requestExport(noteId);
      return false;
    }
    savingRef.current = true;
    if (mountedRef.current) setSaveState('saving');
    const snapshot = draftRef.current;
    try {
      const saved = await updateMobileNote(workspaceId, noteId, {
        title: snapshot.title,
        content_html: contentHtmlOverride ?? serializeBody(snapshot.body, snapshot.initialHtml, snapshot.initialPlain, blockRef.current, inlineFormatRef.current),
        mode,
        date: snapshot.date,
        mood,
        mind_map_structure: mode === 'mind_map' ? mapStructure : undefined,
      });
      if (!mountedRef.current || loadedIdRef.current !== noteId) return false;
      const response = saved as { updated_at?: string | null; content_html?: string | null; title?: string };
      setLoadedAt(response.updated_at ?? new Date().toISOString());
      if (response.title !== undefined) setTitle(response.title);
      const savedHtml = response.content_html ?? contentHtmlOverride ?? serializeBody(snapshot.body, snapshot.initialHtml, snapshot.initialPlain, blockRef.current, inlineFormatRef.current);
      const savedPlain = htmlToPlainText(savedHtml);
      setInitialHtml(savedHtml);
      setInitialPlain(savedPlain);
      draftRef.current = { ...draftRef.current, title: response.title ?? snapshot.title, body: snapshot.body, initialHtml: savedHtml, initialPlain: savedPlain };
      setDraftDirty(false);
      void clearMobileNoteDraft(workspaceId, noteId);
      setSaveState('saved');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (contentHtmlOverride !== undefined) void saveMobileNoteDraft({ workspaceId, noteId, title: snapshot.title, body: htmlToPlainText(contentHtmlOverride), contentHtml: contentHtmlOverride, baseServerUpdatedAt: loadedAt, savedLocallyAt: new Date().toISOString(), editorGeneration: 0, savedAt: new Date().toISOString() });
      if (mountedRef.current) setSaveState(/network|offline|timeout|fetch failed|request failed/i.test(message) ? 'offline' : 'error');
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [hydrating, mapStructure, mode, mood, noteId, setDraftDirty, workspaceId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void save(); }, 1200);
  }, [save]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (dirtyRef.current && lexicalLoadedRef.current) lexicalRef.current?.requestExport(noteId);
      } else if (nextState === 'active' && dirtyRef.current && permissions.canEdit) scheduleSave();
    });
    return () => subscription.remove();
  }, [noteId, permissions.canEdit, scheduleSave]);

  const handleLexicalEvent = useCallback((event: EditorNativeEvent) => {
    if (event.type === 'DOCUMENT_LOADED' && event.noteId === noteId) { lexicalLoadedRef.current = true; setSaveState('saved'); return; }
    if (event.type === 'DIRTY_STATE_CHANGED' && event.noteId === noteId && event.dirty && permissions.canEdit) { setDraftDirty(true); scheduleSave(); return; }
    if (event.type === 'SELECTION_RESULT' && event.noteId === noteId) { setLexicalSelectedText(event.plainText.trim()); setSelectionActionsOpen(Boolean(event.plainText.trim())); return; }
    if (event.type === 'ERROR' && (!event.noteId || event.noteId === noteId)) setSaveState('error');
    if (event.type === 'DOCUMENT_EXPORTED' && event.noteId === noteId) {
      if (dirtyRef.current) void saveMobileNoteDraft({ workspaceId, noteId, title: draftRef.current.title, body: event.plainText, contentHtml: event.html, baseServerUpdatedAt: loadedAt, savedLocallyAt: new Date().toISOString(), editorGeneration: 0, savedAt: new Date().toISOString() });
      if (dirtyRef.current) void save(event.html);
    }
  }, [loadedAt, noteId, permissions.canEdit, save, scheduleSave, setDraftDirty, workspaceId]);

  const saveMap = useCallback(async (next: unknown) => {
    if (!noteId || !workspaceId || hydrating || loadedIdRef.current !== noteId) return;
    try {
      await updateMobileNote(workspaceId, noteId, { mode: 'mind_map', mind_map_structure: next });
      if (mountedRef.current && loadedIdRef.current === noteId) setSaveState('saved');
    } catch { if (mountedRef.current) setSaveState('error'); }
  }, [hydrating, noteId, workspaceId]);

  const handleMapChange = (next: unknown) => {
    setMapStructure(next);
    mapStructureRef.current = next;
    if (mapSaveTimerRef.current) clearTimeout(mapSaveTimerRef.current);
    if (!hydrating) mapSaveTimerRef.current = setTimeout(() => void saveMap(mapStructureRef.current), 1000);
  };

  const editTitle = (value: string) => {
    if (!permissions.canEdit) return;
    setTitle(value);
    draftRef.current.title = value;
    void saveMobileNoteDraft({ workspaceId, noteId: noteId ?? '', title: value, body: draftRef.current.body, savedAt: new Date().toISOString() });
    if (!hydrating) { setDraftDirty(true); scheduleSave(); }
  };

  const editBody = (value: string) => {
    if (!permissions.canEdit) return;
    setBody(value);
    draftRef.current.body = value;
    void saveMobileNoteDraft({ workspaceId, noteId: noteId ?? '', title: draftRef.current.title, body: value, savedAt: new Date().toISOString() });
    if (!hydrating) { setDraftDirty(true); scheduleSave(); }
  };

  const selectedText = body.slice(selectionRange.start, selectionRange.end).trim();

  const addTranscriptToSection = (section: 'notes' | 'decisions' | 'action_items', segment: import('@/api/notes').MobileTranscriptSegment) => {
    const marker = `[${section === 'action_items' ? 'Action Items' : section[0].toUpperCase() + section.slice(1)} · ${Math.floor(segment.startTimeMs / 60000)}:${String(Math.floor(segment.startTimeMs / 1000) % 60).padStart(2, '0')}] ${segment.text}`;
    if (body.includes(segment.text)) { Alert.alert('Already added', 'This transcript text is already in the note.'); return; }
    editBody(`${body.trim()}${body.trim() ? '\n\n' : ''}${marker}`);
    setMeetingView('write');
  };

  const selectBlock = (next: 'paragraph' | 'heading' | 'bullet' | 'check') => {
    blockRef.current = next;
    setBlock(next);
    if (!hydrating) { setDraftDirty(true); scheduleSave(); }
  };

  const selectInlineFormat = (next: 'none' | 'bold' | 'italic' | 'underline') => {
    inlineFormatRef.current = next;
    setInlineFormat(next);
    if (!hydrating) { setDraftDirty(true); scheduleSave(); }
  };

  const leave = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (dirtyRef.current) await save();
    router.back();
  }, [router, save]);

  const editorSummary: MobileNoteSummary = { id: noteId ?? '', workspace_id: workspaceId, title: title || 'Untitled', mode, section_id: sectionId, parent_id: parentId, updated_at: loadedAt, created_at: null };
  const toggleEditorPin = async () => {
    if (!noteId) return;
    try { if (pinned && pinId) { await unpinMobileObject(workspaceId, pinId); setPinned(false); setPinId(null); } else { const created = await pinMobileNote(workspaceId, noteId) as { id?: string }; setPinned(true); setPinId(created.id ?? null); } } catch (error) { Alert.alert('Could not update pin', error instanceof Error ? error.message : 'Please try again.'); }
  };
  const duplicateEditorNote = async () => { if (!noteId) return; await save(); try { const copy = await duplicateMobileNote(workspaceId, noteId); setActionOpen(false); router.push({ pathname: '/note/[id]', params: { id: copy.id, workspaceId } }); } catch (error) { Alert.alert('Could not duplicate note', error instanceof Error ? error.message : 'Please try again.'); } };
  const childEditorNote = async () => { if (!noteId) return; await save(); try { const child = await createMobileChildNote(workspaceId, noteId, { mode: 'text', section_id: sectionId }); if (sectionId) await moveMobileNote(workspaceId, child.id, { section_id: sectionId }); setActionOpen(false); router.push({ pathname: '/note/[id]', params: { id: child.id, workspaceId } }); } catch (error) { Alert.alert('Could not create child note', error instanceof Error ? error.message : 'Please try again.'); } };
  const deleteEditorNote = () => Alert.alert('Delete this note?', 'The note will be removed from this workspace. Linked projects, tasks, and calendar items will not be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (!noteId) return; try { await deleteMobileNote(workspaceId, noteId); router.back(); } catch (error) { Alert.alert('Could not delete note', error instanceof Error ? error.message : 'Please try again.'); } } }]);
  const moveEditorNote = async (nextSectionId: string | null) => { if (!noteId) return; try { await moveMobileNote(workspaceId, noteId, { section_id: nextSectionId }); setSectionId(nextSectionId); setMoveOpen(false); } catch (error) { Alert.alert('Could not move note', error instanceof Error ? error.message : 'Please try again.'); } };
  const applyRestoredNote = (value: unknown) => {
    const restored = value as { title?: string | null; content_html?: string | null; content?: string | null; mode?: 'text' | 'meeting_note' | 'mind_map'; mind_map_structure?: unknown; updated_at?: string | null };
    const restoredHtml = restored.content_html ?? restored.content ?? EMPTY_HTML;
    const restoredPlain = htmlToPlainText(restoredHtml);
    setTitle(restored.title ?? ''); setBody(restoredPlain); setInitialHtml(restoredHtml); setInitialPlain(restoredPlain); setMode(restored.mode ?? 'text'); setMapStructure(restored.mind_map_structure ?? EMPTY_MAP); mapStructureRef.current = restored.mind_map_structure ?? EMPTY_MAP; setLoadedAt(restored.updated_at ?? new Date().toISOString()); draftRef.current = { ...draftRef.current, title: restored.title ?? '', body: restoredPlain, initialHtml: restoredHtml, initialPlain: restoredPlain }; setDraftDirty(false); setSaveState('saved');
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { void leave(); return true; });
    return () => subscription.remove();
  }, [leave]);

  useEffect(() => {
    if (!noteId || !loadedAt) return;
    const interval = setInterval(() => {
      void getMobileNote(noteId).then((remote) => {
        if (!mountedRef.current || remote.id !== loadedIdRef.current || !remote.updated_at || remote.updated_at === loadedAt) return;
        if (dirtyRef.current) { setRemoteVersion(true); setSaveState('remote'); }
        else { void load(); }
      }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(interval);
  }, [load, loadedAt, noteId]);

  if (hydrating) return <EditorSkeleton />;
  if (loadError) return <EditorState title="Note unavailable" message={loadError} onRetry={() => void load()} onBack={() => router.back()} />;

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { borderBottomColor: theme.colors.borderSubtle }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Notes" onPress={() => void leave()} hitSlop={10} style={styles.headerButton}>
          <SymbolView name="chevron.left" size={18} tintColor={theme.colors.textPrimary} />
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saveState !== 'error' && saveState !== 'offline'} onPress={() => void save()}><AppText variant="caption" style={{ color: saveState === 'error' || saveState === 'offline' ? theme.colors.danger : theme.colors.textMuted }}>{statusLabel(saveState, dirty)}</AppText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Note actions" onPress={() => setActionOpen(true)} hitSlop={10} style={styles.headerButton}>
          <SymbolView name="ellipsis" size={18} tintColor={theme.colors.textPrimary} />
        </Pressable>
      </View>
      {mode === 'meeting_note' ? <><View style={[styles.meetingMeta, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="caption" numberOfLines={1}>{meetingMetadata?.scheduled_start_at ? new Date(meetingMetadata.scheduled_start_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Meeting note'}{meetingMetadata?.calendar_event_title ? ` · ${meetingMetadata.calendar_event_title}` : ''}</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{meetingStatusLabel(meetingMetadata?.transcription_status)}</AppText></View><View style={[styles.modeSwitcher, { backgroundColor: theme.colors.surfaceMuted }]}><Pressable onPress={() => setMeetingView('write')} style={[styles.modeItem, meetingView === 'write' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Write</AppText></Pressable><Pressable onPress={() => setMeetingView('transcript')} style={[styles.modeItem, meetingView === 'transcript' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Transcript</AppText></Pressable></View></> : mode === 'mind_map' ? <View style={[styles.modeSwitcher, { backgroundColor: theme.colors.surfaceMuted }]}><Pressable onPress={() => setMapView('map')} style={[styles.modeItem, mapView === 'map' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Map</AppText></Pressable><Pressable onPress={() => setMapView('outline')} style={[styles.modeItem, mapView === 'outline' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Outline</AppText></Pressable></View> : null}
      {remoteVersion ? <View style={[styles.remoteBanner, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="caption" style={styles.remoteText}>New version available</AppText><Pressable onPress={() => Alert.alert('Replace local draft?', 'Your unsaved changes will be discarded.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reload', style: 'destructive', onPress: () => void load() }])}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reload</AppText></Pressable><Pressable onPress={() => setRemoteVersion(false)}><AppText variant="caption">Dismiss</AppText></Pressable></View> : null}
      {!permissions.canEdit ? <View style={[styles.readOnlyBanner, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="caption">Read-only note</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>You can view this note, but editing is unavailable in this workspace.</AppText></View> : null}
      {mode === 'mind_map' ? <View style={styles.mapEditor}><TextInput editable={permissions.canEdit} ref={titleRef} accessibilityLabel="Mind map title" placeholder="Untitled" placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={editTitle} style={[styles.title, { color: theme.colors.textPrimary }]} /><MobileMindMapView structure={mapStructure} view={mapView} onChange={permissions.canEdit ? handleMapChange : () => undefined} /></View> : mode === 'meeting_note' && meetingView === 'transcript' && noteId ? <MobileTranscriptView noteId={noteId} workspaceId={workspaceId} attendees={meetingMetadata?.attendees ?? []} transcriptionStatus={meetingMetadata?.transcription_status} editable={permissions.canEdit} onAddToSection={permissions.canEdit ? addTranscriptToSection : undefined} /> : <View style={styles.editorSurface}>
        <TextInput editable={permissions.canEdit} ref={titleRef} accessibilityLabel="Note title" placeholder="Untitled" placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={editTitle} returnKeyType="next" onSubmitEditing={() => lexicalRef.current?.focus()} style={[styles.title, { color: theme.colors.textPrimary }]} />
        <MobileLexicalEditor ref={lexicalRef} showToolbar={permissions.canEdit} showStatus={false} workspaceId={workspaceId} noteId={noteId} onEvent={handleLexicalEvent} />
      </View>}
      <NoteActionSheet visible={actionOpen} note={editorSummary} permissions={permissions} pinned={pinned} onClose={() => setActionOpen(false)} onOpen={() => setActionOpen(false)} onVersionHistory={permissions.canEdit ? () => { setActionOpen(false); setVersionOpen(true); } : undefined} onTogglePin={() => void toggleEditorPin()} onMove={() => { setActionOpen(false); setMoveOpen(true); }} onDuplicate={() => void duplicateEditorNote()} onChild={() => void childEditorNote()} onProjects={() => { setActionOpen(false); setProjectOpen(true); }} onDelete={deleteEditorNote} />
      <NoteMoveSheet visible={moveOpen} note={editorSummary} sections={sections} onClose={() => setMoveOpen(false)} onMove={(nextSectionId) => void moveEditorNote(nextSectionId)} onParentMove={async (nextParentId) => { if (!noteId) return; try { await moveMobileNote(workspaceId, noteId, { parent_id: nextParentId }); setParentId(nextParentId); setMoveOpen(false); } catch (error) { Alert.alert('Could not change parent note', error instanceof Error ? error.message : 'Please try again.'); } }} />
      <NoteProjectSheet visible={projectOpen} workspaceId={workspaceId} note={editorSummary} onClose={() => setProjectOpen(false)} onChanged={() => undefined} />
      <NoteSelectionActionsSheet visible={selectionActionsOpen} workspaceId={workspaceId} noteId={noteId ?? ''} noteTitle={title || 'Untitled'} selectedText={lexicalSelectedText || selectedText} onClose={() => setSelectionActionsOpen(false)} onProject={() => { setSelectionActionsOpen(false); setProjectOpen(true); }} />
      {noteId ? <NoteVersionSheet visible={versionOpen} workspaceId={workspaceId} noteId={noteId} onClose={() => setVersionOpen(false)} onRestored={applyRestoredNote} /> : null}
    </KeyboardAvoidingView>
  );
}

function statusLabel(state: SaveState, dirty: boolean) {
  if (state === 'saving') return 'Saving…';
  if (state === 'offline') return 'Offline · pending';
  if (state === 'error') return 'Couldn’t save · Retry';
  if (state === 'remote') return 'New version available';
  return dirty ? 'Unsaved' : 'Saved';
}

function meetingStatusLabel(status?: string | null) {
  if (status === 'recording') return 'Recording';
  if (status === 'processing') return 'Transcribing…';
  if (status === 'failed') return 'Transcription failed';
  if (status === 'complete') return 'Transcript ready';
  return 'Recording unavailable on this device';
}

function ToolbarButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const theme = useLedgerTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.toolbarButton, { backgroundColor: active ? theme.colors.surfaceSelected : 'transparent', opacity: pressed ? 0.6 : 1 }]}><AppText variant="caption" style={{ color: theme.colors.textPrimary, fontWeight: active ? '700' : '500' }}>{label}</AppText></Pressable>;
}

function EditorSkeleton() {
  const theme = useLedgerTheme();
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={[styles.header, { borderBottomColor: theme.colors.borderSubtle }]}><View style={[styles.skeleton, { width: 30 }]} /><View style={[styles.skeleton, { width: 48 }]} /><View style={[styles.skeleton, { width: 30 }]} /></View><View style={styles.editorContent}><View style={[styles.skeleton, { height: 28, width: '70%' }]} />{[1, 2, 3, 4, 5].map((row) => <View key={row} style={[styles.skeleton, { height: 16, width: row === 5 ? '56%' : '94%' }]} />)}</View></View>;
}

function EditorState({ title, message, onRetry, onBack }: { title: string; message: string; onRetry: () => void; onBack: () => void }) {
  const theme = useLedgerTheme();
  return <View style={[styles.state, { backgroundColor: theme.colors.background }]}><AppText variant="bodyStrong">{title}</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{message}</AppText><View style={styles.stateActions}><Pressable onPress={onBack}><AppText variant="caption">Return to Notes</AppText></Pressable><Pressable onPress={onRetry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  remoteBanner: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
  remoteText: { flex: 1 },
  meetingMeta: { paddingHorizontal: 22, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  modeSwitcher: { alignSelf: 'center', flexDirection: 'row', padding: 3, borderRadius: 9, marginTop: 12 },
  modeItem: { minWidth: 82, alignItems: 'center', paddingVertical: 7, borderRadius: 7 },
  mapEditor: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  readOnlyBanner: { marginHorizontal: 18, marginTop: 10, padding: 10, borderRadius: 8, gap: 2 },
  editorScroll: { flex: 1 },
  editorSurface: { flex: 1, paddingHorizontal: 2 },
  editorContent: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 120, gap: 14 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', paddingVertical: 0 },
  body: { minHeight: 420, fontSize: 17, lineHeight: 27, paddingVertical: 0 },
  selectionBar: { minHeight: 42, borderRadius: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolbar: { maxHeight: 54, borderTopWidth: StyleSheet.hairlineWidth },
  toolbarContent: { alignItems: 'center', paddingHorizontal: 10, gap: 2 },
  toolbarButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.18)' },
  actionSheet: { padding: 20, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  actionRow: { minHeight: 48, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  state: { flex: 1, padding: 24, justifyContent: 'center', gap: 10 },
  stateActions: { flexDirection: 'row', gap: 20, marginTop: 8 },
  skeleton: { height: 14, borderRadius: 8, backgroundColor: '#E5E7EB', marginBottom: 18 },
});
