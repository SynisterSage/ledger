import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const sourceFiles = [
  'app/(tabs)/notes.tsx',
  'app/(tabs)/today.tsx',
  'app/capture/note.tsx',
  'app/note/[id].tsx',
  'app/project/[id].tsx',
  'src/features/capture/NoteForm.tsx',
  'src/features/calendar/CalendarSheets.tsx',
  'src/features/notes/MobileTextNoteEditor.tsx',
  'src/features/quicknote/QuickNoteSheet.tsx',
  'src/features/search/MobileSearchSheet.tsx',
];

const source = sourceFiles.map(read).join('\n');
const helper = read('src/features/notes/openMobileNote.ts');

assert.equal((source.match(/pathname:\s*['"]\/note\/\[id\]['"]/g) ?? []).length, 0, 'production callers must use openMobileNote');
assert.match(helper, /pathname:\s*['"]\/note\/\[id\]['"]/);
assert.match(helper, /if \(!id\) return false/);
assert.match(read('app/capture/note.tsx'), /onSave=\{\(noteId\) => openMobileNote/);
assert.match(read('src/features/capture/NoteForm.tsx'), /The new note did not return an id/);
assert.match(read('src/features/quicknote/QuickNoteSheet.tsx'), /openMobileNote\(router, noteId/);
assert.match(read('src/features/calendar/CalendarSheets.tsx'), /openMobileNote\(router, createdNoteId/);
assert.doesNotMatch(source, /WebBrowser\.openBrowserAsync|openBrowserAsync|editorUrl|window\.open/);
const editor = read('src/features/dev/MobileLexicalEditor.tsx');
assert.match(editor, /onLedgerLink/);
assert.match(editor, /isLedgerLink/);
assert.match(editor, /return request\.url === ['"]about:blank['"]/);
assert.match(editor, /Linking\.openURL/); // intentional external-link handling only
assert.doesNotMatch(read('src/features/notes/MobileTextNoteEditor.tsx'), /WebBrowser\.openBrowserAsync|openBrowserAsync|editorUrl|window\.open|Linking\.openURL/);

console.log('Mobile note routing checks passed.');
