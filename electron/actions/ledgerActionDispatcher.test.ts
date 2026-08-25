import assert from 'node:assert/strict';
import test from 'node:test';
import { canExecuteLedgerAction, createLedgerActionDispatcher } from './ledgerActionDispatcher.ts';
import { LEDGER_ACTION_DEFINITIONS, getLedgerActionDefinition } from './ledgerActionTypes.ts';

function setup() {
  const moduleWindows: string[] = [];
  let searchOpened = 0;
  const dispatcher = createLedgerActionDispatcher({
    openModuleWindow: (kind) => moduleWindows.push(kind),
    openSearch: () => {
      searchOpened += 1;
    },
    dispatchRendererAction: () => {},
  });
  return {
    dispatcher,
    moduleWindows,
    get searchOpened() {
      return searchOpened;
    },
  };
}

test('registry contains the supported semantic actions and labels', () => {
  assert.deepEqual(Object.keys(LEDGER_ACTION_DEFINITIONS), [
    'task.create',
    'note.create',
    'event.create',
    'search.open',
    'note.mode.write',
    'note.mode.mind-map',
    'note.mode.transcribe',
    'project.create',
    'project.lens.catch-up',
    'project.lens.blockers',
    'project.lens.next-steps',
    'project.lens.prepare-actions',
    'project.lens.find-context',
    'calendar.today',
    'calendar.previous',
    'calendar.next',
    'calendar.view.day',
    'calendar.view.week',
    'calendar.view.month',
    'meeting.open',
    'meeting.transcript.open',
    'meeting.pause',
    'meeting.resume',
    'meeting.stop',
  ]);
  assert.equal(getLedgerActionDefinition('task.create')?.label, 'Task');
  assert.equal(getLedgerActionDefinition('note.create')?.label, 'Note');
  assert.equal(getLedgerActionDefinition('event.create')?.label, 'Event');
  assert.equal(getLedgerActionDefinition('search.open')?.label, 'Search');
});

test('known actions route to their existing implementations', () => {
  const fixture = setup();
  const context = { source: 'touch-bar' as const, authenticated: true, appReady: true };

  assert.deepEqual(fixture.dispatcher.dispatchLedgerAction('task.create', context), {
    executed: true,
    actionId: 'task.create',
  });
  assert.deepEqual(fixture.dispatcher.dispatchLedgerAction('note.create', context), {
    executed: true,
    actionId: 'note.create',
  });
  assert.deepEqual(fixture.dispatcher.dispatchLedgerAction('event.create', context), {
    executed: true,
    actionId: 'event.create',
  });
  assert.deepEqual(fixture.dispatcher.dispatchLedgerAction('search.open', context), {
    executed: true,
    actionId: 'search.open',
  });

  assert.deepEqual(fixture.moduleWindows, ['quick-task', 'quick-note', 'quick-event']);
  assert.equal(fixture.searchOpened, 1);
});

test('availability requires authenticated and app-ready context', () => {
  assert.equal(
    canExecuteLedgerAction('task.create', {
      source: 'touch-bar',
      authenticated: false,
      appReady: true,
    }),
    false
  );
  assert.equal(
    canExecuteLedgerAction('task.create', {
      source: 'touch-bar',
      authenticated: true,
      appReady: false,
    }),
    false
  );
  assert.equal(
    canExecuteLedgerAction('task.create', {
      source: 'touch-bar',
      authenticated: true,
      appReady: true,
    }),
    true
  );
});

test('unknown and unavailable actions are rejected without execution', () => {
  const fixture = setup();
  assert.deepEqual(
    fixture.dispatcher.dispatchLedgerAction('not-a-ledger-action', {
      source: 'touch-bar',
      authenticated: true,
      appReady: true,
    }),
    { executed: false, reason: 'unknown-action' }
  );
  assert.deepEqual(
    fixture.dispatcher.dispatchLedgerAction('search.open', {
      source: 'touch-bar',
      authenticated: false,
      appReady: true,
    }),
    { executed: false, reason: 'unavailable' }
  );
  assert.deepEqual(fixture.moduleWindows, []);
  assert.equal(fixture.searchOpened, 0);
});

test('contextual actions route through the bounded renderer handler', () => {
  const actions: string[] = [];
  const dispatcher = createLedgerActionDispatcher({
    openModuleWindow: () => {},
    openSearch: () => {},
    dispatchRendererAction: (actionId) => actions.push(actionId),
  });
  const noteContext = {
    source: 'touch-bar' as const,
    authenticated: true,
    appReady: true,
    touchBarContext: {
      ...({} as import('../touchBar/touchBarContext.ts').LedgerTouchBarContext),
      page: 'notes' as const,
      surface: 'editor' as const,
      authenticated: true,
      appReady: true,
      resource: { type: 'note' as const, id: 'note-1' },
      windowContext: 'workspace' as const,
    },
  };
  assert.deepEqual(
    dispatcher.dispatchLedgerAction('note.mode.transcribe', noteContext),
    { executed: true, actionId: 'note.mode.transcribe' }
  );
  assert.deepEqual(actions, ['note.mode.transcribe']);
});

test('meeting controls respect session state and active-note context', () => {
  const meeting = {
    active: true,
    state: 'recording' as const,
    noteId: 'note-1',
    transcriptAvailable: true,
  };
  const base = {
    source: 'touch-bar' as const,
    authenticated: true,
    appReady: true,
    touchBarContext: {
      page: 'notes' as const,
      surface: 'editor' as const,
      authenticated: true,
      appReady: true,
      resource: { type: 'note' as const, id: 'note-1' },
      meeting,
      windowContext: 'workspace' as const,
    },
  };
  assert.equal(canExecuteLedgerAction('meeting.pause', base), true);
  assert.equal(canExecuteLedgerAction('meeting.resume', base), false);
  assert.equal(canExecuteLedgerAction('meeting.stop', base), true);
  assert.equal(canExecuteLedgerAction('meeting.transcript.open', base), true);
  assert.equal(canExecuteLedgerAction('meeting.pause', { ...base, touchBarContext: { ...base.touchBarContext, meeting: { ...meeting, state: 'paused' } } }), false);
});
