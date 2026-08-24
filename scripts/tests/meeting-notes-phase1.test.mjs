import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');
const notesTypes = fs.readFileSync('src/types/notes.ts', 'utf8');
const migration = fs.readFileSync('migrations/118_meeting_notes_phase1.sql', 'utf8');

test('meeting notes keep Write as the primary surface with compact recording controls', () => {
  assert.match(notesWindow, /meetingCenterView === 'write'/);
  assert.match(notesWindow, /pendingMeetingViewRef\.current = \{ noteId: selectedNote\.id, view: 'write' \}/);
  assert.match(notesWindow, /setDraftMode\('meeting_note'\)/);
  assert.match(notesWindow, /aria-label="Open transcript"/);
  assert.match(notesWindow, /Boolean\(meetingPrep\?\.points\?\.length\)/);
  assert.match(notesWindow, /data-meeting-recording-controls/);
  assert.match(notesWindow, /Start recording/);
  assert.match(notesWindow, /Pause recording/);
  assert.match(notesWindow, /Stop recording/);
});

test('meeting notes keep the live transcript out of the default Write canvas', () => {
  assert.match(notesWindow, /meetingCenterView === 'transcript'[\s\S]*MeetingTranscriptSection/);
  assert.doesNotMatch(notesWindow, /isExpanded=\{false\}/);
  assert.doesNotMatch(notesWindow, /resolvedTranscriptSegments\) && \(/);
  assert.match(notesWindow, /getTranscriptSegments/);
});

test('meeting notes use the normal Lexical writing surface while recording', () => {
  assert.match(notesWindow, /<RichTextEditor[\s\S]*showToolbar/);
  assert.match(notesWindow, /onChange=\{\(nextHtml\) =>/);
  assert.match(notesWindow, /void flushAutosave\(\)/);
  assert.match(notesWindow, /data-meeting-floating-controls/);
});

test('meeting intelligence remains an evidence-first type contract without generated fields', () => {
  assert.match(notesTypes, /export type MeetingIntelligenceContext/);
  assert.match(notesTypes, /humanNotes:/);
  assert.match(notesTypes, /transcriptSegments: TranscriptSegment\[\]/);
  assert.match(notesTypes, /transcriptLinks: MeetingTranscriptLink\[\]/);
  assert.doesNotMatch(notesTypes, /generatedRecap|decisions:\s*Generated/);
});

test('meeting transcript evidence stays separate from note HTML', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.meeting_note_transcript_segments/);
  assert.match(migration, /transcript_text TEXT NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, note_id\)/);
});
