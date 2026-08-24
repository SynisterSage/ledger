import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');

test('completed meetings stay on the normal Write canvas and promote recap content', () => {
  assert.match(notesWindow, /const isMeetingComplete = isMeetingNote && meetingMetadata\?\.transcription_status === 'complete'/);
  assert.match(notesWindow, /meetingCenterView === 'transcript'/);
  assert.match(notesWindow, /data-meeting-recap-draft/);
  assert.match(notesWindow, /data-meeting-transcript-disclosure/);
  assert.match(notesWindow, /<RichTextEditor[\s\S]*showToolbar/);
});

test('review sections omit empty generated content and preserve the user notes editor', () => {
  assert.match(notesWindow, /draft\.overview\.trim\(\)/);
  assert.match(notesWindow, /items\.length \? \(/);
  assert.match(notesWindow, /<h2>Your notes<\/h2>/);
  assert.match(notesWindow, /normalizeEditorHtml\(draftContent\)/);
});

test('completed transcript disclosure opens the existing full transcript editor', () => {
  assert.match(notesWindow, /onClick=\{\(\) => setMeetingCenterView\('transcript'\)\}/);
  assert.match(notesWindow, /isMeetingNote && meetingCenterView === 'transcript'[\s\S]*MeetingTranscriptSection/);
  assert.match(notesWindow, /focusTranscriptSegment[\s\S]*setMeetingCenterView\('transcript'\)/);
  assert.match(notesWindow, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
});

test('completed meeting dock switches from Enhance to accepted Recap', () => {
  assert.match(notesWindow, /hasAcceptedMeetingRecap/);
  assert.match(notesWindow, /hasMeetingRecap\s*\n\s*\? 'Recap ✓'/);
  assert.match(notesWindow, /: 'Enhance'/);
  assert.match(notesWindow, /meetingRecapStatus === 'generating'/);
  assert.match(notesWindow, /meetingRecapStage/);
  assert.match(notesWindow, /isMeetingComplete \? \(/);
});

test('normal notes remain outside completed-meeting presentation branches', () => {
  assert.match(notesWindow, /const isMeetingComplete = isMeetingNote &&/);
  assert.match(notesWindow, /isMeetingNote && meetingRecapStatus === 'ready'/);
  assert.match(notesWindow, /isMeetingComplete && transcriptSegments.length > 0/);
});
