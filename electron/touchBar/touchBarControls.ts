import {
  getLedgerActionDefinition,
  type LedgerActionContext,
} from '../actions/ledgerActionTypes.ts';
import { getTouchBarIconAsset, hasTouchBarIcon } from './touchBarAssets.ts';
import type { LedgerTouchBarContext } from './touchBarContext.ts';
import type {
  TouchBarLayoutItem,
  TouchBarSegmentedDefinition,
  TouchBarSpacing,
} from './touchBarLayouts.ts';
import type {
  TouchBarButtonConstructorOptions,
  TouchBarConstructorOptions,
  TouchBarPopoverConstructorOptions,
  TouchBarSegmentedControlConstructorOptions,
  TouchBarSpacerConstructorOptions,
  NativeImage,
  TouchBar,
} from 'electron';
import type { TouchBarItem } from './touchBarTypes.ts';

export interface TouchBarControlNativeFactory {
  createTouchBar(options: TouchBarConstructorOptions): TouchBar;
  createButton(options: TouchBarButtonConstructorOptions): TouchBarItem;
  createSpacer(options: TouchBarSpacerConstructorOptions): TouchBarItem;
  createSegmented(options: TouchBarSegmentedControlConstructorOptions): TouchBarItem;
  createPopover(options: TouchBarPopoverConstructorOptions): TouchBarItem;
  createIcon(asset: string): NativeImage;
}

export interface TouchBarControlBuildOptions {
  native: TouchBarControlNativeFactory;
  dispatchAction: (actionId: unknown, context: LedgerActionContext) => void;
  canExecuteAction: (actionId: unknown, context: LedgerActionContext) => boolean;
}

export interface TouchBarControlSet {
  items: TouchBarItem[];
  update(context: LedgerTouchBarContext): void;
}

const spacerSize: Record<TouchBarSpacing, 'small' | 'large' | 'flexible'> = {
  compact: 'small',
  standard: 'large',
  section: 'flexible',
};

const actionContext = (context: LedgerTouchBarContext): LedgerActionContext => ({
  source: 'touch-bar',
  authenticated: context.authenticated,
  appReady: context.appReady,
  touchBarContext: context,
});

function selectedSegmentId(item: TouchBarSegmentedDefinition, context: LedgerTouchBarContext) {
  if (context.noteMode && item.items.some((segment) => segment.id === context.noteMode)) return context.noteMode;
  if (context.calendarView && item.items.some((segment) => segment.id === context.calendarView)) return context.calendarView;
  return item.selected;
}

function iconFor(native: TouchBarControlNativeFactory, icon: string | undefined) {
  return icon && hasTouchBarIcon(icon) ? native.createIcon(getTouchBarIconAsset(icon)) : undefined;
}

export function createTouchBarControls(options: TouchBarControlBuildOptions) {
  const build = (
    layout: readonly TouchBarLayoutItem[],
    context: LedgerTouchBarContext
  ): TouchBarControlSet => {
    const bindings: Array<(next: LedgerTouchBarContext) => void> = [];

    const buildItems = (items: readonly TouchBarLayoutItem[]): TouchBarItem[] =>
      items.map((item) => {
        if (item.type === 'spacer')
          return options.native.createSpacer({ size: spacerSize[item.spacing] });
        if (item.type === 'action') {
          const definition = getLedgerActionDefinition(item.actionId);
          const enabled = options.canExecuteAction(item.actionId, actionContext(context));
          const control = options.native.createButton({
            label: item.label ?? definition?.label ?? item.actionId,
            accessibilityLabel: item.accessibilityLabel ?? definition?.accessibilityLabel ?? item.label ?? item.actionId,
            icon: iconFor(options.native, definition?.icon),
            iconPosition: 'left',
            enabled,
            click: () => {
              if (options.canExecuteAction(item.actionId, actionContext(currentContext))) {
                options.dispatchAction(item.actionId, actionContext(currentContext));
              }
            },
          });
          bindings.push((next) => {
            const nextEnabled = options.canExecuteAction(item.actionId, actionContext(next));
            if ('enabled' in control) (control as { enabled: boolean }).enabled = nextEnabled;
          });
          return control;
        }
        if (item.type === 'segmented') return buildSegmented(item, context, bindings);
        const nested = buildItems(item.items);
        const nestedTouchBar = options.native.createTouchBar({ items: nested });
        return options.native.createPopover({
          label: item.label,
          icon: iconFor(options.native, item.icon),
          items: nestedTouchBar as never,
          showCloseButton: true,
        });
      });

    let currentContext = context;
    const builtItems = buildItems(layout);
    return {
      items: builtItems,
      update(next) {
        currentContext = next;
        bindings.forEach((binding) => binding(next));
      },
    };

    function buildSegmented(
      item: TouchBarSegmentedDefinition,
      segmentContext: LedgerTouchBarContext,
      segmentBindings: Array<(next: LedgerTouchBarContext) => void>
    ) {
      const selectedIndex = Math.max(
        0,
        item.items.findIndex((segment) => segment.id === selectedSegmentId(item, segmentContext))
      );
      const control = options.native.createSegmented({
        mode: 'single',
        segmentStyle: 'separated',
        selectedIndex,
        segments: item.items.map((segment) => ({
          label: segment.label,
          icon: iconFor(options.native, segment.icon),
          enabled:
            segment.enabled !== false &&
            options.canExecuteAction(segment.actionId, actionContext(segmentContext)),
        })),
        change: (nextIndex) => {
          const segment = item.items[nextIndex];
          if (
            segment &&
            segment.enabled !== false &&
            options.canExecuteAction(segment.actionId, actionContext(currentContext))
          ) {
            options.dispatchAction(segment.actionId, actionContext(currentContext));
          }
        },
      });
      segmentBindings.push((next) => {
        if ('segments' in control) {
          (control as { segments: Array<{ label?: string; icon?: NativeImage; enabled?: boolean }> }).segments = item.items.map((segment) => ({
            label: segment.label,
            icon: iconFor(options.native, segment.icon),
            enabled:
              segment.enabled !== false &&
              options.canExecuteAction(segment.actionId, actionContext(next)),
          }));
        }
        if ('selectedIndex' in control) {
          const selected = selectedSegmentId(item, next);
          const nextIndex = item.items.findIndex((segment) => segment.id === selected);
          if (nextIndex >= 0) (control as { selectedIndex: number }).selectedIndex = nextIndex;
        }
      });
      return control;
    }
  };

  return { build };
}
