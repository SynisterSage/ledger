import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const notesSource = fs.readFileSync(
  new URL('../../src/components/Notes/NotesWindow.tsx', import.meta.url),
  'utf8'
);

test('transcription failure toast is mounted only in the Notes module window', () => {
  assert.match(
    appSource,
    /user && isModuleWindow && moduleKind === 'notes' \? <TranscriptionFailureToast \/> : null/
  );
  assert.doesNotMatch(appSource, /user && !isModuleWindow \? <TranscriptionFailureToast/);
});

test('Notes routes local transcription failures to the central renderer', () => {
  assert.match(notesSource, /ledger:transcription-failure/);
  assert.doesNotMatch(notesSource, /toast\.show\('Transcription failed'/);
});
