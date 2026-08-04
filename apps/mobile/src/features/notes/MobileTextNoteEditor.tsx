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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MobileTopFade } from '@/components/MobileTopFade';
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
import { openMobileNote } from './openMobileNote';
import { MobileLexicalEditor, type MobileEditorStage, type MobileLexicalEditorHandle } from '../dev/MobileLexicalEditor';
import type { EditorNativeEvent } from '@/bridge/messages';

type Props = { noteId?: string; workspaceId?: string; initialView?: 'write' | 'transcript' | 'map' | 'outline'; returnTo?: string; focusSegmentId?: string; focusNodeId?: string; focus?: 'title' | 'editor' };
type SaveState = 'saved' | 'saving' | 'offline' | 'error' | 'remote';
export type MobileNoteSaveState = {
  noteId: string;
  workspaceId: string;
  generation: number;
  hydrated: boolean;
  hasUserEdited: boolean;
  dirty: boolean;
  saving: boolean;
  pendingExportRequestId?: string;
  pendingSaveRevision?: number;
  baseServerUpdatedAt: string | null;
  lastConfirmedServerUpdatedAt?: string;
  lastSavedAt?: string;
  saveError?: string;
  offline: boolean;
};

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

function resolveLedgerLink(value: string) {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    const kind = parsed.protocol.toLowerCase() === 'ledger:' ? parsed.hostname.toLowerCase() : parts.shift()?.toLowerCase();
    const id = kind === 'notes' || kind === 'note' ? parsed.searchParams.get('focusNoteId') ?? parts[0] : parts[0];
    return kind && id?.trim() ? { kind, id: id.trim() } : null;
  } catch {
    return null;
  }
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

export function MobileTextNoteEditor({ noteId, workspaceId: requestedWorkspaceId, initialView = 'write', returnTo, focus = 'title' }: Props) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
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
  const [meetingView, setMeetingView] = useState<'write' | 'transcript'>(initialView === 'transcript' ? 'transcript' : 'write');
  const [mapView, setMapView] = useState<'map' | 'outline'>(initialView === 'outline' ? 'outline' : 'map');
  const [mapStructure, setMapStructure] = useState<unknown>(EMPTY_MAP);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorFailure, setEditorFailure] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorStage, setEditorStage] = useState<MobileEditorStage>('native-mounted');
  const [editorStageDetail, setEditorStageDetail] = useState<string | null>(null);
  const [readOnlyFallback, setReadOnlyFallback] = useState(false);
  const [editorMountKey, setEditorMountKey] = useState(0);
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
  const localRevisionRef = useRef(0);
  const saveLifecycleRef = useRef<MobileNoteSaveState>({ noteId: noteId ?? '', workspaceId, generation: 0, hydrated: false, hasUserEdited: false, dirty: false, saving: false, baseServerUpdatedAt: null, offline: false });
  const pendingExportRef = useRef<{ requestId: string; noteId: string; workspaceId: string; revision: number; generation: number; title: string; finalizing?: boolean } | null>(null);
  const pendingSaveRevisionRef = useRef<number | null>(null);
  const draftWriteRef = useRef<Promise<void> | null>(null);
  const exportWaitersRef = useRef(new Map<string, () => void>());
  const blockRef = useRef<'paragraph' | 'heading' | 'bullet' | 'check'>('paragraph');
  const inlineFormatRef = useRef<'none' | 'bold' | 'italic' | 'underline'>('none');
  const loadedIdRef = useRef<string | undefined>(noteId);
  const draftRef = useRef({ title: '', body: '', initialHtml: EMPTY_HTML, initialPlain: '', date: null as string | null });
  const mapStructureRef = useRef<unknown>(EMPTY_MAP);

  const setDraftDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    saveLifecycleRef.current.dirty = next;
    saveLifecycleRef.current.hasUserEdited = saveLifecycleRef.current.hasUserEdited || next;
    if (mountedRef.current) setDirty(next);
  }, []);

  const updateSaveLifecycle = useCallback((patch: Partial<MobileNoteSaveState>) => {
    saveLifecycleRef.current = { ...saveLifecycleRef.current, ...patch };
  }, []);

  const handleEditorStage = useCallback((stage: MobileEditorStage, detail?: string) => {
    setEditorStage(stage);
    setEditorStageDetail(detail ?? null);
    if (stage === 'html-load-start' || stage === 'ready') setEditorReady(false);
    if (stage === 'document-loaded') setEditorReady(true);
    if (stage === 'html-load-start') {
      lexicalLoadedRef.current = false;
      updateSaveLifecycle({ hydrated: false });
    }
  }, [updateSaveLifecycle]);

  const load = useCallback(async () => {
    if (!noteId) {
      setHydrating(false);
      setLoadError('Note unavailable');
      return;
    }
    setHydrating(true);
    setLoadError(null);
    loadedIdRef.current = noteId;
    localRevisionRef.current = 0;
    pendingExportRef.current = null;
    lexicalLoadedRef.current = false;
    updateSaveLifecycle({ noteId, workspaceId, generation: lexicalRef.current?.getGeneration() ?? 0, hydrated: false, hasUserEdited: false, dirty: false, saving: false, pendingExportRequestId: undefined, pendingSaveRevision: undefined, baseServerUpdatedAt: null, saveError: undefined, offline: false });
    try {
      const note = await getMobileNote(noteId);
      if (!mountedRef.current || loadedIdRef.current !== noteId) return;
      if (note.workspace_id && workspaceId !== 'all' && note.workspace_id !== workspaceId) throw new Error('This note is not available in the selected workspace.');
      const html = note.content_html ?? note.content;
      if (html == null && note.mode !== 'mind_map') throw new Error('The full note content is unavailable.');
      const resolvedHtml = html ?? EMPTY_HTML;
      const plain = htmlToPlainText(resolvedHtml);
      setTitle(note.title ?? '');
      setBody(plain);
      setInitialHtml(resolvedHtml);
      setInitialPlain(plain);
      setDate(note.date ?? null);
      setMood(note.mood ?? null);
      const nextMode = note.mode ?? 'text';
      if (nextMode !== 'text' && nextMode !== 'mind_map' && nextMode !== 'meeting_note') throw new Error('This note type is not supported in the mobile app.');
      setMode(nextMode);
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
      updateSaveLifecycle({ baseServerUpdatedAt: note.updated_at ?? null });
      draftRef.current = { title: note.title ?? '', body: plain, initialHtml: resolvedHtml, initialPlain: plain, date: note.date ?? null };
      setDraftDirty(false);
      setSaveState('saved');
      setRemoteVersion(false);
      const localDraft = permissions.canEdit ? await getMobileNoteDraft(workspaceId, noteId) : null;
      if (localDraft && (localDraft.title !== (note.title ?? '') || localDraft.body !== plain || Boolean(localDraft.contentHtml && localDraft.contentHtml !== resolvedHtml))) {
        const restoreDraft = () => {
          const restoredHtml = localDraft.contentHtml ?? resolvedHtml;
          const restoredPlain = localDraft.contentHtml ? htmlToPlainText(restoredHtml) : (localDraft.body ?? '');
          setTitle(localDraft.title); setBody(restoredPlain); setInitialHtml(restoredHtml); setInitialPlain(restoredPlain);
          draftRef.current = { ...draftRef.current, title: localDraft.title, body: restoredPlain, initialHtml: restoredHtml, initialPlain: restoredPlain };
          localRevisionRef.current = Math.max(1, localDraft.localRevision ?? 1);
          updateSaveLifecycle({ hasUserEdited: true, dirty: true, baseServerUpdatedAt: localDraft.baseServerUpdatedAt ?? note.updated_at ?? null, generation: localDraft.editorGeneration ?? 0, offline: true });
          setDraftDirty(true); setSaveState('offline');
        };
        if (note.updated_at === localDraft.baseServerUpdatedAt) restoreDraft();
        else Alert.alert('Unsaved changes found', 'The note changed on the server while this draft was pending.', [
          { text: 'Use server version', onPress: () => void clearMobileNoteDraft(workspaceId, noteId) },
          { text: 'Continue with local changes', onPress: restoreDraft },
        ]);
      }
    } catch (error) {
      if (mountedRef.current) setLoadError(error instanceof Error ? error.message : 'Could not load this note.');
    } finally {
      if (mountedRef.current) setHydrating(false);
    }
  }, [noteId, permissions.canEdit, setDraftDirty, updateSaveLifecycle, workspaceId]);

  useEffect(() => {
    if (hydrating || !noteId || mode === 'mind_map' || (mode === 'meeting_note' && meetingView === 'transcript') || initialHtml == null) return;
    lexicalLoadedRef.current = false;
    lexicalRef.current?.loadDocument({ noteId, html: initialHtml, readOnly: !permissions.canEdit });
  }, [editorMountKey, hydrating, initialHtml, meetingView, mode, noteId, permissions.canEdit]);

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

  const persistDraft = useCallback((input: { title: string; body: string; contentHtml?: string; revision?: number; generation?: number }) => {
    if (!noteId || !workspaceId) return;
    const draft = {
      noteId,
      workspaceId,
      title: input.title,
      body: input.body,
      contentHtml: input.contentHtml ?? '',
      baseServerUpdatedAt: loadedAt,
      localRevision: input.revision ?? localRevisionRef.current,
      savedLocallyAt: new Date().toISOString(),
      editorGeneration: input.generation ?? lexicalRef.current?.getGeneration() ?? 0,
    };
    const previousWrite = draftWriteRef.current ?? Promise.resolve();
    draftWriteRef.current = previousWrite.then(() => saveMobileNoteDraft(draft)).catch(() => undefined);
  }, [loadedAt, noteId, workspaceId]);

  const startSave = useCallback((finalizing = false) => {
    const activeNoteId = noteId;
    const activeWorkspaceId = workspaceId;
    if (!activeNoteId || !activeWorkspaceId) return null;
    const canSave = Boolean(permissions.canEdit && !hydrating && editorReady && lexicalLoadedRef.current && saveLifecycleRef.current.hydrated && saveLifecycleRef.current.hasUserEdited && dirtyRef.current && loadedIdRef.current === activeNoteId);
    if (!canSave) return null;
    if (savingRef.current) { pendingSaveRevisionRef.current = localRevisionRef.current; return null; }
    const revision = localRevisionRef.current;
    if (pendingExportRef.current?.revision === revision) return pendingExportRef.current.requestId;
    const generation = lexicalRef.current?.getGeneration() ?? 0;
    const requestId = lexicalRef.current?.requestExport(activeNoteId);
    if (!requestId) return null;
    pendingExportRef.current = { requestId, noteId: activeNoteId, workspaceId: activeWorkspaceId, revision, generation, title: draftRef.current.title, finalizing };
    updateSaveLifecycle({ generation, pendingExportRequestId: requestId, pendingSaveRevision: revision });
    if (mountedRef.current) setSaveState('saving');
    return requestId;
  }, [editorReady, hydrating, noteId, permissions.canEdit, updateSaveLifecycle, workspaceId]);

  const save = useCallback(async () => { startSave(); return false; }, [startSave]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { startSave(); }, 1200);
  }, [startSave]);

  useEffect(() => {
    if (editorStage === 'html-load-start' && dirtyRef.current) persistDraft({ title: draftRef.current.title, body: draftRef.current.body, revision: localRevisionRef.current, generation: lexicalRef.current?.getGeneration() ?? 0 });
  }, [editorStage, persistDraft]);

  useEffect(() => {
    if (permissions.canEdit) return;
    lexicalRef.current?.setReadOnly(true);
    if (dirtyRef.current) {
      persistDraft({ title: draftRef.current.title, body: draftRef.current.body, revision: localRevisionRef.current, generation: lexicalRef.current?.getGeneration() ?? 0 });
      updateSaveLifecycle({ saving: false, offline: true, saveError: 'You no longer have permission to edit this note.' });
    }
  }, [permissions.canEdit, persistDraft, updateSaveLifecycle]);

  useEffect(() => () => {
    if (dirtyRef.current) persistDraft({ title: draftRef.current.title, body: draftRef.current.body, revision: localRevisionRef.current, generation: lexicalRef.current?.getGeneration() ?? 0 });
  }, [persistDraft]);

  const persistExportedDocument = useCallback(async (event: Extract<EditorNativeEvent, { type: 'DOCUMENT_EXPORTED' }>, pending: { requestId: string; noteId: string; workspaceId: string; revision: number; generation: number; title: string; finalizing?: boolean }) => {
    const activeNoteId = noteId;
    const active = Boolean(activeNoteId && workspaceId && permissions.canEdit && pending.noteId === activeNoteId && pending.workspaceId === workspaceId && loadedIdRef.current === activeNoteId && event.noteId === activeNoteId && event.generation === pending.generation && pending.requestId === event.requestId);
    if (!active) return;
    if (!activeNoteId) return;
    if (savingRef.current) return;
    savingRef.current = true;
    pendingSaveRevisionRef.current = pending.revision;
    updateSaveLifecycle({ saving: true, pendingExportRequestId: undefined, pendingSaveRevision: pending.revision });
    const titleSnapshot = pending.title;
    const htmlSnapshot = event.html;
    const plainSnapshot = event.plainText;
    try {
      const saved = await updateMobileNote(workspaceId, activeNoteId, { title: titleSnapshot, content_html: htmlSnapshot, mode, date, mood, mind_map_structure: mode === 'mind_map' ? mapStructure : undefined });
      const response = saved as { updated_at?: string | null; content_html?: string | null; title?: string };
      const savedAt = response.updated_at ?? new Date().toISOString();
      const confirmedHtml = response.content_html ?? htmlSnapshot;
      const confirmedRevision = pending.revision;
      updateSaveLifecycle({ saving: false, baseServerUpdatedAt: savedAt, lastConfirmedServerUpdatedAt: savedAt, lastSavedAt: new Date().toISOString(), saveError: undefined, offline: false });
      if (mountedRef.current && loadedIdRef.current === activeNoteId) {
        setLoadedAt(savedAt);
        draftRef.current = { ...draftRef.current, title: response.title ?? titleSnapshot, body: plainSnapshot, initialHtml: confirmedHtml, initialPlain: htmlToPlainText(confirmedHtml) };
      }
      if (confirmedRevision === localRevisionRef.current && dirtyRef.current) {
        lexicalRef.current?.resetDirty();
        setDraftDirty(false);
        updateSaveLifecycle({ hydrated: true, hasUserEdited: true, dirty: false, pendingSaveRevision: undefined });
        void (async () => { await draftWriteRef.current; if (confirmedRevision === localRevisionRef.current && !dirtyRef.current) await clearMobileNoteDraft(workspaceId, activeNoteId); })();
        if (mountedRef.current) setSaveState('saved');
      } else if (mountedRef.current) {
        setSaveState('saving');
        scheduleSave();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this note.';
      persistDraft({ title: titleSnapshot, body: plainSnapshot, contentHtml: htmlSnapshot, revision: pending.revision, generation: pending.generation });
      updateSaveLifecycle({ saving: false, saveError: message, offline: /network|offline|timeout|fetch failed|request failed/i.test(message) });
      if (mountedRef.current) setSaveState(/network|offline|timeout|fetch failed|request failed/i.test(message) ? 'offline' : 'error');
    } finally {
      savingRef.current = false;
      pendingSaveRevisionRef.current = null;
      if (mountedRef.current && dirtyRef.current && pending.revision < localRevisionRef.current) scheduleSave();
    }
  }, [date, mapStructure, mode, mood, noteId, permissions.canEdit, persistDraft, scheduleSave, setDraftDirty, updateSaveLifecycle, workspaceId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (dirtyRef.current) {
          persistDraft({ title: draftRef.current.title, body: draftRef.current.body, revision: localRevisionRef.current, generation: lexicalRef.current?.getGeneration() ?? 0 });
          if (lexicalLoadedRef.current) startSave(true);
        }
      } else if (nextState === 'active' && dirtyRef.current && permissions.canEdit) scheduleSave();
    });
    return () => subscription.remove();
  }, [permissions.canEdit, persistDraft, scheduleSave, startSave]);

  const handleLexicalEvent = useCallback((event: EditorNativeEvent) => {
    if (!noteId) return;
    if (event.type === 'DOCUMENT_LOADED' && event.noteId === noteId) {
      lexicalLoadedRef.current = true;
      updateSaveLifecycle({ noteId, workspaceId, generation: event.generation, hydrated: true, baseServerUpdatedAt: loadedAt });
      setEditorFailure(null); setSaveState('saved');
      if (focus === 'editor') setTimeout(() => lexicalRef.current?.focus(), 0); else setTimeout(() => titleRef.current?.focus(), 0);
      return;
    }
    if (event.type === 'DIRTY_STATE_CHANGED' && event.noteId === noteId && event.dirty && permissions.canEdit) {
      localRevisionRef.current += 1;
      updateSaveLifecycle({ hasUserEdited: true, dirty: true, generation: event.generation });
      setDraftDirty(true); scheduleSave();
      return;
    }
    if (event.type === 'SELECTION_RESULT' && event.noteId === noteId) { setLexicalSelectedText(event.plainText.trim()); setSelectionActionsOpen(Boolean(event.plainText.trim())); return; }
    if (event.type === 'EDITOR_ERROR' && (!event.noteId || event.noteId === noteId)) {
      const pending = pendingExportRef.current;
      if (pending && (!event.requestId || event.requestId === pending.requestId)) {
        pendingExportRef.current = null;
        persistDraft({ title: pending.title, body: draftRef.current.body, revision: pending.revision, generation: pending.generation });
      }
      updateSaveLifecycle({ saving: false, saveError: event.message });
      setSaveState('error');
      return;
    }
    if (event.type === 'DOCUMENT_EXPORTED' && event.noteId === noteId) {
      const pending = pendingExportRef.current;
      if (!pending || pending.requestId !== event.requestId || pending.generation !== event.generation) return;
      pendingExportRef.current = null;
      exportWaitersRef.current.get(event.requestId)?.();
      exportWaitersRef.current.delete(event.requestId);
      void persistExportedDocument(event, pending);
    }
  }, [focus, loadedAt, noteId, permissions.canEdit, persistDraft, persistExportedDocument, scheduleSave, setDraftDirty, updateSaveLifecycle, workspaceId]);

  const saveMap = useCallback(async (next: unknown, nextTitle = title) => {
    if (!noteId || !workspaceId || hydrating || loadedIdRef.current !== noteId) return;
    try {
      await updateMobileNote(workspaceId, noteId, { title: nextTitle, mode: 'mind_map', mind_map_structure: next });
      if (mountedRef.current && loadedIdRef.current === noteId) setSaveState('saved');
    } catch { if (mountedRef.current) setSaveState('error'); }
  }, [hydrating, noteId, title, workspaceId]);

  const handleMapChange = (next: unknown) => {
    setMapStructure(next);
    mapStructureRef.current = next;
    if (mapSaveTimerRef.current) clearTimeout(mapSaveTimerRef.current);
    if (!hydrating) mapSaveTimerRef.current = setTimeout(() => void saveMap(mapStructureRef.current), 1000);
  };

  const markUserEdit = useCallback(() => {
    if (hydrating || !permissions.canEdit) return;
    localRevisionRef.current += 1;
    updateSaveLifecycle({ hasUserEdited: true, dirty: true });
    setDraftDirty(true);
    scheduleSave();
  }, [hydrating, permissions.canEdit, scheduleSave, setDraftDirty, updateSaveLifecycle]);

  const editTitle = (value: string) => {
    if (!permissions.canEdit) return;
    setTitle(value);
    draftRef.current.title = value;
    markUserEdit();
    if (mode === 'mind_map') {
      if (mapSaveTimerRef.current) clearTimeout(mapSaveTimerRef.current);
      mapSaveTimerRef.current = setTimeout(() => void saveMap(mapStructureRef.current, value), 1000);
    }
  };

  const editBody = (value: string) => {
    if (!permissions.canEdit) return;
    setBody(value);
    draftRef.current.body = value;
    markUserEdit();
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
    if (dirtyRef.current && permissions.canEdit) {
      const requestId = startSave(true);
      persistDraft({ title: draftRef.current.title, body: draftRef.current.body, revision: localRevisionRef.current, generation: lexicalRef.current?.getGeneration() ?? 0 });
      if (requestId) await new Promise<void>((resolve) => {
        exportWaitersRef.current.set(requestId, resolve);
        setTimeout(() => { exportWaitersRef.current.delete(requestId); resolve(); }, 500);
      });
    }
    if (router.canGoBack()) router.back();
    else router.replace((returnTo || '/(tabs)/notes') as any);
  }, [permissions.canEdit, persistDraft, returnTo, router, startSave]);

  const editorSummary: MobileNoteSummary = { id: noteId ?? '', workspace_id: workspaceId, title: title || 'Untitled', mode, section_id: sectionId, parent_id: parentId, updated_at: loadedAt, created_at: null };
  const toggleEditorPin = async () => {
    if (!noteId) return;
    try { if (pinned && pinId) { await unpinMobileObject(workspaceId, pinId); setPinned(false); setPinId(null); } else { const created = await pinMobileNote(workspaceId, noteId) as { id?: string }; setPinned(true); setPinId(created.id ?? null); } } catch (error) { Alert.alert('Could not update pin', error instanceof Error ? error.message : 'Please try again.'); }
  };
  const duplicateEditorNote = async () => { if (!noteId) return; await save(); try { const copy = await duplicateMobileNote(workspaceId, noteId); setActionOpen(false); openMobileNote(router, copy.id, { workspaceId }); } catch (error) { Alert.alert('Could not duplicate note', error instanceof Error ? error.message : 'Please try again.'); } };
  const childEditorNote = async () => { if (!noteId) return; await save(); try { const child = await createMobileChildNote(workspaceId, noteId, { mode: 'text', section_id: sectionId }); if (sectionId) await moveMobileNote(workspaceId, child.id, { section_id: sectionId }); setActionOpen(false); openMobileNote(router, child.id, { workspaceId }); } catch (error) { Alert.alert('Could not create child note', error instanceof Error ? error.message : 'Please try again.'); } };
  const deleteEditorNote = () => Alert.alert('Delete this note?', 'The note will be removed from this workspace. Linked projects, tasks, and calendar items will not be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (!noteId) return; try { await deleteMobileNote(workspaceId, noteId); router.back(); } catch (error) { Alert.alert('Could not delete note', error instanceof Error ? error.message : 'Please try again.'); } } }]);
  const moveEditorNote = async (nextSectionId: string | null) => { if (!noteId) return; try { await moveMobileNote(workspaceId, noteId, { section_id: nextSectionId }); setSectionId(nextSectionId); setMoveOpen(false); } catch (error) { Alert.alert('Could not move note', error instanceof Error ? error.message : 'Please try again.'); } };
  const applyRestoredNote = (value: unknown) => {
    const restored = value as { title?: string | null; content_html?: string | null; content?: string | null; mode?: 'text' | 'meeting_note' | 'mind_map'; mind_map_structure?: unknown; updated_at?: string | null };
    const restoredHtml = restored.content_html ?? restored.content ?? EMPTY_HTML;
    const restoredPlain = htmlToPlainText(restoredHtml);
    setTitle(restored.title ?? '');
    setBody(restoredPlain);
    setInitialHtml(restoredHtml);
    setInitialPlain(restoredPlain);
    setMode(restored.mode ?? 'text');
    setMapStructure(restored.mind_map_structure ?? EMPTY_MAP);
    mapStructureRef.current = restored.mind_map_structure ?? EMPTY_MAP;
    setLoadedAt(restored.updated_at ?? new Date().toISOString());
    draftRef.current = { ...draftRef.current, title: restored.title ?? '', body: restoredPlain, initialHtml: restoredHtml, initialPlain: restoredPlain };
    lexicalLoadedRef.current = false;
    setEditorReady(false);
    setEditorMountKey((current) => current + 1);
    setRemoteVersion(false);
    setDraftDirty(false);
    updateSaveLifecycle({ hydrated: true, hasUserEdited: false, saving: false, pendingSaveRevision: undefined, saveError: undefined, offline: false });
    setSaveState('saved');
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

  const meetingTitle = mode === 'meeting_note' ? <View style={styles.meetingTitleRow}>
    <TextInput editable={permissions.canEdit} ref={titleRef} accessibilityLabel="Note title" placeholder="Untitled" placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={editTitle} returnKeyType="next" onSubmitEditing={() => lexicalRef.current?.focus()} style={[styles.title, { color: theme.colors.textPrimary }, styles.meetingTitle]} />
    <View style={[styles.modeSwitcher, styles.inlineModeSwitcher, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Write note" onPress={() => setMeetingView('write')} style={[styles.modeItem, meetingView === 'write' && { backgroundColor: theme.colors.surface }]}>
        <SymbolView name={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }} size={17} tintColor={theme.colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="View transcript" onPress={() => setMeetingView('transcript')} style={[styles.modeItem, meetingView === 'transcript' && { backgroundColor: theme.colors.surface }]}>
        <SymbolView name={{ ios: 'text.bubble', android: 'notes', web: 'notes' }} size={17} tintColor={theme.colors.textPrimary} />
      </Pressable>
    </View>
  </View> : null;

  if (hydrating) return <EditorSkeleton />;
  if (loadError) return <EditorState title="Note unavailable" message={loadError} onRetry={() => void load()} onBack={() => router.back()} />;

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={[styles.header, { minHeight: 54 + insets.top, paddingTop: insets.top, borderBottomColor: theme.colors.borderSubtle }]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Notes" onPress={() => void leave()} hitSlop={10} style={styles.headerButton}>
          <SymbolView name="chevron.left" size={18} tintColor={theme.colors.textPrimary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Note status: ${statusLabel(saveState, dirty)}`} accessibilityHint={saveState === 'error' || saveState === 'offline' ? 'Retry saving this note' : undefined} disabled={saveState !== 'error' && saveState !== 'offline'} onPress={() => void save()}><AppText variant="caption" accessibilityLiveRegion="polite" style={{ color: saveState === 'error' || saveState === 'offline' ? theme.colors.danger : theme.colors.textMuted }}>{statusLabel(saveState, dirty)}</AppText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Note actions" onPress={() => setActionOpen(true)} hitSlop={10} style={styles.headerButton}>
          <SymbolView name="ellipsis" size={18} tintColor={theme.colors.textPrimary} />
        </Pressable>
      </View>
      <MobileTopFade topOffset={54 + insets.top} />
      {mode === 'mind_map' ? <View style={[styles.modeSwitcher, { backgroundColor: theme.colors.surfaceMuted }]}><Pressable onPress={() => setMapView('map')} style={[styles.modeItem, mapView === 'map' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Map</AppText></Pressable><Pressable onPress={() => setMapView('outline')} style={[styles.modeItem, mapView === 'outline' && { backgroundColor: theme.colors.surface }]}><AppText variant="caption">Outline</AppText></Pressable></View> : null}
      {remoteVersion ? <View style={[styles.remoteBanner, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="caption" style={styles.remoteText}>New version available</AppText><Pressable onPress={() => Alert.alert('Replace local draft?', 'Your unsaved changes will be discarded.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reload', style: 'destructive', onPress: () => void load() }])}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reload</AppText></Pressable><Pressable onPress={() => setRemoteVersion(false)}><AppText variant="caption">Dismiss</AppText></Pressable></View> : null}
      {!permissions.canEdit ? <View accessibilityRole="text" style={[styles.readOnlyBanner, { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="caption">Read-only note</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>You can view this note, but editing is unavailable in this workspace.</AppText></View> : null}
      {mode === 'mind_map' ? <View style={styles.mapEditor}><TextInput editable={permissions.canEdit} ref={titleRef} accessibilityLabel="Mind map title" placeholder="Untitled" placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={editTitle} style={[styles.title, { color: theme.colors.textPrimary }]} /><MobileMindMapView structure={mapStructure} title={title} view={mapView} hideControls={keyboardVisible} onChange={permissions.canEdit ? handleMapChange : () => undefined} /></View> : mode === 'meeting_note' && meetingView === 'transcript' && noteId ? <View style={styles.editorSurface}>{meetingTitle}<MobileTranscriptView noteId={noteId} workspaceId={workspaceId} attendees={meetingMetadata?.attendees ?? []} transcriptionStatus={meetingMetadata?.transcription_status} editable={permissions.canEdit} onAddToSection={permissions.canEdit ? addTranscriptToSection : undefined} /></View> : <View style={styles.editorSurface}>
        {mode === 'meeting_note' ? meetingTitle : <TextInput editable={permissions.canEdit} ref={titleRef} accessibilityLabel="Note title" placeholder="Untitled" placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={editTitle} returnKeyType="next" onSubmitEditing={() => lexicalRef.current?.focus()} style={[styles.title, { color: theme.colors.textPrimary }]} />}
        {readOnlyFallback ? <View style={styles.readOnlyContent}><AppText variant="body">{body || 'This note has no text content.'}</AppText><Pressable accessibilityRole="button" onPress={() => { setReadOnlyFallback(false); setEditorFailure(null); setEditorMountKey((current) => current + 1); }}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry editor</AppText></Pressable></View> : editorFailure ? <EditorFailure message={`${editorStage}: ${editorFailure}${editorStageDetail ? ` · ${editorStageDetail}` : ''}`} onRetry={() => { setEditorFailure(null); setEditorMountKey((current) => current + 1); }} onReadOnly={() => { setReadOnlyFallback(true); setEditorFailure(null); }} onBack={() => void leave()} /> : <View style={styles.embeddedEditor}><MobileLexicalEditor key={editorMountKey} ref={lexicalRef} showToolbar={permissions.canEdit} showStatus={false} workspaceId={workspaceId} noteId={noteId} onEvent={handleLexicalEvent} onEmbeddedError={setEditorFailure} onStage={handleEditorStage} onLedgerLink={(url) => { const target = resolveLedgerLink(url); if (!target) { Alert.alert('Ledger link unavailable', 'This link does not contain a valid Ledger destination.'); return; } if (target.kind === 'note' || target.kind === 'notes') { openMobileNote(router, target.id, { workspaceId, returnTo: `/note/${noteId}` }); return; } if (target.kind === 'project' || target.kind === 'projects') { router.push({ pathname: '/project/[id]', params: { id: target.id, workspaceId } }); return; } Alert.alert('Ledger link unavailable', 'This Ledger destination is not available on mobile yet.'); }} />{!editorReady ? <View pointerEvents="none" style={styles.editorLoading}><AppText variant="caption">Loading editor…</AppText></View> : null}</View>}
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

function ToolbarButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const theme = useLedgerTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.toolbarButton, { backgroundColor: active ? theme.colors.surfaceSelected : 'transparent', opacity: pressed ? 0.6 : 1 }]}><AppText variant="caption" style={{ color: theme.colors.textPrimary, fontWeight: active ? '700' : '500' }}>{label}</AppText></Pressable>;
}

function EditorSkeleton() {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={[styles.header, { minHeight: 54 + insets.top, paddingTop: insets.top, borderBottomColor: theme.colors.borderSubtle }]}><View style={[styles.skeleton, { backgroundColor: theme.colors.surfaceMuted, width: 30 }]} /><View style={[styles.skeleton, { backgroundColor: theme.colors.surfaceMuted, width: 48 }]} /><View style={[styles.skeleton, { backgroundColor: theme.colors.surfaceMuted, width: 30 }]} /></View><MobileTopFade topOffset={54 + insets.top} /><View style={styles.editorContent}><View style={[styles.skeleton, { backgroundColor: theme.colors.surfaceMuted, height: 28, width: '70%' }]} />{[1, 2, 3, 4, 5].map((row) => <View key={row} style={[styles.skeleton, { backgroundColor: theme.colors.surfaceMuted, height: 16, width: row === 5 ? '56%' : '94%' }]} />)}</View></View>;
}

function EditorState({ title, message, onRetry, onBack }: { title: string; message: string; onRetry: () => void; onBack: () => void }) {
  const theme = useLedgerTheme();
  return <View style={[styles.state, { backgroundColor: theme.colors.background }]}><AppText variant="bodyStrong">{title}</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{message}</AppText><View style={styles.stateActions}><Pressable onPress={onBack}><AppText variant="caption">Return to Notes</AppText></Pressable><Pressable onPress={onRetry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View></View>;
}

function EditorFailure({ message, onRetry, onReadOnly, onBack }: { message: string; onRetry: () => void; onReadOnly: () => void; onBack: () => void }) {
  const theme = useLedgerTheme();
  return <View style={styles.editorFailure}><AppText variant="bodyStrong">Write editor couldn’t load</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{message}</AppText><View style={styles.stateActions}><Pressable onPress={onRetry}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable><Pressable onPress={onReadOnly}><AppText variant="caption">Open read-only</AppText></Pressable><Pressable onPress={onBack}><AppText variant="caption">Back to Notes</AppText></Pressable></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  remoteBanner: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
  remoteText: { flex: 1 },
  meetingTitleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  meetingTitle: { flex: 1, paddingHorizontal: 0 },
  modeSwitcher: { alignSelf: 'center', flexDirection: 'row', padding: 3, borderRadius: 9, marginTop: 12 },
  inlineModeSwitcher: { alignSelf: 'auto', marginTop: 0, marginLeft: 10 },
  modeItem: { minWidth: 82, alignItems: 'center', paddingVertical: 7, borderRadius: 7 },
  mapEditor: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  readOnlyBanner: { marginHorizontal: 18, marginTop: 10, padding: 10, borderRadius: 8, gap: 2 },
  editorScroll: { flex: 1 },
  editorSurface: { flex: 1 },
  embeddedEditor: { flex: 1 },
  editorLoading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  readOnlyContent: { flex: 1, paddingHorizontal: 22, paddingTop: 22, gap: 18 },
  editorFailure: { flex: 1, padding: 22, justifyContent: 'center', gap: 10 },
  editorContent: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 120, gap: 14 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', paddingHorizontal: 20, paddingVertical: 7 },
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
  skeleton: { height: 14, borderRadius: 8, marginBottom: 18 },
});
