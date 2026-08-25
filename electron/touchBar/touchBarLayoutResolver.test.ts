import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TOUCH_BAR_CONTEXT, type LedgerTouchBarContext } from './touchBarContext.ts';
import { resolveTouchBarLayout } from './touchBarLayoutResolver.ts';

const context = (patch: Partial<LedgerTouchBarContext>): LedgerTouchBarContext => ({
  ...DEFAULT_TOUCH_BAR_CONTEXT,
  authenticated: true,
  appReady: true,
  ...patch,
});

test('resolves the global fallback for unrelated pages', () => {
  assert.equal(resolveTouchBarLayout(context({ page: 'dashboard' })).id, 'default');
});

test('resolves Notes list and editor layouts', () => {
  assert.equal(resolveTouchBarLayout(context({ page: 'notes', surface: 'list' })).id, 'notes.list');
  assert.equal(resolveTouchBarLayout(context({ page: 'notes', surface: 'editor', resource: { type: 'note', id: 'n1' }, noteMode: 'mind-map' })).id, 'notes.editor');
});

test('requires a valid project resource for the detail layout', () => {
  assert.equal(resolveTouchBarLayout(context({ page: 'projects', surface: 'list' })).id, 'projects.list');
  assert.equal(resolveTouchBarLayout(context({ page: 'projects', surface: 'detail' })).id, 'projects.list');
  assert.equal(resolveTouchBarLayout(context({ page: 'projects', surface: 'detail', resource: { type: 'project', id: 'p1' } })).id, 'projects.detail');
});

test('resolves Calendar independently of selected event state', () => {
  assert.equal(resolveTouchBarLayout(context({ page: 'calendar', surface: 'list', calendarView: 'day' })).id, 'calendar');
  assert.equal(resolveTouchBarLayout(context({ page: 'calendar', surface: 'detail', resource: { type: 'event', id: 'e1' }, calendarView: 'month' })).id, 'calendar');
});

test('meeting state takes priority for the active meeting note', () => {
  const base = context({
    page: 'notes',
    surface: 'editor',
    resource: { type: 'note', id: 'meeting-note' },
    meeting: { active: true, state: 'recording', noteId: 'meeting-note' },
  });
  assert.equal(resolveTouchBarLayout(base).id, 'notes.meeting.recording');
  assert.equal(resolveTouchBarLayout({ ...base, meeting: { ...base.meeting!, state: 'paused' } }).id, 'notes.meeting.paused');
  assert.equal(resolveTouchBarLayout({ ...base, meeting: { ...base.meeting!, state: 'completed', transcriptAvailable: true } }).id, 'notes.completed-meeting');
});

test('an active meeting augments other page layouts without replacing them', () => {
  const layout = resolveTouchBarLayout(context({
    page: 'projects',
    surface: 'detail',
    resource: { type: 'project', id: 'project-1' },
    meeting: { active: true, state: 'paused', noteId: 'meeting-note' },
  }));
  assert.equal(layout.id, 'projects.detail.meeting');
  assert.equal(layout.items.at(-1)?.type, 'action');
  assert.equal((layout.items.at(-1) as { actionId?: string }).actionId, 'meeting.open');
});
