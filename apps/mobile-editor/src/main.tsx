import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode, REMOVE_LIST_COMMAND } from '@lexical/list';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection, $insertNodes, $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND, CAN_UNDO_COMMAND, CAN_REDO_COMMAND, COMMAND_PRIORITY_EDITOR, createCommand, type EditorState, type LexicalEditor, type LexicalNode } from 'lexical';
import type { NativeEditorCommand } from '../../../packages/mobile-editor-bridge/messages';
import { HYDRATION_TAG } from '../../../packages/mobile-editor-bridge/constants';
import { parseNativeEditorCommand } from '../../../packages/mobile-editor-bridge/validation';
import { LedgerPreservationNode } from './LedgerPreservationNode';
import { $createLedgerCalloutNode, LedgerCalloutNode, type LedgerCalloutVariant } from './LedgerCalloutNode';
import { $createLedgerDividerNode, LedgerDividerNode } from './LedgerDividerNode';
import { $createLedgerPreservationNode } from './LedgerPreservationNode';
import './styles.css';

const FORMAT_COMMAND = createCommand<'bold' | 'italic'>('LEDGER_FORMAT');
const initialConfig = {
  namespace: 'LedgerMobileEditor',
  theme: { heading: { h1: 'editor-heading editor-heading--h1', h2: 'editor-heading editor-heading--h2', h3: 'editor-heading editor-heading--h3' }, paragraph: 'editor-paragraph', list: { nested: { listitem: 'editor-list-nested' } }, callout: { info: 'editor-callout editor-callout--info', note: 'editor-callout editor-callout--note', warning: 'editor-callout editor-callout--warning', success: 'editor-callout editor-callout--success' } },
  nodes: [HeadingNode, ListNode, ListItemNode, LinkNode, LedgerPreservationNode, LedgerCalloutNode, LedgerDividerNode],
  onError(error: Error) { post('ERROR', { message: error.message }); console.error(error); },
};

function post(type: string, payload: Record<string, unknown> = {}) { window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload })); }

function selectionState(editor: LexicalEditor, canUndo: boolean, canRedo: boolean) {
  let result = { bold: false, italic: false, underline: false, blockType: 'paragraph' as 'paragraph' | 'h1' | 'h2' | 'h3', listType: undefined as 'bullet' | 'number' | 'check' | undefined, linkUrl: undefined as string | undefined, canUndo, canRedo };
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    result.bold = selection.hasFormat('bold'); result.italic = selection.hasFormat('italic'); result.underline = selection.hasFormat('underline');
    let node: LexicalNode | null = selection.anchor.getNode();
    while (node?.getParent() && node.getParent()?.getType() !== 'root') node = node.getParent();
    if (node instanceof HeadingNode) result.blockType = node.getTag() as 'h1' | 'h2' | 'h3';
    let listCursor: LexicalNode | null = selection.anchor.getNode();
    while (listCursor) { if (listCursor instanceof ListItemNode && listCursor.getParent() instanceof ListNode) { const type = (listCursor.getParent() as ListNode).getListType(); result.listType = type === 'bullet' ? 'bullet' : type === 'number' ? 'number' : 'check'; break; } listCursor = listCursor.getParent(); }
    let linkCursor: LexicalNode | null = selection.anchor.getNode();
    while (linkCursor) { if (linkCursor instanceof LinkNode) { result.linkUrl = linkCursor.getURL(); break; } linkCursor = linkCursor.getParent(); }
  });
  return result;
}

function InitialContentPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot();
      if (root.getChildrenSize() === 0) {
        const heading = $createHeadingNode('h1'); heading.append($createTextNode('Ledger Mobile Editor'));
        const first = $createParagraphNode(); first.append($createTextNode('This is a locally bundled Lexical editor.'));
        const second = $createParagraphNode(); second.append($createTextNode('Load a Ledger HTML fixture to test compatibility.'));
        root.append(heading, first, second);
      }
    });
    post('READY');
  }, [editor]);
  return null;
}

function BridgePlugin() {
  const [editor] = useLexicalComposerContext();
  const activeNoteIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const readOnlyRef = useRef(false);
  const canUndoRef = useRef(false);
  const canRedoRef = useRef(false);
  const lastSelectionRef = useRef('');
  const hydrate = (command: Extract<NativeEditorCommand, { type: 'LOAD_DOCUMENT' }>) => {
    activeNoteIdRef.current = command.noteId;
    (window as Window & { __ledgerNoteId?: string }).__ledgerNoteId = command.noteId;
    hydratedRef.current = false;
    lastSelectionRef.current = '';
    readOnlyRef.current = Boolean(command.readOnly);
    editor.setEditable(false);
    try {
      const document = new DOMParser().parseFromString(command.html, 'text/html');
      const nodes = $generateNodesFromDOM(editor, document);
      editor.update(() => {
        const root = $getRoot(); root.clear();
        if (nodes.length) root.append(...nodes);
        else root.append($createParagraphNode());
      }, { tag: HYDRATION_TAG });
      hydratedRef.current = true;
      editor.setEditable(!command.readOnly);
      const nextSelection = selectionState(editor, canUndoRef.current, canRedoRef.current);
      lastSelectionRef.current = JSON.stringify(nextSelection);
      post('SELECTION_STATE_CHANGED', { noteId: command.noteId, selection: nextSelection });
      post('DOCUMENT_LOADED', { noteId: command.noteId, requestId: command.requestId });
    } catch (error) {
      post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: error instanceof Error ? error.message : 'Could not load document.' });
    }
  };
  useEffect(() => {
    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as unknown;
        const command = parseNativeEditorCommand(parsed);
        if (!command) { post('ERROR', { message: 'Invalid editor command.' }); return; }
        if (command.type === 'LOAD_DOCUMENT') { hydrate(command); return; }
        if (command.type === 'REQUEST_EXPORT') {
          if (!hydratedRef.current || activeNoteIdRef.current !== command.noteId) { post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: 'Export requested for an inactive document.' }); return; }
          try {
            let html = ''; let plainText = '';
            editor.getEditorState().read(() => { html = $generateHtmlFromNodes(editor); plainText = $getRoot().getTextContent(); });
            post('DOCUMENT_EXPORTED', { noteId: command.noteId, requestId: command.requestId, html, plainText });
          } catch (error) { post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: error instanceof Error ? error.message : 'Could not export document.' }); }
          return;
        }
        if (command.type === 'REQUEST_SELECTION') {
          if (!hydratedRef.current || activeNoteIdRef.current !== command.noteId) { post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: 'Selection requested for an inactive document.' }); return; }
          try {
            let plainText = ''; let html: string | undefined;
            editor.getEditorState().read(() => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
              plainText = selection.getTextContent();
              html = $generateHtmlFromNodes(editor, selection);
            });
            if (!plainText.trim()) { post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: 'Select some note text first.' }); return; }
            post('SELECTION_RESULT', { noteId: command.noteId, requestId: command.requestId, plainText, html });
          } catch (error) { post('ERROR', { noteId: command.noteId, requestId: command.requestId, message: error instanceof Error ? error.message : 'Could not read selection.' }); }
          return;
        }
        if (command.type === 'SET_READ_ONLY') { readOnlyRef.current = command.value; editor.setEditable(!command.value); return; }
        if (command.type === 'SET_THEME') { document.documentElement.dataset.theme = command.theme; return; }
        if (command.type === 'FOCUS_EDITOR') { editor.focus(); return; }
        if (command.type === 'TOGGLE_FORMAT') { editor.dispatchCommand(FORMAT_COMMAND, command.format); return; }
        if (command.type === 'SET_BLOCK_TYPE') { editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $setBlocksType(selection, () => command.block === 'paragraph' ? $createParagraphNode() : $createHeadingNode(command.block)); }); return; }
        if (command.type === 'TOGGLE_LIST') { const current = selectionState(editor, canUndoRef.current, canRedoRef.current).listType; if (current === command.list) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined); else if (command.list === 'bullet') editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined); else if (command.list === 'number') editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined); else editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined); return; }
        if (command.type === 'INSERT_LINK') { editor.dispatchCommand(TOGGLE_LINK_COMMAND, command.url); return; }
        if (command.type === 'REMOVE_LINK') { editor.dispatchCommand(TOGGLE_LINK_COMMAND, null); return; }
        if (command.type === 'INSERT_CALLOUT') { editor.update(() => { const callout = $createLedgerCalloutNode(command.variant); const paragraph = $createParagraphNode(); callout.append(paragraph); $insertNodes([callout]); paragraph.select(); }); return; }
        if (command.type === 'INSERT_DIVIDER') { editor.update(() => $insertNodes([$createLedgerDividerNode()])); return; }
        if (command.type === 'INSERT_IMAGE') { editor.update(() => $insertNodes([$createLedgerPreservationNode(`<figure data-ledger-kind="image"><img src="${command.src.replace(/"/g, '&quot;')}"${command.altText ? ` alt="${command.altText.replace(/"/g, '&quot;')}"` : ''}${command.width ? ` width="${command.width}"` : ''}${command.height ? ` height="${command.height}"` : ''}></figure>`, 'figure')])); return; }
        if (command.type === 'INSERT_ATTACHMENT') { editor.update(() => $insertNodes([$createLedgerPreservationNode(`<div data-ledger-file-attachment="true"${command.attachmentId ? ` data-ledger-file-attachment-id="${command.attachmentId}"` : ''}${command.mimeType ? ` data-mime-type="${command.mimeType.replace(/"/g, '&quot;')}"` : ''}${command.sizeBytes ? ` data-size-bytes="${command.sizeBytes}"` : ''}${command.url ? ` data-url="${command.url.replace(/"/g, '&quot;')}"` : ''}><a href="${(command.url ?? '').replace(/"/g, '&quot;')}">${command.name.replace(/</g, '&lt;')}</a></div>`, 'div')])); return; }
        if (command.type === 'UNDO') { editor.dispatchCommand(UNDO_COMMAND, undefined); return; }
        if (command.type === 'REDO') { editor.dispatchCommand(REDO_COMMAND, undefined); return; }
      } catch { post('ERROR', { message: 'Invalid editor command.' }); }
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('message', onMessage as EventListener);
    return () => { window.removeEventListener('message', onMessage); document.removeEventListener('message', onMessage as EventListener); };
  }, [editor]);
  useEffect(() => {
    const emitSelection = () => { if (!hydratedRef.current || !activeNoteIdRef.current) return; const next = selectionState(editor, canUndoRef.current, canRedoRef.current); const serialized = JSON.stringify(next); if (serialized === lastSelectionRef.current) return; lastSelectionRef.current = serialized; post('SELECTION_STATE_CHANGED', { noteId: activeNoteIdRef.current, selection: next }); };
    const unregisterUpdate = editor.registerUpdateListener(emitSelection);
    const unregisterUndo = editor.registerCommand(CAN_UNDO_COMMAND, (value) => { canUndoRef.current = value; emitSelection(); return false; }, COMMAND_PRIORITY_EDITOR);
    const unregisterRedo = editor.registerCommand(CAN_REDO_COMMAND, (value) => { canRedoRef.current = value; emitSelection(); return false; }, COMMAND_PRIORITY_EDITOR);
    const unregisterFormat = editor.registerCommand(FORMAT_COMMAND, (format) => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, format); return true; }, COMMAND_PRIORITY_EDITOR);
    return () => { unregisterUpdate(); unregisterUndo(); unregisterRedo(); unregisterFormat(); };
  }, [editor]);
  return null;
}

function FocusPlugin() {
  const [editor] = useLexicalComposerContext();
  const [readOnly, setReadOnly] = useState(true);
  useEffect(() => { editor.setEditable(false); const unregister = editor.registerEditableListener((editable) => setReadOnly(!editable)); return unregister; }, [editor]);
  return <ContentEditable className="editor-content" aria-label="Ledger mobile editor" contentEditable={!readOnly} onFocus={() => post('FOCUSED')} onBlur={() => post('BLURRED')} />;
}

function Editor() {
  const onChange = (_editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => {
    if (tags.has(HYDRATION_TAG)) return;
    const noteId = (window as Window & { __ledgerNoteId?: string }).__ledgerNoteId;
    if (noteId) post('DIRTY_STATE_CHANGED', { noteId, dirty: true });
    void editor;
  };
  return <LexicalComposer initialConfig={initialConfig}><div className="editor-shell"><RichTextPlugin contentEditable={<FocusPlugin />} placeholder={<div className="editor-placeholder">Start writing…</div>} ErrorBoundary={({ children }) => <>{children}</>} /><HistoryPlugin /><OnChangePlugin onChange={onChange} ignoreSelectionChange /><InitialContentPlugin /><BridgePlugin /></div></LexicalComposer>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Editor /></React.StrictMode>);
