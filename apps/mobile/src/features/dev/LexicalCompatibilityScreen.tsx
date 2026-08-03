import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { EditorNativeEvent } from '../../../../../packages/mobile-editor-bridge/messages';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { MobileLexicalEditor, type MobileLexicalEditorHandle } from './MobileLexicalEditor';

const fixtures = [
  { id: 'basic-formatting', title: 'Basic formatting', html: '<h1>Catalog review</h1><p><strong>Important</strong> printer feedback with <em>italic context</em> and <u>underline</u>.</p><hr><p>Keep this paragraph intact.</p>' },
  { id: 'lists-and-checklists', title: 'Lists and checklists', html: '<h2>Next actions</h2><ul><li>Review captions</li><li>Approve printer proof</li></ul><ol><li>Send files</li><li>Archive source</li></ol><ul data-type="check-list"><li data-checked="true">Confirm paper stock</li><li data-checked="false">Share final PDF</li></ul>' },
  { id: 'callouts', title: 'Callouts', html: '<aside data-ledger-callout="warning" data-ledger-color="#FDBA74"><strong>Callout</strong><p>Printer approval is still pending.</p></aside><p>Text after the callout.</p>' },
  { id: 'callouts-all', title: 'All callouts', html: '<aside data-ledger-callout="info"><p>Information callout.</p></aside><aside data-ledger-callout="note"><p>Note callout.</p></aside><aside data-ledger-callout="warning"><p>Warning callout.</p></aside><aside data-ledger-callout="success"><p>Success callout.</p></aside>' },
  { id: 'links', title: 'Links', html: '<p>Read the <a href="https://ledger.local/notes/catalog" data-ledger-reference="catalog-note">catalog note</a> before the review.</p>' },
  { id: 'images-and-attachments', title: 'Images and attachments', html: '<figure data-ledger-attachment-id="attachment-1" data-ledger-kind="image"><img src="https://example.invalid/catalog.png" alt="Catalog proof"><figcaption>Catalog proof</figcaption></figure><div data-ledger-attachment-id="file-1" data-ledger-kind="file">Printer proof.pdf</div>' },
  { id: 'mixed-ledger-note', title: 'Mixed Ledger note', html: '<h1>Mixed Ledger note</h1><p>Normal text.</p><aside data-ledger-callout="info"><p>Preserve this callout.</p></aside><ul><li>List item</li></ul><ul data-type="check-list"><li data-checked="false">Checklist item</li></ul><p><a href="https://ledger.local">Ledger link</a></p><hr><figure data-ledger-attachment-id="image-1"><img src="https://example.invalid/image.png" alt="Reference"></figure>' },
];

export function LexicalCompatibilityScreen() {
  const theme = useLedgerTheme();
  const editorRef = useRef<MobileLexicalEditorHandle>(null);
  const [selectedId, setSelectedId] = useState(fixtures[0].id);
  const [noteId, setNoteId] = useState('fixture-a');
  const [request, setRequest] = useState('');
  const [dirty, setDirty] = useState(false);
  const [exportedHtml, setExportedHtml] = useState('');
  const [plainText, setPlainText] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const selected = fixtures.find((fixture) => fixture.id === selectedId) ?? fixtures[0];
  const load = (nextNoteId = noteId, html = selected.html) => { const nextRequest = editorRef.current?.loadDocument({ noteId: nextNoteId, html }); setNoteId(nextNoteId); setRequest(nextRequest ?? ''); setExportedHtml(''); setPlainText(''); };
  useEffect(() => { load('fixture-a'); }, []);
  const onEvent = (event: EditorNativeEvent) => {
    setEvents((current) => [`${event.type}${'requestId' in event ? ` · ${event.requestId}` : ''}`, ...current].slice(0, 8));
    if (event.type === 'DIRTY_STATE_CHANGED') setDirty(event.dirty);
    if (event.type === 'DOCUMENT_LOADED') { setDirty(false); setRequest(event.requestId); }
    if (event.type === 'DOCUMENT_EXPORTED') { setExportedHtml(event.html); setPlainText(event.plainText); }
  };
  const exportDocument = () => { const next = editorRef.current?.requestExport(noteId); if (next) setRequest(next); };
  const rapidSwitch = () => { const first = fixtures[0]; const second = fixtures[5]; load('rapid-a', first.html); setTimeout(() => { load('rapid-b', second.html); setTimeout(() => { const next = editorRef.current?.requestExport('rapid-b'); if (next) setRequest(next); }, 80); }, 40); };
  return <View style={[styles.container, { backgroundColor: theme.colors.background }]}><View style={styles.controls}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlRow}>{fixtures.map((fixture) => <Pressable key={fixture.id} onPress={() => { setSelectedId(fixture.id); load(noteId, fixture.html); }} style={[styles.choice, { borderColor: theme.colors.borderSubtle, backgroundColor: fixture.id === selectedId ? theme.colors.surfaceSelected : theme.colors.surface }]}><AppText variant="caption">{fixture.title}</AppText></Pressable>)}<Pressable onPress={() => load()} style={styles.action}><AppText variant="caption">Load HTML</AppText></Pressable><Pressable onPress={exportDocument} style={styles.action}><AppText variant="caption">Export HTML</AppText></Pressable><Pressable onPress={rapidSwitch} style={styles.action}><AppText variant="caption">Rapid switch</AppText></Pressable></ScrollView><AppText variant="caption">Note: {noteId} · Request: {request || 'none'} · Dirty: {dirty ? 'yes' : 'no'}</AppText></View><View style={styles.editor}><MobileLexicalEditor ref={editorRef} showToolbar onEvent={onEvent} /></View><ScrollView style={styles.output} contentContainerStyle={styles.outputContent}><AppText variant="label">Exported HTML</AppText><AppText variant="caption" selectable>{exportedHtml || 'Export a document to inspect it.'}</AppText><AppText variant="label">Plain text</AppText><AppText variant="caption" selectable>{plainText || 'No export yet.'}</AppText><AppText variant="label">Bridge events</AppText><AppText variant="caption">{events.join('\n') || 'Waiting…'}</AppText></ScrollView></View>;
}

const styles = StyleSheet.create({ container: { flex: 1 }, controls: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 }, controlRow: { gap: 6, alignItems: 'center' }, choice: { minHeight: 38, paddingHorizontal: 9, justifyContent: 'center', borderWidth: 1, borderRadius: 8 }, action: { minHeight: 38, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8, backgroundColor: '#FF5F40' }, editor: { flex: 1, minHeight: 300 }, output: { maxHeight: 190, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' }, outputContent: { padding: 12, gap: 6 } });
