import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sharedMessages = read('packages/mobile-editor-bridge/messages.ts');
const sharedValidation = read('packages/mobile-editor-bridge/validation.ts');
const native = read('apps/mobile/src/features/dev/MobileLexicalEditor.tsx');
const editor = read('apps/mobile-editor/src/main.tsx');
const calloutNode = read('apps/mobile-editor/src/LedgerCalloutNode.ts');

const assert = (condition, message) => {
  if (!condition) throw new Error(`Editor bridge regression: ${message}`);
};

assert(sharedMessages.includes("type: 'LOAD_DOCUMENT'; noteId: string; requestId: string; generation: number"), 'LOAD_DOCUMENT must carry generation');
assert(sharedMessages.includes("type: 'REQUEST_EXPORT'; noteId: string; requestId: string; generation: number"), 'REQUEST_EXPORT must carry generation');
assert(sharedMessages.includes("type: 'DOCUMENT_EXPORTED'; noteId: string; requestId: string; generation: number"), 'DOCUMENT_EXPORTED must carry generation');
assert(sharedMessages.includes("type: 'EDITOR_ERROR'"), 'editor failures must use EDITOR_ERROR');
assert(sharedValidation.includes('isGeneration(value.generation)'), 'incoming generation must be validated');
assert(native.includes('parsed.generation !== generationRef.current'), 'native must reject stale generations');
assert(native.includes('pending.noteId !== parsed.noteId'), 'native must reject stale export note IDs');
assert(native.includes('pendingExportsRef.current.clear()'), 'note switches/reloads must clear pending exports');
assert(editor.includes("{ tag: HYDRATION_TAG }"), 'hydration must use the dedicated Lexical tag');
assert(editor.includes('!editorWindow.__ledgerDirtyReported'), 'dirty notifications must be edge-triggered');
assert(editor.includes("post('DOCUMENT_EXPORTED', { noteId: command.noteId, requestId: command.requestId, generation: command.generation"), 'exports must include identity');
assert(editor.includes("editor.dispatchCommand(FORMAT_COMMAND, command.format)"), 'all text formats must use the registered Lexical format command');
assert(editor.includes("if (command.type === 'TOGGLE_LIST') {\n          editor.focus();"), 'list commands must restore editor focus before dispatch');
assert(editor.includes("from '@lexical/react/LexicalListPlugin'"), 'list commands must register Lexical list behavior');
assert(editor.includes("from '@lexical/react/LexicalCheckListPlugin'"), 'checklist commands must register Lexical checklist behavior');
assert(editor.includes('<ListPlugin />') && editor.includes('<CheckListPlugin />'), 'list plugins must be mounted in the editor');
assert(sharedMessages.includes("type: 'CAPTURE_SELECTION'"), 'insert sheets must be able to capture the Lexical range');
assert(sharedValidation.includes("value.type === 'CAPTURE_SELECTION'"), 'selection capture command must be validated');
assert(native.includes("const captureSelection = () => enqueue({ type: 'CAPTURE_SELECTION' })"), 'native insert actions must snapshot selection before opening sheets');
assert(editor.includes('savedSelectionRef'), 'editor must retain a Lexical selection while native sheets are open');
assert(editor.includes('const insertNodes = (createNodes: () => LexicalNode[]'), 'block inserts must use one Lexical insertion helper');
assert(editor.includes('if (saved) $setSelection(saved.clone())'), 'inserts must restore the saved range inside the Lexical update');
assert(editor.includes('selection.insertNodes(nodes)'), 'callouts and blocks must insert through the active Lexical selection');
assert(editor.includes('else $getRoot().append(...nodes)'), 'block inserts must have a root insertion fallback');
assert(calloutNode.includes("data-ledger-callout', 'true'"), 'callouts must use the canonical desktop HTML marker');
assert(editor.includes("editor.update(() => {\n        // DOM conversion creates Lexical nodes"), 'HTML import must run inside an active Lexical update');
assert(native.includes("source={{ html: MOBILE_EDITOR_HTML"), 'editor must stay local and inline');
assert(!native.includes("source={{ uri:"), 'editor must not use a remote WebView URL');

console.log('Mobile editor bridge checks passed.');
