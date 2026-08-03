import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import type { EditorDocumentIdentity, EditorNativeEvent, EditorSelectionState, NativeEditorCommand } from '@/bridge/messages';
import { parseEditorNativeEvent } from '@/bridge/validation';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { getSupabaseClient } from '@/api/client';

const editorAsset = require('../../../assets/mobile-editor/index.html');

export type MobileLexicalEditorHandle = {
  loadDocument: (input: { noteId: string; requestId?: string; html: string; readOnly?: boolean }) => string;
  requestExport: (noteId?: string) => string | null;
  setReadOnly: (value: boolean) => void;
  focus: () => void;
  requestSelection: (noteId?: string) => string | null;
};

type Props = { showToolbar?: boolean; showStatus?: boolean; workspaceId?: string; noteId?: string; onEvent?: (event: EditorNativeEvent) => void };
const EMPTY_SELECTION: EditorSelectionState = { bold: false, italic: false, underline: false, blockType: 'paragraph', canUndo: false, canRedo: false };

function requestId() { return `mobile-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export const MobileLexicalEditor = forwardRef<MobileLexicalEditorHandle, Props>(function MobileLexicalEditor({ showToolbar = true, showStatus = true, workspaceId, noteId: propNoteId, onEvent }, ref) {
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
  const [calloutSheetOpen, setCalloutSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const readyRef = useRef(false);
  const queueRef = useRef<NativeEditorCommand[]>([]);
  const identityRef = useRef<EditorDocumentIdentity | null>(null);
  const activeDocumentRef = useRef<Extract<NativeEditorCommand, { type: 'LOAD_DOCUMENT' }> | null>(null);
  const pendingExportsRef = useRef(new Map<string, number>());
  const pendingSelectionsRef = useRef(new Map<string, number>());
  const generationRef = useRef(0);

  const inject = (command: NativeEditorCommand) => {
    const payload = JSON.stringify(command);
    webViewRef.current?.injectJavaScript(`window.postMessage(${JSON.stringify(payload)}, '*'); true;`);
  };
  const enqueue = (command: NativeEditorCommand) => { if (readyRef.current) inject(command); else queueRef.current.push(command); };
  const flushQueue = () => { const queued = queueRef.current; queueRef.current = []; queued.forEach(inject); };
  const loadDocument = ({ noteId, requestId: suppliedRequestId, html, readOnly = false }: { noteId: string; requestId?: string; html: string; readOnly?: boolean }) => {
    const nextRequestId = suppliedRequestId ?? requestId();
    const command: Extract<NativeEditorCommand, { type: 'LOAD_DOCUMENT' }> = { type: 'LOAD_DOCUMENT', noteId, requestId: nextRequestId, html, readOnly };
    generationRef.current += 1;
    identityRef.current = { noteId, loadRequestId: nextRequestId, generation: generationRef.current };
    activeDocumentRef.current = command;
    pendingExportsRef.current.clear();
    setDirty(false); setError(null);
    queueRef.current = queueRef.current.filter((item) => item.type !== 'LOAD_DOCUMENT' && item.type !== 'REQUEST_EXPORT' && item.type !== 'SET_READ_ONLY');
    if (readyRef.current) { inject({ type: 'SET_READ_ONLY', value: true }); inject(command); }
    else queueRef.current.push({ type: 'SET_READ_ONLY', value: true }, command);
    return nextRequestId;
  };
  const requestExport = (requestedNoteId?: string) => {
    const identity = identityRef.current;
    if (!identity || (requestedNoteId && requestedNoteId !== identity.noteId)) return null;
    const exportRequestId = requestId();
    pendingExportsRef.current.set(exportRequestId, identity.generation);
    enqueue({ type: 'REQUEST_EXPORT', noteId: identity.noteId, requestId: exportRequestId });
    return exportRequestId;
  };
  const setReadOnly = (value: boolean) => enqueue({ type: 'SET_READ_ONLY', value });
  const focus = () => enqueue({ type: 'FOCUS_EDITOR' });
  const requestSelection = (requestedNoteId?: string) => {
    const identity = identityRef.current;
    if (!identity || (requestedNoteId && requestedNoteId !== identity.noteId)) return null;
    const selectionRequestId = requestId();
    pendingSelectionsRef.current.set(selectionRequestId, identity.generation);
    enqueue({ type: 'REQUEST_SELECTION', noteId: identity.noteId, requestId: selectionRequestId });
    return selectionRequestId;
  };
  useImperativeHandle(ref, () => ({ loadDocument, requestExport, setReadOnly, focus, requestSelection }), []);

  useEffect(() => { if (ready) enqueue({ type: 'SET_THEME', theme: theme.scheme }); }, [ready, theme.scheme]);
  useEffect(() => { const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true)); const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false)); return () => { show.remove(); hide.remove(); }; }, []);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const parsed = parseEditorNativeEvent(JSON.parse(event.nativeEvent.data));
      if (!parsed) { setError('The embedded editor sent an invalid message.'); return; }
      if (parsed.type === 'READY') { readyRef.current = true; setReady(true); onEvent?.(parsed); enqueue({ type: 'SET_THEME', theme: theme.scheme }); flushQueue(); }
      if (parsed.type === 'FOCUSED') { setFocused(true); onEvent?.(parsed); }
      if (parsed.type === 'BLURRED') { setFocused(false); onEvent?.(parsed); }
      if (parsed.type === 'DOCUMENT_LOADED') { const identity = identityRef.current; if (!identity || identity.noteId !== parsed.noteId || identity.loadRequestId !== parsed.requestId) return; setDirty(false); onEvent?.(parsed); }
      if (parsed.type === 'DIRTY_STATE_CHANGED') { const identity = identityRef.current; if (identity?.noteId === parsed.noteId) { setDirty(parsed.dirty); onEvent?.(parsed); } }
      if (parsed.type === 'SELECTION_STATE_CHANGED') { const identity = identityRef.current; if (identity?.noteId === parsed.noteId) { setSelection(parsed.selection); onEvent?.(parsed); } }
      if (parsed.type === 'DOCUMENT_EXPORTED') { const identity = identityRef.current; const generation = pendingExportsRef.current.get(parsed.requestId); if (!identity || generation === undefined || generation !== identity.generation || identity.noteId !== parsed.noteId) return; pendingExportsRef.current.delete(parsed.requestId); onEvent?.(parsed); }
      if (parsed.type === 'SELECTION_RESULT') { const identity = identityRef.current; const generation = pendingSelectionsRef.current.get(parsed.requestId); if (!identity || generation === undefined || generation !== identity.generation || identity.noteId !== parsed.noteId) return; pendingSelectionsRef.current.delete(parsed.requestId); onEvent?.(parsed); }
      if (parsed.type === 'ERROR') { setError(parsed.message); onEvent?.(parsed); }
    } catch { setError('The embedded editor sent an invalid message.'); }
  };

  const onLoadStart = () => { readyRef.current = false; setReady(false); pendingExportsRef.current.clear(); pendingSelectionsRef.current.clear(); const identity = identityRef.current; if (identity) { generationRef.current += 1; identityRef.current = { ...identity, generation: generationRef.current }; } if (activeDocumentRef.current) queueRef.current = [{ type: 'SET_READ_ONLY', value: true }, activeDocumentRef.current]; };
  const command = (next: NativeEditorCommand) => { enqueue(next); setTimeout(() => enqueue({ type: 'FOCUS_EDITOR' }), 0); };
  const openExternalLink = (value: string) => { if (!/^https?:\/\/[^\s]+$/i.test(value)) { Alert.alert('Unsupported link', 'This link cannot be opened from Ledger.'); return; } void Linking.openURL(value).catch(() => Alert.alert('Could not open link', 'Try again from the note.')); };
  const openLinkSheet = () => { setLinkUrl(selection.linkUrl ?? ''); setLinkSheetOpen(true); };
  const submitLink = () => { const normalized = linkUrl.trim(); if (!/^https?:\/\/[^\s]+$/i.test(normalized)) { Alert.alert('Enter a valid link', 'Use a full http:// or https:// URL.'); return; } setLinkSheetOpen(false); command({ type: 'INSERT_LINK', url: normalized }); };
  const uploadNativeFile = async (uri: string, name: string, mimeType: string, folder: 'images' | 'attachments') => {
    const workspace = workspaceId?.trim(); const currentNoteId = propNoteId ?? identityRef.current?.noteId;
    if (!workspace || !currentNoteId) { Alert.alert('Upload unavailable', 'This note is not associated with a workspace.'); return null; }
    const client = getSupabaseClient();
    const safeName = name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 160) || 'upload';
    const path = `workspaces/${workspace}/notes/${currentNoteId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const response = await fetch(uri); const blob = await response.blob();
    const bucket = folder === 'images' ? 'note-images' : 'note-files';
    const result = await client.storage.from(bucket).upload(path, blob, { contentType: mimeType || 'application/octet-stream', cacheControl: '3600', upsert: false });
    if (result.error) throw result.error;
    const url = client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    return { url, path, sizeBytes: blob.size };
  };
  const pickImage = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { Alert.alert('Photo access needed', 'Allow Ledger to choose an image for this note.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
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
  const toolbarVisible = showToolbar && ready && focused && keyboardVisible;
  return <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {showStatus ? <View style={styles.status}><AppText variant="caption">{error ?? (ready ? focused ? 'Focused' : dirty ? 'Edited' : 'Ready' : 'Loading editor…')}</AppText>{!ready ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}</View> : null}
    <WebView ref={webViewRef} source={editorAsset} onMessage={onMessage} onLoadStart={onLoadStart} onError={() => { setError('The embedded editor was interrupted. Reloading…'); onEvent?.({ type: 'ERROR', message: 'The embedded editor was interrupted.' }); }} originWhitelist={['file://', 'about:blank']} javaScriptEnabled domStorageEnabled={false} allowFileAccess allowUniversalAccessFromFileURLs={false} scrollEnabled automaticallyAdjustContentInsets={false} keyboardDisplayRequiresUserAction={false} setBuiltInZoomControls={false} scalesPageToFit={false} style={styles.webview} onShouldStartLoadWithRequest={(request) => { if (/^https?:\/\//i.test(request.url)) { openExternalLink(request.url); return false; } return request.url.startsWith('file://') || request.url === 'about:blank'; }} />
    {toolbarVisible ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={[styles.toolbar, { borderTopColor: theme.colors.borderSubtle, backgroundColor: theme.colors.background }]} contentContainerStyle={styles.toolbarContent}><TestButton label="Undo" active={selection.canUndo} onPress={() => command({ type: 'UNDO' })} /><TestButton label="Redo" active={selection.canRedo} onPress={() => command({ type: 'REDO' })} /><TestButton label="Aa" active={selection.blockType !== 'paragraph'} onPress={() => setBlockSheetOpen(true)} /><TestButton label="B" active={selection.bold} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'bold' })} /><TestButton label="I" active={selection.italic} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'italic' })} /><TestButton label="U" active={selection.underline} onPress={() => command({ type: 'TOGGLE_FORMAT', format: 'underline' })} /><TestButton label="List" active={Boolean(selection.listType)} onPress={() => setListSheetOpen(true)} /><TestButton label="Link" active={Boolean(selection.linkUrl)} onPress={openLinkSheet} /><TestButton label="Ledger" onPress={() => { requestSelection(identityRef.current?.noteId); }} /><TestButton label="+" onPress={() => setInsertSheetOpen(true)} /></ScrollView> : null}
    <AppBottomSheet visible={blockSheetOpen} onClose={() => setBlockSheetOpen(false)} title={<AppText variant="sectionTitle">Text style</AppText>} snapPoints={['38%', '52%']} initialSnapPointIndex={0}>{[['paragraph', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']].map(([block, label]) => <SheetRow key={block} label={label} selected={selection.blockType === block} onPress={() => { setBlockSheetOpen(false); command({ type: 'SET_BLOCK_TYPE', block: block as 'paragraph' | 'h1' | 'h2' | 'h3' }); }} />)}</AppBottomSheet>
    <AppBottomSheet visible={listSheetOpen} onClose={() => setListSheetOpen(false)} title={<AppText variant="sectionTitle">List</AppText>} snapPoints={['38%', '52%']} initialSnapPointIndex={0}>{[['bullet', 'Bulleted list'], ['number', 'Numbered list'], ['check', 'Checklist']].map(([list, label]) => <SheetRow key={list} label={label} selected={selection.listType === list} onPress={() => { setListSheetOpen(false); command({ type: 'TOGGLE_LIST', list: list as 'bullet' | 'number' | 'check' }); }} />)}</AppBottomSheet>
    <AppBottomSheet visible={linkSheetOpen} onClose={() => setLinkSheetOpen(false)} title={<AppText variant="sectionTitle">{selection.linkUrl ? 'Edit link' : 'Add link'}</AppText>} snapPoints={['42%', '58%']} initialSnapPointIndex={0}><TextInput autoFocus value={linkUrl} onChangeText={setLinkUrl} placeholder="https://" autoCapitalize="none" keyboardType="url" style={[styles.linkInput, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.borderSubtle }]} /><View style={styles.sheetActions}><Pressable onPress={submitLink}><AppText variant="caption" style={{ color: theme.colors.accent }}>Save link</AppText></Pressable>{selection.linkUrl ? <><Pressable onPress={() => openExternalLink(selection.linkUrl!)}><AppText variant="caption">Open link</AppText></Pressable><Pressable onPress={() => { setLinkSheetOpen(false); command({ type: 'REMOVE_LINK' }); }}><AppText variant="caption" style={{ color: theme.colors.danger }}>Remove</AppText></Pressable></> : null}</View></AppBottomSheet>
    <AppBottomSheet visible={insertSheetOpen} onClose={() => setInsertSheetOpen(false)} title={<AppText variant="sectionTitle">Insert</AppText>} snapPoints={['46%', '62%']} initialSnapPointIndex={0}><SheetRow label="Callout" onPress={() => { setInsertSheetOpen(false); setCalloutSheetOpen(true); }} /><SheetRow label="Divider" onPress={() => { setInsertSheetOpen(false); command({ type: 'INSERT_DIVIDER' }); }} /><SheetRow label={uploading ? 'Uploading…' : 'Image'} onPress={() => { setInsertSheetOpen(false); void pickImage(); }} /><SheetRow label={uploading ? 'Uploading…' : 'Attachment'} onPress={() => { setInsertSheetOpen(false); void pickAttachment(); }} /><SheetRow label="Ledger link" onPress={() => Alert.alert('Ledger link', 'Choose Ledger context from the selected-text actions.')} /></AppBottomSheet>
    <AppBottomSheet visible={calloutSheetOpen} onClose={() => setCalloutSheetOpen(false)} title={<AppText variant="sectionTitle">Callout</AppText>} snapPoints={['46%', '62%']} initialSnapPointIndex={0}>{[['info', 'Info'], ['note', 'Note'], ['warning', 'Warning'], ['success', 'Success']].map(([variant, label]) => <SheetRow key={variant} label={label} onPress={() => { setCalloutSheetOpen(false); command({ type: 'INSERT_CALLOUT', variant: variant as 'info' | 'note' | 'warning' | 'success' }); }} />)}</AppBottomSheet>
  </KeyboardAvoidingView>;
});

function TestButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(active) }} onPress={onPress} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.55 : 1, backgroundColor: active ? theme.colors.surfaceSelected : 'transparent' }]}><AppText variant="caption">{label}</AppText></Pressable>; }
function SheetRow({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} style={[styles.sheetRow, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="body">{label}</AppText>{selected ? <AppText variant="caption" style={{ color: theme.colors.accent }}>✓</AppText> : <AppText variant="caption">›</AppText>}</Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1 }, toolbar: { maxHeight: 54, borderTopWidth: StyleSheet.hairlineWidth }, toolbarContent: { alignItems: 'center', paddingHorizontal: 10, gap: 2 }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, status: { minHeight: 28, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, webview: { flex: 1, backgroundColor: 'transparent' }, sheetRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, linkInput: { minHeight: 46, borderBottomWidth: 1, fontSize: 16 }, sheetActions: { flexDirection: 'row', gap: 20, paddingVertical: 16, flexWrap: 'wrap' } });
