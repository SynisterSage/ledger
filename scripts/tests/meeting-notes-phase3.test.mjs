import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notesWindow = fs.readFileSync('src/components/Notes/NotesWindow.tsx', 'utf8');
const richTextEditor = fs.readFileSync('src/components/Notes/RichTextEditor.tsx', 'utf8');
const recapDraftSection = notesWindow.slice(
  notesWindow.indexOf('const MeetingRecapDraftSection'),
  notesWindow.indexOf('export const NotesWindow')
);

test('completed meetings stay on the normal Write canvas and promote recap content', () => {
  assert.match(notesWindow, /const isMeetingComplete = isMeetingNote && meetingMetadata\?\.transcription_status === 'complete'/);
  assert.match(notesWindow, /meetingCenterView === 'transcript'/);
  assert.match(notesWindow, /data-meeting-recap-draft/);
  assert.doesNotMatch(notesWindow, /data-meeting-transcript-disclosure/);
  assert.match(notesWindow, /<RichTextEditor[\s\S]*showToolbar/);
});

test('review sections omit empty generated content and preserve the user notes editor', () => {
  assert.match(notesWindow, /draft\.overview\.trim\(\)/);
  assert.match(notesWindow, /items\.length \? \(/);
  assert.match(notesWindow, /<h2>Your notes<\/h2>/);
  assert.doesNotMatch(notesWindow, /<hr><h2>Your notes<\/h2>/);
  assert.match(notesWindow, /normalizeEditorHtml\(draftContent\)/);
});

test('transcript mode remains available from the meeting header', () => {
  assert.match(notesWindow, /aria-label="Open transcript"/);
  assert.match(notesWindow, /onClick=\{\(\) => setMeetingCenterView\('transcript'\)\}/);
  assert.match(notesWindow, /isMeetingNote && meetingCenterView === 'transcript'[\s\S]*MeetingTranscriptSection/);
  assert.match(notesWindow, /focusTranscriptSegment[\s\S]*setMeetingCenterView\('transcript'\)/);
  assert.match(notesWindow, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
});

test('completed meeting dock switches from Enhance to transcript access', () => {
  assert.match(notesWindow, /hasAcceptedMeetingRecap/);
  assert.match(notesWindow, /acceptedMeetingContent = `\$\{draftContent\}\\n\$\{selectedNote\?\.content_html/);
  assert.match(notesWindow, /<h\[1-3\]\[\^>\]\*>\\s\*Recap/);
  assert.match(notesWindow, /\(hasAcceptedMeetingRecap \|\| meetingRecapHasRun\) && !meetingRecapTemplateChanged/);
  assert.match(notesWindow, /\? 'Transcript'/);
  assert.match(notesWindow, /\? 'Regenerate'/);
  assert.match(notesWindow, /: 'Enhance'/);
  assert.match(notesWindow, /meetingRecapStatus === 'generating'/);
  assert.match(notesWindow, /meetingRecapStage/);
  assert.match(notesWindow, /isMeetingComplete \?/);
  assert.doesNotMatch(notesWindow, /Enhance meeting note/);
});

test('accepting recap refreshes Lexical immediately before autosave completes', () => {
  assert.match(notesWindow, /setMeetingRecapDraft\(null\);[\s\S]*setMeetingRecapStatus\('idle'\);[\s\S]*setDraftContent\(recapHtml\);[\s\S]*draftContentRef\.current = recapHtml;[\s\S]*setEditorRefreshTick\(\(current\) => current \+ 1\);/);
  assert.match(notesWindow, /editorKey=\{`\$\{selectedNote\.id\}:\$\{editorRefreshTick\}`\}/);
});

test('normal notes remain outside completed-meeting presentation branches', () => {
  assert.match(notesWindow, /const isMeetingComplete = isMeetingNote &&/);
  assert.match(notesWindow, /isMeetingNote && meetingRecapStatus === 'ready'/);
  assert.doesNotMatch(notesWindow, /data-meeting-transcript-disclosure/);
});

test('recap draft review stays inline with one quiet review bar', () => {
  assert.doesNotMatch(recapDraftSection, /Recap draft|Review the evidence before accepting|Ask this meeting/);
  assert.match(recapDraftSection, /data-meeting-recap-review-bar/);
  assert.match(recapDraftSection, /Draft ·/);
  assert.match(recapDraftSection, />Regenerate<\/button>/);
  assert.match(recapDraftSection, />Accept<\/button>/);
  assert.match(recapDraftSection, /showWorkActions && actionItem/);
  assert.match(notesWindow, /beforeContent=\{[\s\S]*MeetingRecapDraftSection/);
  assert.match(richTextEditor, /data-editor-before-content/);
  assert.match(richTextEditor, /placeholder=\{beforeContent \? null/);
});

test('generated recap drafts survive NotesWindow remounts through a bounded note cache', () => {
  assert.match(notesWindow, /new LensCache<MeetingRecapDraftCacheEntry>/);
  assert.match(notesWindow, /ledger:meeting-recap-draft-cache:v1/);
  assert.match(notesWindow, /meetingRecapCacheKey\(activeWorkspaceId, selectedNoteId\)/);
  assert.match(notesWindow, /meetingRecapDraftCache\.get\(/);
  assert.match(notesWindow, /meetingRecapDraftCache\.set\(/);
  assert.match(notesWindow, /meetingRecapDraftCache\.invalidate\(/);
  assert.match(notesWindow, /meetingRecapStatus !== 'idle'/);
});

test('meeting template selection reaches recap context and separates cached drafts', () => {
  assert.match(notesWindow, /template: meetingMetadata\.meeting_template \?\? 'auto'/);
  assert.match(notesWindow, /templateInstructions: meetingMetadata\.meeting_template_instructions/);
  assert.match(notesWindow, /template: template \?\? 'auto'/);
  assert.match(notesWindow, /templateInstructions: templateInstructions \?\? null/);
  assert.match(notesWindow, /meetingRecapDraftCache\.invalidate\(meetingRecapCacheKey\(activeWorkspaceId, selectedNoteId\)\)/);
});
