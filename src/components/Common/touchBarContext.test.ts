import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTouchBarContext } from './touchBarContext.ts';

const base = {
  workspaceId: 'workspace-1',
  authenticated: true,
  appReady: true,
  windowContext: 'workspace' as const,
};

test('resolves Notes list/editor and note modes', () => {
  assert.deepEqual(resolveTouchBarContext({ ...base, route: { kind: 'notes' } }), {
    ...base,
    page: 'notes',
    surface: 'list',
  });
  assert.deepEqual(
    resolveTouchBarContext({
      ...base,
      route: { kind: 'notes', focusNoteId: 'note-1', focusContext: 'note-view:map' },
    }),
    {
      ...base,
      page: 'notes',
      surface: 'editor',
      resource: { type: 'note', id: 'note-1' },
      noteMode: 'mind-map',
    }
  );
});

test('resolves Projects selection and clears resource on list route', () => {
  assert.equal(
    resolveTouchBarContext({ ...base, route: { kind: 'projects', focusProjectId: 'project-1' } })
      .resource?.id,
    'project-1'
  );
  assert.equal(
    resolveTouchBarContext({ ...base, route: { kind: 'projects' } }).resource,
    undefined
  );
});

test('resolves Calendar view and selected event', () => {
  assert.deepEqual(
    resolveTouchBarContext({
      ...base,
      route: { kind: 'calendar', focusSection: 'week', focusContext: 'focus-event:event-1' },
    }),
    {
      ...base,
      page: 'calendar',
      surface: 'detail',
      calendarView: 'week',
      resource: { type: 'event', id: 'event-1' },
    }
  );
});
