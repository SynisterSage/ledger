import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..', '..');
const editor = readFileSync(resolve(root, 'apps/mobile/src/features/notes/MobileTextNoteEditor.tsx'), 'utf8');
const drafts = readFileSync(resolve(root, 'apps/mobile/src/features/notes/mobileNoteDrafts.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(`Note save lifecycle regression: ${message}`);
};

assert(editor.includes('localRevisionRef'), 'save revisions must be monotonic');
assert(editor.includes('editorReady && lexicalLoadedRef.current'), 'saving must wait for editor hydration');
assert(editor.includes('setTimeout(() => { startSave(); }, 1200)'), 'the existing 1.2-second debounce must remain');
assert(editor.includes('pending.requestId !== event.requestId'), 'exports must be tied to their request');
assert(editor.includes('confirmedRevision === localRevisionRef.current'), 'older saves must not clear newer edits');
assert(editor.includes('persistDraft({ title: titleSnapshot, body: plainSnapshot, contentHtml: htmlSnapshot'), 'failed saves must persist exported drafts');
assert(editor.includes('if (dirtyRef.current) persistDraft'), 'background/unmount paths must preserve dirty drafts');
assert(editor.includes('permissions.canEdit'), 'permission checks must guard saves');
assert(drafts.includes('ledger-mobile-note-draft:${workspaceId}:${noteId}'), 'draft key must remain workspace-and-note scoped');
assert(drafts.includes('localRevision: number'), 'drafts must carry their local revision');

console.log('Mobile note save lifecycle checks passed.');
