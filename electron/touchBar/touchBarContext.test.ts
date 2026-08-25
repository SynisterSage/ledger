import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TOUCH_BAR_CONTEXT, normalizeLedgerTouchBarContext } from './touchBarContext.ts';
import { createTouchBarContextCoordinator } from './touchBarContextCoordinator.ts';

test('normalizes core page context and drops malformed resource data', () => {
  assert.deepEqual(
    normalizeLedgerTouchBarContext({
      page: 'notes',
      surface: 'editor',
      authenticated: true,
      appReady: true,
      workspaceId: ' workspace-1 ',
      resource: { type: 'note', id: 'note-1' },
      noteMode: 'transcribe',
      windowContext: 'workspace',
    }),
    {
      page: 'notes',
      surface: 'editor',
      authenticated: true,
      appReady: true,
      workspaceId: 'workspace-1',
      resource: { type: 'note', id: 'note-1' },
      noteMode: 'transcribe',
      windowContext: 'workspace',
    }
  );
  assert.deepEqual(
    normalizeLedgerTouchBarContext({
      page: 'not-a-page',
      surface: 'bad',
      resource: { type: 'note' },
    }),
    {
      ...DEFAULT_TOUCH_BAR_CONTEXT,
    }
  );
});

test('normalizes projects, calendar modes, and meeting state', () => {
  assert.deepEqual(
    normalizeLedgerTouchBarContext({
      page: 'projects',
      surface: 'detail',
      resource: { type: 'project', id: 'project-1' },
      calendarView: 'week',
      meeting: { active: true, state: 'paused' },
    }),
    {
      page: 'projects',
      surface: 'detail',
      authenticated: false,
      appReady: false,
      resource: { type: 'project', id: 'project-1' },
      calendarView: 'week',
      meeting: { active: true, state: 'paused' },
      windowContext: 'unknown',
    }
  );
});

test('focused workspace wins over background or sidebar updates', () => {
  const updates: unknown[] = [];
  const coordinator = createTouchBarContextCoordinator((context) => updates.push(context));
  coordinator.update('sidebar', 'sidebar', { page: 'other', surface: 'unknown' }, true);
  coordinator.update('workspace', 'workspace', { page: 'projects', surface: 'list' }, true);
  coordinator.update('background-module', 'module', { page: 'calendar', surface: 'list' }, false);
  assert.equal(coordinator.getContext().page, 'projects');
  coordinator.setFocused('workspace', false);
  assert.equal(coordinator.getContext().page, 'other');
  assert.equal(updates.length, 3);
});

test('identical updates are deduplicated and stale resources clear on navigation', () => {
  let updateCount = 0;
  const coordinator = createTouchBarContextCoordinator(() => {
    updateCount += 1;
  });
  coordinator.update(
    'workspace',
    'workspace',
    { page: 'projects', surface: 'detail', resource: { type: 'project', id: 'a' } },
    true
  );
  coordinator.update(
    'workspace',
    'workspace',
    { page: 'projects', surface: 'detail', resource: { type: 'project', id: 'a' } },
    true
  );
  assert.equal(updateCount, 1);
  coordinator.update('workspace', 'workspace', { page: 'projects', surface: 'list' }, true);
  assert.equal(coordinator.getContext().resource, undefined);
  assert.equal(updateCount, 2);
});

test('meeting context remains when page context changes and reset clears everything', () => {
  const coordinator = createTouchBarContextCoordinator(() => {});
  coordinator.setMeeting({ active: true, state: 'recording' });
  coordinator.update('workspace', 'workspace', { page: 'notes', surface: 'list' }, true);
  assert.deepEqual(coordinator.getContext().meeting, { active: true, state: 'recording' });
  coordinator.reset();
  assert.deepEqual(coordinator.getContext(), DEFAULT_TOUCH_BAR_CONTEXT);
});
