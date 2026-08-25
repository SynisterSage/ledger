import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');
const styles = fs.readFileSync('src/index.css', 'utf8');

test('meeting dock has stable lifecycle surfaces for recording, processing, and completion', () => {
  assert.match(notesWindow, /data-meeting-floating-controls/);
  assert.match(notesWindow, /Processing…/);
  assert.match(notesWindow, /'Start'/);
  assert.match(notesWindow, /'Enhance'/);
  assert.match(notesWindow, /'Enhance'/);
  assert.match(notesWindow, /'Transcript'/);
  assert.match(notesWindow, /ledger-meeting-dock-row/);
});

test('meeting surfaces use restrained motion and responsive center-pane sizing', () => {
  assert.match(notesWindow, /ledger-meeting-live-transcript/);
  assert.match(notesWindow, /ledger-meeting-ask-form/);
  assert.match(notesWindow, /pb-24 pt-0 sm:px-10 sm:pb-28/);
  assert.match(styles, /@keyframes ledger-meeting-transcript-in/);
  assert.match(styles, /\[data-reduce-motion='true'\] \.ledger-meeting-live-transcript/);
  assert.match(styles, /@container \(max-width: 620px\)/);
});

test('meeting metadata is compact and token-based rather than pill/card chrome', () => {
  assert.match(notesWindow, /data-meeting-metadata/);
  assert.match(notesWindow, /gap-x-2 gap-y-1 text-\[11px\]/);
  assert.doesNotMatch(notesWindow, /data-meeting-metadata[\s\S]{0,1200}rounded-lg border border-\[color:var\(--ledger-border-subtle\)\] bg-\[var\(--ledger-surface-card\)\]/);
});

test('normal notes remain on the shared editor and outside meeting-only dock branches', () => {
  assert.match(notesWindow, /const isMeetingNote = selectedNote\?\.mode === 'meeting_note'/);
  assert.match(notesWindow, /isMeetingNote &&[\s\S]*data-meeting-floating-controls/);
  assert.match(notesWindow, /<RichTextEditor[\s\S]*showToolbar/);
});
