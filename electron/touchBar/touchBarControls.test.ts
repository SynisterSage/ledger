import assert from 'node:assert/strict';
import test from 'node:test';
import { createTouchBarControls } from './touchBarControls.ts';
import { action, spacer } from './touchBarLayouts.ts';

function setup() {
  const buttons: any[] = [];
  const segmented: any[] = [];
  const popovers: any[] = [];
  const icons: string[] = [];
  const dispatched: unknown[] = [];
  const controls = createTouchBarControls({
    native: {
      createTouchBar: (options) => ({ items: options.items ?? [] } as never),
      createButton: (options) => {
        const button = { ...options };
        buttons.push(button);
        return button as never;
      },
      createSpacer: (options) => ({ type: 'spacer', ...options } as never),
      createSegmented: (options) => {
        const control = { ...options };
        segmented.push(control);
        return control as never;
      },
      createPopover: (options) => {
        const popover = { ...options };
        popovers.push(popover);
        return popover as never;
      },
      createIcon: (asset) => {
        icons.push(asset);
        return asset as never;
      },
    },
    dispatchAction: (actionId) => dispatched.push(actionId),
    canExecuteAction: (actionId, context) =>
      actionId !== 'search.open' || context.authenticated === true,
  });
  const context = {
    page: 'other' as const,
    surface: 'unknown' as const,
    authenticated: true,
    appReady: true,
    windowContext: 'sidebar' as const,
  };
  return { controls, context, buttons, segmented, popovers, icons, dispatched };
}

test('action controls use native presentation, semantic icons, and accessibility labels', () => {
  const fixture = setup();
  const built = fixture.controls.build(
    [action('task.create'), action('search.open'), spacer('section')],
    fixture.context
  );
  assert.equal(built.items.length, 3);
  assert.equal(fixture.buttons[0].label, 'Task');
  assert.equal(fixture.buttons[0].accessibilityLabel, 'Create task');
  assert.equal(fixture.buttons[0].enabled, true);
  assert.equal(fixture.buttons[0].backgroundColor, undefined);
  assert.equal(fixture.icons.length, 2);
  assert.match(fixture.icons[0], /^data:image\/svg\+xml/);
});

test('availability disables action controls and prevents disabled clicks', () => {
  const fixture = setup();
  const built = fixture.controls.build([action('search.open')], {
    ...fixture.context,
    authenticated: false,
  });
  assert.equal(fixture.buttons[0].enabled, false);
  fixture.buttons[0].click();
  assert.deepEqual(fixture.dispatched, []);
  built.update(fixture.context);
  assert.equal(fixture.buttons[0].enabled, true);
});

test('segmented controls preserve selection, mapping, and disabled states', () => {
  const fixture = setup();
  fixture.controls.build(
    [
      {
        type: 'segmented',
        selected: 'week',
        items: [
          { id: 'day', actionId: 'calendar.view.day', label: 'Day' },
          { id: 'week', actionId: 'calendar.view.week', label: 'Week' },
          { id: 'month', actionId: 'calendar.view.month', label: 'Month', enabled: false },
        ],
      },
    ],
    fixture.context
  );
  assert.equal(fixture.segmented[0].selectedIndex, 1);
  assert.equal(fixture.segmented[0].segments[2].enabled, false);
  assert.deepEqual(
    fixture.segmented[0].segments.map((segment: { label?: string }) => segment.label),
    ['Day', 'Week', 'Month']
  );
  fixture.segmented[0].change(1, true);
  assert.deepEqual(fixture.dispatched, ['calendar.view.week']);
});

test('popover controls build bounded nested action groups', () => {
  const fixture = setup();
  fixture.controls.build(
    [
      {
        type: 'popover',
        label: 'More',
        items: [action('task.create')],
      },
    ],
    fixture.context
  );
  assert.equal(fixture.popovers.length, 1);
  assert.equal(fixture.popovers[0].label, 'More');
  assert.equal(fixture.popovers[0].showCloseButton, true);
});
