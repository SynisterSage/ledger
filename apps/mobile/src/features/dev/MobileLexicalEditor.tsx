import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import type { EditorDocumentIdentity, EditorNativeEvent, EditorSelectionState, NativeEditorCommand } from '@/bridge/messages';
import { parseEditorNativeEvent } from '@/bridge/validation';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { getSupabaseClient } from '@/api/client';
import { listMobileProjects } from '@/api/captures';
import { getMobileNoteSummaries, type MobileNoteSummary } from '@/api/notes';
import { MOBILE_EDITOR_HTML } from '../../../assets/mobile-editor/index';

export type MobileEditorStage =
  | 'native-mounted'
  | 'asset-resolved'
  | 'webview-mounted'
  | 'html-load-start'
  | 'html-load-end'
  | 'javascript-started'
  | 'lexical-mounted'
  | 'ready'
  | 'document-loaded'
  | 'bridge-error'
  | 'webview-error'
  | 'http-error';

export type MobileLexicalEditorHandle = {
  loadDocument: (input: { noteId: string; requestId?: string; html: string; readOnly?: boolean }) => string;
  requestExport: (noteId?: string) => string | null;
  resetDirty: () => void;
  setReadOnly: (value: boolean) => void;
  focus: () => void;
  reload: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  getGeneration: () => number;
  sendMalformedMessage: () => void;
  requestSelection: (noteId?: string) => string | null;
};

type Props = { showToolbar?: boolean; showStatus?: boolean; workspaceId?: string; noteId?: string; onEvent?: (event: EditorNativeEvent) => void; onEmbeddedError?: (message: string) => void; onStage?: (stage: MobileEditorStage, detail?: string) => void; onLedgerLink?: (url: string) => void; onLedgerContext?: () => void };
type LedgerLinkOption = { id: string; title: string; kind: 'note' | 'project'; url: string };
const EMPTY_SELECTION: EditorSelectionState = { bold: false, italic: false, underline: false, blockType: 'paragraph', canUndo: false, canRedo: false };

function requestId() { return `mobile-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
let editorGenerationSeed = 0;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    output += index + 2 < bytes.length ? alphabet[third & 63] : '=';
  }
  return output;
}

export const MobileLexicalEditor = forwardRef<MobileLexicalEditorHandle, Props>(function MobileLexicalEditor({ showToolbar = true, showStatus = true, workspaceId, noteId: propNoteId, onEvent, onEmbeddedError, onStage, onLedgerLink, onLedgerContext }, ref) {
  const theme = useLedgerTheme();
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<EditorSelectionState>(EMPTY_SELECTION);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [blockSheetOpen, setBlockSheetOpen] = useState(false);
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const [insertSheetOpen, setInsertSheetOpen] = useState(false);
  const [insertSheetMode, setInsertSheetMode] = useState<'insert' | 'ledger'>('insert');
  const [calloutSheetOpen, setCalloutSheetOpen] = useState(false);
  const [ledgerLinkOptions, setLedgerLinkOptions] = useState<LedgerLinkOption[]>([]);
  const [ledgerLinkQuery, setLedgerLinkQuery] = useState('');
  const [ledgerLinkLoading, setLedgerLinkLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [webViewGeneration, setWebViewGeneration] = useState(() => ++editorGenerationSeed);
  const readyRef = useRef(false);
  const hydratedRef = useRef(false);
  const queueRef = useRef<NativeEditorCommand[]>([]);
  const identityRef = useRef<EditorDocumentIdentity | null>(null);
  const activeDocumentRef = useRef<Extract<NativeEditorCommand, { type: 'LOAD_DOCUMENT' }> | null>(null);
  const pendingExportsRef = useRef(new Map<string, { noteId: string; generation: number }>());
  const pendingSelectionsRef = useRef(new Map<string, { noteId: string; generation: number }>());
  const generationRef = useRef(webViewGeneration);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inject = (command: NativeEditorCommand) => {
    const payload = JSON.stringify(command);
    webViewRef.current?.injectJavaScript(`window.postMessage(${JSON.stringify(payload)}, '*'); true;`);
  };
  const enqueue = (command: NativeEditorCommand) => {
    if (readyRef.current) { inject(command); return; }
    if (command.type === 'SET_THEME' || command.type === 'SET_READ_ONLY') queueRef.current = queueRef.current.filter((item) => item.type !== command.type);
    queueRef.current.push(command);
  };
  const flushQueue = () => { const queued = queueRef.current; queueRef.current = []; queued.forEach(inject); };
  const loadDocument = ({ noteId, requestId: suppliedRequestId, html, readOnly = false }: { noteId: string; requestId?: string; html: string; readOnly?: boolean }) => {
    const nextRequestId = suppliedRequestId ?? requestId();
    const activeDocument = activeDocumentRef.current;
    if (activeDocument && activeDocument.noteId === noteId && activeDocument.generation === generationRef.current && activeDocument.html === html && Boolean(activeDocument.readOnly) === readOnly) return activeDocument.requestId;
    const command: Extract<NativeEditorCommand, { type: 'LOAD_DOCUMENT' }> = { type: 'LOAD_DOCUMENT', noteId, requestId: nextRequestId, generation: generationRef.current, html, readOnly };
    identityRef.current = { noteId, loadRequestId: nextRequestId, generation: generationRef.current };
    activeDocumentRef.current = command;
    pendingExportsRef.current.clear();
    hydratedRef.current = false;
    setDirty(false); setError(null);
    queueRef.current = queueRef.current.filter((item) => item.type !== 'LOAD_DOCUMENT' && item.type !== 'REQUEST_EXPORT' && item.type !== 'SET_READ_ONLY');
    if (readyRef.current) { inject({ type: 'SET_READ_ONLY', value: true }); inject(command); }
    else queueRef.current.push({ type: 'SET_READ_ONLY', value: true }, command);
    return nextRequestId;
  };
  const requestExport = (requestedNoteId?: string) => {
    const identity = identityRef.current;
    if (!identity || !hydratedRef.current || (requestedNoteId && requestedNoteId !== identity.noteId)) return null;
    const exportRequestId = requestId();
    pendingExportsRef.current.clear();
    pendingExportsRef.current.set(exportRequestId, { noteId: identity.noteId, generation: identity.generation });
    enqueue({ type: 'REQUEST_EXPORT', noteId: identity.noteId, requestId: exportRequestId, generation: identity.generation });
    return exportRequestId;
  };
  const setReadOnly = (value: boolean) => enqueue({ type: 'SET_READ_ONLY', value });
  const resetDirty = () => enqueue({ type: 'RESET_DIRTY' });
  const setEditorTheme = (value: 'light' | 'dark') => enqueue({ type: 'SET_THEME', theme: value });
  const focus = () => enqueue({ type: 'FOCUS_EDITOR' });
  const requestSelection = (requestedNoteId?: string) => {
    const identity = identityRef.current;
    if (!identity || !hydratedRef.current || (requestedNoteId && requestedNoteId !== identity.noteId)) return null;
    const selectionRequestId = requestId();
    pendingSelectionsRef.current.clear();
    pendingSelectionsRef.current.set(selectionRequestId, { noteId: identity.noteId, generation: identity.generation });
    enqueue({ type: 'REQUEST_SELECTION', noteId: identity.noteId, requestId: selectionRequestId, generation: identity.generation });
    return selectionRequestId;
  };
  const reload = () => {
    const nextGeneration = generationRef.current + 1;
    generationRef.current = nextGeneration;
    if (activeDocumentRef.current) activeDocumentRef.current = { ...activeDocumentRef.current, generation: nextGeneration };
    if (identityRef.current) identityRef.current = { ...identityRef.current, generation: nextGeneration };
    setWebViewGeneration(nextGeneration);
  };
  const sendMalformedMessage = () => webViewRef.current?.injectJavaScript("window.postMessage('not-json', '*'); true;");
  useImperativeHandle(ref, () => ({ loadDocument, requestExport, resetDirty, setReadOnly, focus, reload, setTheme: setEditorTheme, getGeneration: () => generationRef.current, sendMalformedMessage, requestSelection }), []);

  const armReadyTimeout = () => { if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current); readyTimeoutRef.current = setTimeout(() => { if (readyRef.current) return; const message = 'The embedded editor did not finish loading.'; onStage?.('webview-error', message); setError(message); onEmbeddedError?.(message); }, 8000); };
  useEffect(() => { onStage?.('native-mounted'); onStage?.('asset-resolved'); onStage?.('webview-mounted'); armReadyTimeout(); return () => { if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current); }; }, [onStage]);
  useEffect(() => { if (ready) enqueue({ type: 'SET_THEME', theme: theme.scheme }); }, [ready, theme.scheme]);
  useEffect(() => { const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true)); const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false)); return () => { show.remove(); hide.remove(); }; }, []);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const parsed = parseEditorNativeEvent(JSON.parse(event.nativeEvent.data));
      if (!parsed) { const message = 'The embedded editor sent an invalid message.'; setError(message); onStage?.('bridge-error', message); onEmbeddedError?.(message); return; }
      if (parsed.type === 'READY') { if (parsed.generation !== generationRef.current) return; if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current); readyRef.current = true; setReady(true); onStage?.('ready', `generation ${parsed.generation}`); onEvent?.(parsed); enqueue({ type: 'SET_THEME', theme: theme.scheme }); flushQueue(); }
      if (parsed.type === 'FOCUSED') { if (parsed.generation !== generationRef.current) return; setFocused(true); onEvent?.(parsed); }
      if (parsed.type === 'BLURRED') { if (parsed.generation !== generationRef.current) return; setFocused(false); onEvent?.(parsed); }
      if (parsed.type === 'DOCUMENT_LOADED') { const identity = identityRef.current; if (!identity || parsed.generation !== generationRef.current || identity.generation !== parsed.generation || identity.noteId !== parsed.noteId || identity.loadRequestId !== parsed.requestId) return; hydratedRef.current = true; setDirty(false); onStage?.('document-loaded'); onEvent?.(parsed); }
      if (parsed.type === 'DIRTY_STATE_CHANGED') { const identity = identityRef.current; if (hydratedRef.current && identity && identity.generation === parsed.generation && identity.noteId === parsed.noteId) { setDirty(parsed.dirty); onEvent?.(parsed); } }
      if (parsed.type === 'SELECTION_STATE_CHANGED') { const identity = identityRef.current; if (identity && identity.generation === parsed.generation && identity.noteId === parsed.noteId) { setSelection(parsed.selection); onEvent?.(parsed); } }
      if (parsed.type === 'DOCUMENT_EXPORTED') { const identity = identityRef.current; const pending = pendingExportsRef.current.get(parsed.requestId); if (!identity || !pending || pending.noteId !== parsed.noteId || pending.generation !== parsed.generation || parsed.generation !== generationRef.current || identity.generation !== parsed.generation) return; pendingExportsRef.current.delete(parsed.requestId); onEvent?.(parsed); }
      if (parsed.type === 'SELECTION_RESULT') { const identity = identityRef.current; const pending = pendingSelectionsRef.current.get(parsed.requestId); if (!identity || !pending || pending.noteId !== parsed.noteId || pending.generation !== parsed.generation || parsed.generation !== generationRef.current || identity.generation !== parsed.generation) return; pendingSelectionsRef.current.delete(parsed.requestId); onEvent?.(parsed); }
      if (parsed.type === 'COPY_IMAGE_REQUEST') {
        if (parsed.generation !== generationRef.current || identityRef.current?.noteId !== parsed.noteId) return;
        let imageUrl: URL;
        try { imageUrl = new URL(parsed.src); } catch { Alert.alert('Could not copy image', 'This image link is not supported.'); return; }
        if (imageUrl.protocol !== 'https:') { Alert.alert('Could not copy image', 'Only secure image links can be copied.'); return; }
        void fetch(imageUrl.toString()).then(async (response) => {
          if (!response.ok) throw new Error(`Could not read image (${response.status}).`);
          const contentLength = Number(response.headers.get('content-length') || 0);
          if (contentLength > 10 * 1024 * 1024) throw new Error('This image is too large.');
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 10 * 1024 * 1024) throw new Error('This image is too large.');
          return buffer;
        }).then((buffer) => Clipboard.setImageAsync(arrayBufferToBase64(buffer))).catch((copyError) => Alert.alert('Could not copy image', copyError instanceof Error ? copyError.message : 'Please try again.'));
      }
      if (parsed.type === 'EDITOR_STAGE') { onStage?.(parsed.stage as MobileEditorStage, parsed.detail); onEvent?.(parsed); }
      if (parsed.type === 'EDITOR_ERROR') { if (parsed.generation !== generationRef.current) return; setError(parsed.message); onStage?.('bridge-error', `${parsed.code}: ${parsed.message}`); onEmbeddedError?.(parsed.message); onEvent?.(parsed); }
    } catch { const message = 'The embedded editor sent an invalid message.'; setError(message); onStage?.('bridge-error', message); onEmbeddedError?.(message); }
  };

  const onLoadStart = () => { onStage?.('html-load-start', `generation ${generationRef.current}`); armReadyTimeout(); readyRef.current = false; hydratedRef.current = false; setReady(false); pendingExportsRef.current.clear(); pendingSelectionsRef.current.clear(); if (activeDocumentRef.current) queueRef.current = [{ type: 'SET_READ_ONLY', value: true }, activeDocumentRef.current]; };
  const command = (next: NativeEditorCommand) => { enqueue(next); setTimeout(() => enqueue({ type: 'FOCUS_EDITOR' }), 0); };
  const captureSelection = () => enqueue({ type: 'CAPTURE_SELECTION' });
  const openLedgerLinkSheet = () => { captureSelection(); setLedgerLinkQuery(''); setInsertSheetMode('ledger'); setInsertSheetOpen(true); };
  const isLedgerLink = (value: string) => /^ledger:/i.test(value) || /^https?:\/\/ledger\.local(?:\/|$)/i.test(value);
  const normalizeLink = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isLedgerLink(trimmed)) return trimmed;
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || /\s/.test(trimmed)) return null;
      return candidate;
    } catch {
      return null;
    }
  };
  const openExternalLink = (value: string) => { const normalized = normalizeLink(value); if (!normalized || isLedgerLink(normalized)) { Alert.alert('Unsupported link', 'This link cannot be opened from Ledger.'); return; } void Linking.openURL(normalized).catch(() => Alert.alert('Could not open link', 'Try again from the note.')); };
  const openLinkTarget = (value: string) => { if (isLedgerLink(value)) onLedgerLink?.(value); else openExternalLink(value); };
  const openLinkSheet = () => { setLinkUrl(selection.linkUrl ?? ''); setLinkSheetOpen(true); };
  const submitLink = () => { const normalized = normalizeLink(linkUrl); if (!normalized) { Alert.alert('Enter a valid link', 'Use a domain like link.com, an http:// or https:// URL, or a Ledger link.'); return; } setLinkSheetOpen(false); command({ type: 'INSERT_LINK', url: normalized }); };
  useEffect(() => {
    if (!insertSheetOpen || insertSheetMode !== 'ledger' || !workspaceId || workspaceId === 'all') return;
    let cancelled = false;
    setLedgerLinkLoading(true);
    void Promise.all([getMobileNoteSummaries(workspaceId), listMobileProjects(workspaceId, false)])
      .then(([noteResult, projects]) => {
        if (cancelled) return;
        const notes = Array.isArray(noteResult) ? noteResult : noteResult.notes ?? [];
        const options: LedgerLinkOption[] = [
          ...notes.map((note: MobileNoteSummary) => ({ id: note.id, title: note.title || 'Untitled note', kind: 'note' as const, url: `ledger://notes?focusNoteId=${encodeURIComponent(note.id)}` })),
          ...projects.map((project) => ({ id: project.id, title: project.name || 'Untitled project', kind: 'project' as const, url: `ledger://projects/${encodeURIComponent(project.id)}` })),
        ];
        setLedgerLinkOptions(options);
      })
      .catch(() => { if (!cancelled) setLedgerLinkOptions([]); })
      .finally(() => { if (!cancelled) setLedgerLinkLoading(false); });
    return () => { cancelled = true; };
  }, [insertSheetOpen, insertSheetMode, workspaceId]);
  const filteredLedgerLinkOptions = ledgerLinkOptions.filter((option) => `${option.title} ${option.kind}`.toLowerCase().includes(ledgerLinkQuery.trim().toLowerCase()));
  const uploadNativeFile = async (uri: string, name: string, mimeType: string, folder: 'images' | 'attachments') => {
    const workspace = workspaceId?.trim(); const currentNoteId = propNoteId ?? identityRef.current?.noteId;
    if (!workspace || !currentNoteId) { Alert.alert('Upload unavailable', 'This note is not associated with a workspace.'); return null; }
    const client = getSupabaseClient();
    const safeName = name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 160) || 'upload';
    const path = `workspaces/${workspace}/notes/${currentNoteId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const body = await new File(uri).arrayBuffer();
    const bucket = folder === 'images' ? 'note-images' : 'note-files';
    const result = await client.storage.from(bucket).upload(path, body, { contentType: mimeType || 'application/octet-stream', cacheControl: '3600', upsert: false });
    if (result.error) throw result.error;
    const signed = await client.storage.from(bucket).createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('Could not authorize uploaded file.');
    const url = signed.data.signedUrl;
    return { url, path, sizeBytes: body.byteLength };
  };
  const pickImage = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 0.9 });
      const asset = result.canceled ? null : result.assets[0]; if (!asset) return;
      const uploaded = await uploadNativeFile(asset.uri, asset.fileName ?? `note-image-${Date.now()}.jpg`, asset.mimeType ?? 'image/jpeg', 'images');
      if (uploaded) command({ type: 'INSERT_IMAGE', src: uploaded.url, altText: asset.fileName ?? 'Note image', width: asset.width, height: asset.height });
    } catch (error) { Alert.alert('Image upload failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setUploading(false); }
  };
  const pickAttachment = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      const uploaded = await uploadNativeFile(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream', 'attachments');
      if (uploaded) command({ type: 'INSERT_ATTACHMENT', name: asset.name, mimeType: asset.mimeType, sizeBytes: asset.size ?? uploaded.sizeBytes, url: uploaded.url });
    } catch (error) { Alert.alert('Attachment upload failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setUploading(false); }
  };
  const openPickerAfterInsertSheetCloses = (picker: () => void) => {
    setInsertSheetOpen(false);
    Keyboard.dismiss();
    setTimeout(picker, 350);
  };
  const toolbarVisible = showToolbar && ready && focused && keyboardVisible;
  return <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {showStatus ? <View style={styles.status}><AppText variant="caption">{error ?? (ready ? focused ? 'Focused' : dirty ? 'Edited' : 'Ready' : 'Loading editor…')}</AppText>{!ready ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}</View> : null}
  <WebView key={webViewGeneration} ref={webViewRef} source={{ html: MOBILE_EDITOR_HTML, baseUrl: 'about:blank' }} injectedJavaScriptBeforeContentLoaded={`window.__ledgerEditorGeneration = ${webViewGeneration}; true;`} onMessage={onMessage} onLoadStart={onLoadStart} onLoadEnd={() => onStage?.('html-load-end')} onError={(event) => { const message = event.nativeEvent.description || 'The embedded editor was interrupted.'; setError(message); onStage?.('webview-error', message); onEmbeddedError?.(message); onEvent?.({ type: 'EDITOR_ERROR', generation: generationRef.current, code: 'WEBVIEW_LOAD_FAILED', message }); }} onHttpError={(event) => { const message = `Editor asset request failed (${event.nativeEvent.statusCode}).`; onStage?.('http-error', message); setError(message); onEmbeddedError?.(message); }} originWhitelist={['about:blank']} javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowUniversalAccessFromFileURLs={false} scrollEnabled automaticallyAdjustContentInsets={false} keyboardDisplayRequiresUserAction={false} setBuiltInZoomControls={false} scalesPageToFit={false} style={styles.webview} onShouldStartLoadWithRequest={(request) => { if (isLedgerLink(request.url)) { onLedgerLink?.(request.url); return false; } if (/^https?:\/\//i.test(request.url)) { openExternalLink(request.url); return false; } return request.url === 'about:blank'; }} />
    {toolbarVisible ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={[styles.toolbar, { borderTopColor: theme.colors.borderSubtle, backgroundColor: theme.colors.background }]} contentContainerStyle={styles.toolbarContent}><ToolbarButton label="Undo" icon={{ ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }} disabled={!selection.canUndo} onPress={() => command({ type: 'UNDO' })} /><ToolbarButton label="Redo" icon={{ ios: 'arrow.uturn.forward', android: 'redo', web: 'redo' }} disabled={!selection.canRedo} onPress={() => command({ type: 'REDO' })} /><ToolbarButton label="Text style" icon={{ ios: 'textformat', android: 'text_format', web: 'text_format' }} active={selection.blockType !== 'paragraph'} onPress={() => { captureSelection(); setBlockSheetOpen(true); }} /><ToolbarButton label="Bold" icon={{ ios: 'bold', android: 'format_bold', web: 'format_bold' }} active={selection.bold} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'bold' })} /><ToolbarButton label="Italic" icon={{ ios: 'italic', android: 'format_italic', web: 'format_italic' }} active={selection.italic} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'italic' })} /><ToolbarButton label="Underline" icon={{ ios: 'underline', android: 'format_underlined', web: 'format_underlined' }} active={selection.underline} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'underline' })} /><ToolbarButton label="List" icon={{ ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }} active={selection.listType === 'bullet' || selection.listType === 'number'} onPress={() => { captureSelection(); setListSheetOpen(true); }} /><ToolbarButton label="Checklist" icon={{ ios: 'checklist', android: 'checklist', web: 'checklist' }} active={selection.listType === 'check'} onPress={() => command({ type: 'TOGGLE_LIST', list: 'check' })} /><ToolbarButton label="Link" icon={{ ios: 'link', android: 'link', web: 'link' }} active={Boolean(selection.linkUrl)} onPress={() => { captureSelection(); openLinkSheet(); }} /><ToolbarButton label="Ledger" onPress={() => { if (onLedgerContext) onLedgerContext(); else requestSelection(identityRef.current?.noteId); }} /><ToolbarButton label="Insert" icon={{ ios: 'plus', android: 'add', web: 'add' }} onPress={() => { captureSelection(); setInsertSheetMode('insert'); setInsertSheetOpen(true); }} /></ScrollView> : null}
    <AppBottomSheet visible={blockSheetOpen} onClose={() => setBlockSheetOpen(false)} title={<AppText variant="sectionTitle">Text style</AppText>} headerAccessory={<SheetDoneButton onPress={() => setBlockSheetOpen(false)} />} snapPoints={['38%', '52%']} initialSnapPointIndex={0}><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{[['paragraph', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']].map(([block, label]) => <SheetRow key={block} label={label} selected={selection.blockType === block} onPress={() => { setBlockSheetOpen(false); command({ type: 'SET_BLOCK_TYPE', block: block as 'paragraph' | 'h1' | 'h2' | 'h3' }); }} />)}</View></AppBottomSheet>
    <AppBottomSheet visible={listSheetOpen} onClose={() => setListSheetOpen(false)} title={<AppText variant="sectionTitle">List</AppText>} headerAccessory={<SheetDoneButton onPress={() => setListSheetOpen(false)} />} snapPoints={['38%', '52%']} initialSnapPointIndex={0}><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{[['bullet', 'Bulleted list'], ['number', 'Numbered list'], ['check', 'Checklist']].map(([list, label]) => <SheetRow key={list} label={label} selected={selection.listType === list} onPress={() => { setListSheetOpen(false); command({ type: 'TOGGLE_LIST', list: list as 'bullet' | 'number' | 'check' }); }} />)}</View></AppBottomSheet>
    <AppBottomSheet visible={linkSheetOpen} onClose={() => setLinkSheetOpen(false)} title={<AppText variant="sectionTitle">{selection.linkUrl ? 'Edit link' : 'Add link'}</AppText>} headerAccessory={<SheetDoneButton label="Save link" onPress={submitLink} />} snapPoints={['72%', '90%']} initialSnapPointIndex={0} avoidKeyboard><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><TextInput autoFocus value={linkUrl} onChangeText={setLinkUrl} placeholder="https://" autoCapitalize="none" keyboardType="url" accessibilityLabel="Link URL" style={[styles.linkInput, { color: theme.colors.textPrimary }]} /><View style={styles.sheetActions}>{selection.linkUrl ? <><Pressable accessibilityRole="button" onPress={() => openLinkTarget(selection.linkUrl!)}><AppText variant="caption">Open link</AppText></Pressable><Pressable accessibilityRole="button" onPress={() => { setLinkSheetOpen(false); command({ type: 'REMOVE_LINK' }); }}><AppText variant="caption" style={{ color: theme.colors.danger }}>Remove</AppText></Pressable></> : null}</View></View></AppBottomSheet>
    <AppBottomSheet visible={insertSheetOpen} onClose={() => setInsertSheetOpen(false)} title={<AppText variant="sectionTitle">{insertSheetMode === 'ledger' ? 'Ledger link' : 'Insert'}</AppText>} headerAccessory={<SheetDoneButton onPress={() => setInsertSheetOpen(false)} />} snapPoints={insertSheetMode === 'ledger' ? ['68%', '90%'] : ['58%', '82%']} initialSnapPointIndex={0}>
      {insertSheetMode === 'ledger' ? <View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><TextInput autoFocus value={ledgerLinkQuery} onChangeText={setLedgerLinkQuery} placeholder="Search notes and projects…" placeholderTextColor={theme.colors.placeholder} style={[styles.linkInput, { color: theme.colors.textPrimary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.borderSubtle }]} />{ledgerLinkLoading ? <AppText variant="caption" style={styles.sheetHint}>Loading Ledger context…</AppText> : filteredLedgerLinkOptions.length === 0 ? <AppText variant="caption" style={styles.sheetHint}>No matching notes or projects.</AppText> : <ScrollView keyboardShouldPersistTaps="handled">{filteredLedgerLinkOptions.map((option) => <SheetRow key={`${option.kind}-${option.id}`} label={`${option.kind === 'note' ? 'Note' : 'Project'} · ${option.title}`} onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_RESOURCE_LINK', url: option.url, text: option.title }); }} />)}</ScrollView>}</View> : <View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><SheetRow label="Info callout" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: 'info' }); }} /><SheetRow label="Note callout" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: 'note' }); }} /><SheetRow label="Warning callout" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: 'warning' }); }} /><SheetRow label="Success callout" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: 'success' }); }} /><SheetRow label="Divider" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_DIVIDER' }); }} /><SheetRow label={uploading ? 'Uploading…' : 'Image'} onPress={() => openPickerAfterInsertSheetCloses(() => void pickImage())} /><SheetRow label={uploading ? 'Uploading…' : 'Attachment'} onPress={() => openPickerAfterInsertSheetCloses(() => void pickAttachment())} /><SheetRow label="Ledger link" onPress={openLedgerLinkSheet} /></View>}
    </AppBottomSheet>
    <AppBottomSheet visible={calloutSheetOpen} onClose={() => setCalloutSheetOpen(false)} title={<AppText variant="sectionTitle">Callout</AppText>} headerAccessory={<SheetDoneButton onPress={() => setCalloutSheetOpen(false)} />} snapPoints={['46%', '62%']} initialSnapPointIndex={0}><View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{[['info', 'Info'], ['note', 'Note'], ['warning', 'Warning'], ['success', 'Success']].map(([variant, label]) => <SheetRow key={variant} label={label} onPress={() => { setCalloutSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: variant as 'info' | 'note' | 'warning' | 'success' }); }} />)}</View></AppBottomSheet>
  </KeyboardAvoidingView>;
});

function ToolbarButton({ label, icon, active, disabled, onPress }: { label: string; icon?: ComponentProps<typeof SymbolView>['name']; active?: boolean; disabled?: boolean; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.toolbarButton, { opacity: disabled ? 0.32 : pressed ? 0.55 : 1, backgroundColor: active ? theme.colors.surfaceSelected : 'transparent' }]}>{icon ? <SymbolView name={icon} size={20} tintColor={active ? theme.colors.accent : theme.colors.textPrimary} /> : <AppText variant="caption">{label}</AppText>}</Pressable>; }
function SheetDoneButton({ onPress, label = 'Done' }: { onPress: () => void; label?: string }) { const theme = useLedgerTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={theme.colors.accent} /></Pressable>; }
function SheetRow({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} style={({ pressed }) => [styles.sheetRow, { opacity: pressed ? 0.68 : 1 }]}><AppText variant="body">{label}</AppText>{selected ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.colors.accent} /> : <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textMuted} />}</Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1 }, toolbar: { maxHeight: 52, borderTopWidth: StyleSheet.hairlineWidth }, toolbarContent: { alignItems: 'center', paddingHorizontal: 8, gap: 1 }, status: { minHeight: 28, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, webview: { flex: 1, backgroundColor: 'transparent' }, sheetCard: { overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 6 }, sheetRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetHint: { paddingVertical: 18, color: '#6b7280' }, linkInput: { minHeight: 48, borderBottomWidth: 0, fontSize: 16, paddingHorizontal: 0, paddingVertical: 8 }, sheetActions: { flexDirection: 'row', gap: 20, paddingTop: 16, flexWrap: 'wrap' }, toolbarButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' } });
