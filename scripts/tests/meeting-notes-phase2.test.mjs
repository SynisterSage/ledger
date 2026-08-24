import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');

test('live transcript is opt-in and mounted above the meeting dock', () => {
  assert.match(notesWindow, /const \[isLiveTranscriptOpen, setIsLiveTranscriptOpen\]/);
  assert.match(notesWindow, /data-meeting-live-transcript/);
  assert.match(notesWindow, /aria-label=\{isLiveTranscriptOpen \? 'Close live transcript' : 'Open live transcript'\}/);
  assert.match(notesWindow, /aria-pressed=\{isLiveTranscriptOpen\}/);
  assert.match(notesWindow, /segments=\{resolvedTranscriptSegments\}/);
});

test('live transcript follows new segments without taking over the note editor', () => {
  assert.match(notesWindow, /orderedSegments = useMemo\(/);
  assert.match(notesWindow, /shouldFollowRef\.current/);
  assert.match(notesWindow, /data-meeting-live-transcript-scroll/);
  assert.match(notesWindow, /<RichTextEditor[\s\S]*showToolbar/);
  assert.match(notesWindow, /setTranscriptSegments\(safeSegments\)/);
});

test('live transcript closes on note changes and when recording stops', () => {
  assert.match(notesWindow, /setIsLiveTranscriptOpen\(false\);[\s\S]*meetingStopInFlightRef/);
  assert.match(notesWindow, /setIsLiveTranscriptOpen\(false\);\n  \}, \[selectedNoteId\]\);/);
  assert.match(notesWindow, /if \(!liveTranscriptAvailable\) setIsLiveTranscriptOpen\(false\)/);
});

test('normal notes cannot render the live meeting transcript surface', () => {
  assert.match(notesWindow, /isMeetingNote &&[\s\S]*\{isLiveTranscriptOpen &&/);
  assert.match(notesWindow, /const liveTranscriptAvailable = Boolean\([\s\S]*isMeetingNote/);
});

