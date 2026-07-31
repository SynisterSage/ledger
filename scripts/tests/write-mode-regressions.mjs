import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const editor = await readFile('src/components/Notes/RichTextEditor.tsx', 'utf8');
const notesWindow = await readFile('src/components/Notes/NotesWindow.tsx', 'utf8');
const selectedContent = await readFile(
  'src/components/Notes/editor/types/selectedContent.ts',
  'utf8'
);
const blockPlugin = await readFile(
  'src/components/Notes/editor/plugins/BlockInsertionPlugin.tsx',
  'utf8'
);
const slashPlugin = await readFile(
  'src/components/Notes/editor/plugins/SlashCommandPlugin.tsx',
  'utf8'
);
const blockHandlePlugin = await readFile(
  'src/components/Notes/editor/plugins/BlockHandlePlugin.tsx',
  'utf8'
);
const selectionFormattingPlugin = await readFile(
  'src/components/Notes/editor/plugins/SelectionFormattingPlugin.tsx',
  'utf8'
);
const writeActionTypes = await readFile('src/components/Notes/editor/types/writeAction.ts', 'utf8');
const htmlUtils = await readFile('src/components/Notes/editor/utils/html.ts', 'utf8');
const indexCss = await readFile('src/index.css', 'utf8');
const smartDateNode = await readFile('src/components/Notes/nodes/SmartDateNode.tsx', 'utf8');
const smartPersonNode = await readFile('src/components/Notes/nodes/SmartPersonNode.tsx', 'utf8');
const calloutNode = await readFile('src/components/Notes/editor/nodes/CalloutNode.ts', 'utf8');
const richText = editor;

test('editor loading is keyed and clears queued changes when switching notes', () => {
  assert.match(editor, /LoadHtmlPlugin html=\{initialValue\} editorKey=\{editorKey\}/);
  assert.match(editor, /useEffect\(\(\) => \{[\s\S]*?pendingHtmlRef\.current = null;/);
  assert.match(editor, /\}, \[editorKey\]\);/);
});

test('programmatic smart-entity updates stay out of the normal save path', () => {
  assert.match(editor, /smart-date-load/);
  assert.match(editor, /smart-date-scan/);
  assert.match(editor, /smart-person-sync/);
  assert.match(editor, /link-scan/);
});

test('selected Ledger actions cross the editor boundary as serializable payloads', () => {
  assert.match(writeActionTypes, /noteId: string/);
  assert.match(writeActionTypes, /plainText: string/);
  assert.match(writeActionTypes, /html\?: string/);
  assert.match(writeActionTypes, /blockKey\?: string/);
  assert.match(writeActionTypes, /source: 'selection' \| 'block'/);
  assert.match(editor, /getSelectedContentPayload\(noteId, \$getSelection\(\)\)/);
  assert.doesNotMatch(editor, /onCreateTask\?\.\(selectedText\)/);
});

test('editor plugins do not own external-reference API mutations', () => {
  assert.doesNotMatch(editor, /useApi/);
  assert.match(editor, /onCreateExternalEmbed/);
  assert.match(notesWindow, /createEditorExternalEmbed/);
});

test('autosave remains guarded by hydration and selected-note identity', () => {
  assert.match(
    notesWindow,
    /if \(selectedNoteIdRef\.current !== saveNoteId \|\| hydrationNoteIdRef\.current !== saveNoteId\)/
  );
  assert.match(
    notesWindow,
    /if \(isHydratingNote \|\| !hasHydratedNote \|\| !hasUserEdited\) return;/
  );
  assert.match(notesWindow, /\}, 1200\);/);
  assert.match(notesWindow, /mode: draftMode/);
  assert.match(notesWindow, /mind_map_structure: draftMindMapStructure/);
});

test('meeting Write content keeps smart scanners disabled', () => {
  assert.match(editor, /targetType !== 'meetingNote'/);
  assert.match(editor, /<SmartDatePlugin/);
  assert.match(editor, /<SmartPersonPlugin/);
});

test('Phase 2 blocks are registered without changing the HTML persistence boundary', () => {
  for (const node of [
    'CalloutNode',
    'ToggleNode',
    'FileAttachmentNode',
    'TableNode',
    'TableCellNode',
    'TableRowNode',
  ]) {
    assert.match(richText, new RegExp(node));
  }
  for (const command of [
    'INSERT_CHECK_LIST_COMMAND',
    'INSERT_TABLE_COMMAND',
    'INSERT_HORIZONTAL_RULE_COMMAND',
    'INSERT_TOGGLE_COMMAND',
    'INSERT_CALLOUT_COMMAND',
  ]) {
    assert.match(blockPlugin + richText, new RegExp(command));
  }
  assert.match(richText, /\$generateHtmlFromNodes/);
  assert.match(richText, /onUploadAttachment/);
});

test('attachment storage work crosses through NotesWindow', () => {
  assert.doesNotMatch(richText, /note-files/);
  assert.match(notesWindow, /supabase\.storage\.from\('note-files'\)/);
  assert.match(notesWindow, /uploadEditorAttachment/);
});

test('Phase 3 insertion and block movement stay inside the editor layer', () => {
  const slash = slashPlugin;
  const handles = blockHandlePlugin;
  assert.match(slash, /KEY_DOWN_COMMAND/);
  assert.match(slash, /No matching commands/);
  assert.match(slash, /INSERT_FILE_ATTACHMENT_COMMAND/);
  assert.match(handles, /DRAGSTART_COMMAND/);
  assert.match(handles, /application\/x-ledger-block/);
  assert.doesNotMatch(slash, /supabase|fetch\(|api\./);
  assert.doesNotMatch(handles, /supabase|fetch\(|api\./);
});

test('Phase 4 formatting stays contextual and Lexical-owned', () => {
  assert.match(editor, /<SelectionFormattingPlugin[\s\S]*?onCreateTask/);
  assert.match(selectionFormattingPlugin, /SELECTION_CHANGE_COMMAND/);
  assert.match(selectionFormattingPlugin, /TOGGLE_LINK_COMMAND/);
  assert.match(selectionFormattingPlugin, /background-color/);
  assert.match(selectionFormattingPlugin, /selection\.setFormat\(0\)/);
  assert.doesNotMatch(selectionFormattingPlugin, /supabase|fetch\(|api\./);
});

test('Phase 5 Ledger actions use one serializable selection/block payload', () => {
  assert.match(writeActionTypes, /type WriteActionPayload/);
  assert.match(writeActionTypes, /source: 'selection' \| 'block'/);
  assert.match(selectionFormattingPlugin, /Create task/);
  assert.match(selectionFormattingPlugin, /source: 'selection'/);
  assert.match(blockHandlePlugin, /Create task/);
  assert.match(blockHandlePlugin, /source: 'block'/);
  assert.doesNotMatch(selectionFormattingPlugin, /supabase|fetch\(|api\./);
  assert.doesNotMatch(blockHandlePlugin, /supabase|fetch\(|api\./);
});

test('Phase 7 load path sanitizes unsafe HTML without changing saved HTML', () => {
  assert.match(htmlUtils, /sanitizeEditorHtml/);
  assert.match(htmlUtils, /script, style, iframe, object, embed/);
  assert.match(htmlUtils, /startsWith\('on'\)/);
  assert.match(editor, /sanitizeEditorHtml\(initialHtml\)/);
  assert.match(editor, /onChange: \(html: string\)/);
});

test('Phase 7 semantic nodes validate imported state and preserve stable identity', () => {
  assert.match(smartDateNode, /isSmartDateState/);
  assert.match(smartPersonNode, /isSmartPersonState/);
  assert.doesNotMatch(smartPersonNode, /removeAttribute\('data-ledger-smart-person-user-id'\)/);
});

test('Phase 7 meeting boundaries and stale-save guards remain explicit', () => {
  assert.match(editor, /targetType !== 'meetingNote'/);
  assert.match(notesWindow, /hydrationNoteIdRef\.current !== saveNoteId/);
  assert.match(notesWindow, /selectedNoteIdRef\.current !== selectedNote\.id/);
  assert.match(notesWindow, /source: 'workspace'/);
});

test('Phase 8 menus and special blocks expose keyboard semantics', () => {
  assert.match(slashPlugin, /role="menu"/);
  assert.match(slashPlugin, /aria-activedescendant/);
  assert.match(blockHandlePlugin, /role="menu"/);
  assert.match(blockPlugin, /aria-expanded/);
  assert.match(blockPlugin, /tabindex/);
  assert.match(htmlUtils, /sanitizeEditorHtml/);
});

test('selection colors and highlights mutate selected text nodes, not only future typing state', () => {
  assert.match(selectionFormattingPlugin, /selection\.extract\(\)\.forEach/);
  assert.match(selectionFormattingPlugin, /node\.setStyle/);
  assert.match(selectionFormattingPlugin, /RangeSelection\.setStyle\(\) controls the style/);
});

test('checklists have explicit Ledger marker styling and semantic state classes', () => {
  assert.match(editor, /checklist: 'ledger-checklist'/);
  assert.match(editor, /listitemChecked: 'ledger-listitem-checked'/);
  assert.match(editor, /<CheckListPlugin \/>/);
  assert.match(indexCss, /ledger-checklist li::before/);
  assert.match(indexCss, /aria-checked='true'/);
});

test('toggle keyboard handling recognizes nested title blocks and supports exiting below', () => {
  assert.match(blockPlugin, /toggle-title-exit/);
  assert.match(blockPlugin, /event\?\.shiftKey/);
  assert.match(blockPlugin, /existingBody = title\.getNextSibling/);
  assert.match(blockPlugin, /toggle\.insertAfter\(paragraph\)/);
});

test('shift-enter exits a callout while enter still supports internal lines', () => {
  assert.match(blockPlugin, /'callout-shift-exit'/);
  assert.match(blockPlugin, /if \(event\?\.shiftKey\) action = 'callout-shift-exit'/);
  assert.match(blockPlugin, /action === 'callout-exit' \|\| action === 'callout-shift-exit'/);
});

test('editor toolbar menus are independent and dismiss on outside pointer input', () => {
  assert.match(editor, /isBlockTypeDropdownOpen/);
  assert.match(editor, /isMoreDropdownOpen/);
  assert.match(editor, /closeMenusOnOutsidePointer/);
  assert.match(editor, /setIsMoreDropdownOpen\(false\)/);
  assert.match(blockPlugin, /closeOnOutsidePointer/);
  assert.match(blockPlugin, /onMenuOpen/);
});

test('floating selection Ledger actions restore the Lexical selection before dispatch', () => {
  assert.match(selectionFormattingPlugin, /savedSelection\.current\?\.clone\(\)/);
  assert.match(selectionFormattingPlugin, /editor\.focus\(\)/);
  assert.match(selectionFormattingPlugin, /\$setSelection\(selection\.clone\(\)\)/);
  assert.match(selectionFormattingPlugin, /const activeSelection = \$getSelection\(\)/);
  assert.match(selectionFormattingPlugin, /activeSelection\.getTextContent\(\)/);
  assert.match(selectionFormattingPlugin, /source: 'selection'/);
});

test('tables have visible document styling instead of appearing as empty space', () => {
  assert.match(indexCss, /\.notes-rich-text-editor table/);
  assert.match(indexCss, /border-collapse: collapse/);
  assert.match(indexCss, /\.notes-rich-text-editor td,/);
});

test('callout type survives HTML round trips with a stable fallback marker', () => {
  assert.match(calloutNode, /data-ledger-callout-type/);
  assert.match(calloutNode, /ledger-callout--\$\{this\.getCalloutType\(\)\}/);
  assert.match(calloutNode, /classType/);
  assert.match(calloutNode, /data-callout-type/);
  assert.match(calloutNode, /data-callout-style/);
  assert.match(calloutNode, /calloutInlineStyle/);
  assert.match(calloutNode, /document\.createElement\('aside'\)/);
  assert.match(calloutNode, /aside: \(domNode\)/);
  assert.match(calloutNode, /setAttribute\('style', calloutInlineStyle/);
  assert.match(calloutNode, /domNode\.nodeType !== 1/);
  assert.doesNotMatch(calloutNode, /instanceof HTMLElement/);
  assert.match(notesWindow, /note\.content_html \?\? note\.content \?\? ''/);
  assert.match(notesWindow, /typeof note\.content_html !== 'string'/);
  assert.match(blockPlugin, /getUsableSelection\(\), \$isCalloutNode/);
  assert.match(blockPlugin, /restoreEditorSelection\(editor\)/);
});

test('code blocks have readable contrast and explicit token classes', () => {
  assert.match(editor, /code: 'ledger-code-block'/);
  assert.match(editor, /ledger-code-token-comment/);
  assert.match(indexCss, /pre\.ledger-code-block/);
  assert.match(indexCss, /font-family: ui-monospace/);
});

test('attachments expose removal and delayed orphan cleanup through NotesWindow', () => {
  assert.match(blockPlugin, /data-ledger-file-attachment-remove/);
  assert.match(blockPlugin, /immediateAttachmentRemovalsRef/);
  assert.match(blockPlugin, /onRemoveAttachment/);
  assert.match(notesWindow, /supabase\.storage\.from\('note-files'\)\.remove/);
  assert.match(notesWindow, /30_000/);
  assert.match(notesWindow, /draftContentRef\.current/);
});
