import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');
const styles = fs.readFileSync('src/index.css', 'utf8');
const linkedContextModal = fs.readFileSync('src/components/ExternalEmbeds/AddLinkedContextModal.tsx', 'utf8');

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
  assert.match(notesWindow, /data-meeting-transcript-drawer/);
  assert.match(notesWindow, /h-\[min\(52vh,640px\)\]/);
  assert.match(notesWindow, /transcriptDrawerScrollRef/);
  assert.match(notesWindow, /ledger-meeting-ask-form/);
  assert.match(notesWindow, /pb-24 pt-0 sm:px-10 sm:pb-28/);
  assert.match(styles, /@keyframes ledger-meeting-transcript-in/);
  assert.match(styles, /\[data-reduce-motion='true'\] \.ledger-meeting-live-transcript/);
  assert.match(styles, /@container \(max-width: 620px\)/);
});

test('transcript drawer overlays the note and waveform toggles it without replacing the editor', () => {
  assert.match(notesWindow, /onClick=\{\(\) => setIsLiveTranscriptOpen\(\(current\) => !current\)\}/);
  assert.match(notesWindow, /data-meeting-transcript-drawer/);
  assert.match(notesWindow, /overflow-y-auto/);
  assert.match(notesWindow, /draftMode !== 'mind_map'/);
  assert.match(notesWindow, /setIsLiveTranscriptOpen\(true\)/);
});

test('transcript interaction polish keeps controls contextual and source alignment intact', () => {
  assert.match(notesWindow, /opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100/);
  assert.match(notesWindow, /data-transcript-actions/);
  assert.match(notesWindow, /data-speaker-menu/);
  assert.match(notesWindow, /isMicrophoneSegment \? 'items-end' : 'items-start'/);
  assert.match(notesWindow, /Search transcript/);
  assert.match(notesWindow, /copyAllTranscript/);
  assert.match(notesWindow, /transcriptDrawerShouldFollowRef/);
  assert.match(notesWindow, /transcription_status === 'complete' && resolvedTranscriptSegments.length > 0/);
});

test('transcript drawer uses quiet search, icon copy, and naturally growing bubbles', () => {
  assert.match(notesWindow, /placeholder="Search transcript…"/);
  assert.match(notesWindow, /aria-label="Copy all transcript"/);
  assert.match(notesWindow, /<Copy size=\{12\} aria-hidden="true" \/>/);
  assert.match(notesWindow, /w-fit min-w-0 max-w-\[65%\]/);
  assert.match(notesWindow, /resizeTranscriptTextarea/);
  assert.match(notesWindow, /resize-none overflow-hidden/);
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

test('normal Write notes get note-scoped Ask while meeting controls stay behind the top microphone entry', () => {
  assert.match(notesWindow, /data-note-ask-dock/);
  assert.match(notesWindow, /placeholder="Ask about this note…"/);
  assert.match(notesWindow, /openNoteAskInRightPane/);
  assert.match(notesWindow, /!isMeetingNote[\s\S]{0,260}draftMode !== 'mind_map'[\s\S]{0,260}data-note-ask-dock/);
  assert.match(notesWindow, /!isMeetingNote && \(/);
  assert.match(notesWindow, /onClick=\{\(\) => void enableMeetingMode\(\)\}/);
  assert.match(notesWindow, /placeholder="Ask about this meeting…"/);
});

test('linked context opens as a whole-window modal from the Notes right pane', () => {
  assert.match(linkedContextModal, /<ModalOverlay[\s\S]*classNameContainer=/);
  assert.match(linkedContextModal, /backdropBorderRadius="var\(--ledger-window-radius\)"/);
  assert.match(linkedContextModal, /max-w-\[620px\]/);
  assert.match(linkedContextModal, /rounded-\[var\(--ledger-surface-radius\)\]/);
  assert.doesNotMatch(linkedContextModal, /disablePortal/);
});
