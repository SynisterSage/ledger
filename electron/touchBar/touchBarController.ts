import { resolveTouchBarLayout } from './touchBarLayoutResolver.ts';
import type { TouchBarLayoutDefinition } from './touchBarLayouts.ts';
import { createTouchBarControls, type TouchBarControlSet } from './touchBarControls.ts';
import { DEFAULT_TOUCH_BAR_CONTEXT } from './touchBarContext.ts';
import type {
  LedgerTouchBarAction,
  LedgerTouchBarContext,
  LedgerTouchBarSyncContext,
  TouchBarControllerOptions,
  TouchBarWindow,
} from './touchBarTypes.ts';

export interface TouchBarController {
  sync(context: LedgerTouchBarSyncContext): void;
  onWindowFocusChanged(): void;
  onWindowDestroyed(): void;
  setContext(context: LedgerTouchBarContext): boolean;
  getContext(): LedgerTouchBarContext;
  detach(): void;
  dispose(): void;
}

function isUsableWindow(window: TouchBarWindow | null | undefined): window is TouchBarWindow {
  return Boolean(window && !window.isDestroyed());
}

export function createTouchBarController(options: TouchBarControllerOptions): TouchBarController {
  let touchBar: ReturnType<TouchBarControllerOptions['native']['createTouchBar']> | null = null;
  let controlSet: TouchBarControlSet | null = null;
  let disposed = false;
  let currentContext: LedgerTouchBarContext = { ...DEFAULT_TOUCH_BAR_CONTEXT };
  let currentLayout: TouchBarLayoutDefinition = resolveTouchBarLayout(currentContext);
  let currentMode: LedgerTouchBarSyncContext['mode'] = 'hidden';
  let owner: TouchBarWindow | null = null;
  const controls = createTouchBarControls({
    native: options.native,
    dispatchAction: (action, context) =>
      options.dispatchAction(action as LedgerTouchBarAction, context),
    canExecuteAction: options.canExecuteAction ?? (() => true),
  });

  const resolveTarget = () => options.getTouchBarWindow?.() ?? options.getSidebarWindow();
  const reconcile = () => {
    if (disposed || options.platform !== 'darwin') return;
    const nextOwner = currentMode === 'default' ? resolveTarget() : null;
    if (owner && owner !== nextOwner && isUsableWindow(owner)) owner.setTouchBar(null);
    if (!isUsableWindow(nextOwner)) {
      owner = null;
      touchBar = null;
      controlSet = null;
      return;
    }
    owner = nextOwner;
    if (!touchBar) {
      controlSet = controls.build(currentLayout.items, currentContext);
      touchBar = options.native.createTouchBar({ items: controlSet.items });
    }
    owner.setTouchBar(touchBar);
  };

  const sync = (context: LedgerTouchBarSyncContext) => {
    currentMode = context.mode;
    reconcile();
  };

  const setContext = (context: LedgerTouchBarContext) => {
    if (JSON.stringify(currentContext) === JSON.stringify(context)) return false;
    currentContext = context;
    const nextLayout = resolveTouchBarLayout(context);
    const layoutChanged = nextLayout.id !== currentLayout.id;
    currentLayout = nextLayout;
    if (layoutChanged && touchBar) {
      if (isUsableWindow(owner)) {
        owner.setTouchBar(null);
        controlSet = controls.build(currentLayout.items, currentContext);
        touchBar = options.native.createTouchBar({ items: controlSet.items });
        owner.setTouchBar(touchBar);
      }
    } else {
      controlSet?.update(context);
    }
    if (process.env.NODE_ENV !== 'production') console.info('[touch-bar] context', currentContext);
    reconcile();
    return true;
  };

  const detach = () => {
    if (isUsableWindow(owner)) owner.setTouchBar(null);
    owner = null;
    touchBar = null;
    controlSet = null;
  };

  const dispose = () => {
    if (disposed) return;
    detach();
    disposed = true;
  };

  return {
    sync,
    onWindowFocusChanged: reconcile,
    onWindowDestroyed: reconcile,
    setContext,
    getContext: () => currentContext,
    detach,
    dispose,
  };
}

export type { LedgerTouchBarAction };
