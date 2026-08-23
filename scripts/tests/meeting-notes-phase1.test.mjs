import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');
const notesTypes = fs.readFileSync('src/types/notes.ts', 'utf8');
const migration = fs.readFileSync('migrations/118_meeting_notes_phase1.sql', 'utf8');

test('meeting notes keep Write as the primary surface with compact recording controls', () => {
  assert.match(notesWindow, /meetingCenterView === 'write'/);
  assert.match(notesWindow, /data-meeting-recording-controls/);
  assert.match(notesWindow, /Start recording/);
  assert.match(notesWindow, /Pause recording/);
  assert.match(notesWindow, /Stop recording/);
});

test('meeting notes mount the existing transcript section below the editor collapsed', () => {
  assert.match(notesWindow, /<RichTextEditor[\s\S]*MeetingTranscriptSection/);
  assert.match(notesWindow, /isExpanded=\{false\}/);
  assert.match(notesWindow, /getTranscriptSegments/);
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
