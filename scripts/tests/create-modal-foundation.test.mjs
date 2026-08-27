import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('creation surfaces share the creation shell', () => {
  const shell = read('src/components/Common/CreateModalShell.tsx');
  const calendar = read('src/components/Calendar/CalendarWindow.tsx');
  const projects = read('src/components/Projects/ProjectsWindow.tsx');

  assert.match(shell, /export const CreateModalShell/);
  assert.match(shell, /export const CreateFieldRow/);
  assert.match(shell, /export const CreateSection/);
  assert.match(calendar, /<CreateModalShell/);
  assert.match(calendar, /autoFocus/);
  assert.match(projects, /<CreateModalShell/);
});

test('calendar creation keeps both resource modes and authoritative submit path', () => {
  const calendar = read('src/components/Calendar/CalendarWindow.tsx');

  assert.match(calendar, /composerMode === 'reminder' \? 'New reminder' : 'New event'/);
  assert.match(calendar, /composerMode === 'reminder' \? 'Create reminder' : 'Create event'/);
  assert.match(calendar, /onPrimary=\{\(\) => void createQuickEvent\(\)\}/);
  assert.match(calendar, /newEventRecurrence/);
  assert.match(calendar, /newEventVisibility/);
  assert.match(calendar, /composerNoteId/);
  assert.match(calendar, /composerAiRequestRef/);
  assert.match(calendar, /composerReturnFocusRef/);
  assert.match(calendar, /window\.askLedger\?\.cancel/);
});

test('more options is shared, collapsed by default, and exposes advanced values when needed', () => {
  const shell = read('src/components/Common/CreateModalShell.tsx');
  const calendar = read('src/components/Calendar/CalendarWindow.tsx');

  assert.match(shell, /export const CreateMoreOptions/);
  assert.match(shell, /aria-expanded=\{expanded\}/);
  assert.match(shell, /aria-controls=\{contentId \?\? panelId\}/);
  assert.match(calendar, /useState\(false\)/);
  assert.match(calendar, /setIsComposerMoreOptionsOpen\(Boolean\(/);
  assert.match(calendar, /if \(specificDatesValidationMessage\) setIsComposerMoreOptionsOpen\(true\)/);
  assert.match(calendar, /label="More options"/);
  assert.doesNotMatch(calendar, /false && composerMode/);
  assert.doesNotMatch(calendar, /false && isComposerMoreOptionsOpen/);
});
