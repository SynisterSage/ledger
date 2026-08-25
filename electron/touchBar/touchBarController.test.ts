import assert from 'node:assert/strict';
import test from 'node:test';
import { createTouchBarController } from './touchBarController.ts';
import { DEFAULT_TOUCH_BAR_LAYOUT } from './touchBarLayouts.ts';
import type { LedgerTouchBarAction, TouchBarItem } from './touchBarTypes.ts';

type FakeButton = { kind: 'button'; label?: string; backgroundColor?: string; click?: () => void };
type FakeSpacer = { kind: 'spacer'; size?: string };

function setup(platform: NodeJS.Platform = 'darwin', includeWindow = true) {
  let destroyed = false;
  const attached: unknown[] = [];
  const created: Array<{ items: TouchBarItem[] }> = [];
  const actions: LedgerTouchBarAction[] = [];
  const sources: string[] = [];
  const window = {
    isDestroyed: () => destroyed,
    setTouchBar: (value: unknown) => attached.push(value),
  };
  const controller = createTouchBarController({
    platform,
    getSidebarWindow: () => (includeWindow ? window : null),
    native: {
      createTouchBar: (options) => {
        const value = { items: options.items ?? [] };
        created.push(value);
        return value as never;
      },
      createButton: (options) => ({ kind: 'button', ...options } as never),
      createSpacer: (options) => ({ kind: 'spacer', ...options } as never),
      createSegmented: (options) => ({ kind: 'segmented', ...options } as never),
      createPopover: (options) => ({ kind: 'popover', ...options } as never),
      createIcon: (asset) => asset as never,
    },
    dispatchAction: (action, context) => {
      actions.push(action);
      sources.push(context.source);
    },
  });
  return {
    controller,
    window,
    attached,
    created,
    actions,
    sources,
    destroy: () => {
      destroyed = true;
    },
  };
}

test('default layout resolves in the expected order', () => {
  assert.deepEqual(DEFAULT_TOUCH_BAR_LAYOUT, [
    { type: 'action', actionId: 'task.create' },
    { type: 'action', actionId: 'note.create' },
    { type: 'action', actionId: 'event.create' },
    { type: 'spacer', spacing: 'section' },
    { type: 'action', actionId: 'search.open' },
  ]);
});

test('normal mode is visible and hidden modes detach the bar', () => {
  const fixture = setup();
  fixture.controller.sync({ mode: 'default' });
  fixture.controller.sync({ mode: 'hidden' });

  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.attached.length, 2);
  assert.notEqual(fixture.attached[0], null);
  assert.equal(fixture.attached[1], null);
});

test('native layout preserves labels, color, spacer, and action mappings', () => {
  const fixture = setup();
  fixture.controller.sync({ mode: 'default' });
  const items = fixture.created[0]?.items as Array<FakeButton | FakeSpacer>;

  assert.deepEqual(
    items.map((item) => (item.kind === 'spacer' ? 'spacer' : item.label)),
    ['Task', 'Note', 'Event', 'spacer', 'Search']
  );
  assert.deepEqual(
    items
      .filter((item): item is FakeButton => item.kind === 'button')
      .map((item) => item.backgroundColor),
    [undefined, undefined, undefined, undefined]
  );

  items
    .filter((item): item is FakeButton => item.kind === 'button')
    .forEach((item) => item.click?.());
  assert.deepEqual(fixture.actions, ['task.create', 'note.create', 'event.create', 'search.open']);
  assert.deepEqual(fixture.sources, ['touch-bar', 'touch-bar', 'touch-bar', 'touch-bar']);
});

test('initialization is skipped outside macOS', () => {
  const fixture = setup('win32');
  fixture.controller.sync({ mode: 'default' });
  assert.equal(fixture.created.length, 0);
  assert.equal(fixture.attached.length, 0);
});

test('missing and destroyed windows are safe, and disposal clears the cache', () => {
  const missing = setup('darwin', false);
  assert.doesNotThrow(() => missing.controller.sync({ mode: 'default' }));

  const fixture = setup();
  fixture.destroy();
  assert.doesNotThrow(() => fixture.controller.sync({ mode: 'default' }));

  const active = setup();
  active.controller.sync({ mode: 'default' });
  active.controller.dispose();
  active.controller.sync({ mode: 'default' });
  assert.equal(active.created.length, 1);
  assert.equal(active.attached.at(-1), null);
});

test('ownership follows the resolved focused window and detaches the old owner', () => {
  const events: Array<{ owner: string; value: unknown }> = [];
  let target: 'sidebar' | 'workspace' | null = 'sidebar';
  const windows = {
    sidebar: { isDestroyed: () => false, setTouchBar: (value: unknown) => events.push({ owner: 'sidebar', value }) },
    workspace: { isDestroyed: () => false, setTouchBar: (value: unknown) => events.push({ owner: 'workspace', value }) },
  };
  const controller = createTouchBarController({
    platform: 'darwin',
    getSidebarWindow: () => windows.sidebar,
    getTouchBarWindow: () => (target ? windows[target] : null),
    native: {
      createTouchBar: (options) => ({ items: options.items ?? [] }) as never,
      createButton: (options) => ({ kind: 'button', ...options }) as never,
      createSpacer: (options) => ({ kind: 'spacer', ...options }) as never,
      createSegmented: (options) => ({ kind: 'segmented', ...options }) as never,
      createPopover: (options) => ({ kind: 'popover', ...options }) as never,
      createIcon: (asset) => asset as never,
    },
    dispatchAction: () => {},
  });
  controller.sync({ mode: 'default' });
  target = 'workspace';
  controller.onWindowFocusChanged();
  target = null;
  controller.onWindowDestroyed();

  assert.equal(events[0]?.owner, 'sidebar');
  assert.equal(events[1]?.owner, 'sidebar');
  assert.equal(events[1]?.value, null);
  assert.equal(events[2]?.owner, 'workspace');
  assert.equal(events[3]?.owner, 'workspace');
  assert.equal(events[3]?.value, null);
});
