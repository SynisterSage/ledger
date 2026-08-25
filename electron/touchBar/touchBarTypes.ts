import type {
  TouchBar,
  TouchBarButtonConstructorOptions,
  TouchBarConstructorOptions,
  TouchBarSpacerConstructorOptions,
} from 'electron';
import type { LedgerActionContext, LedgerActionId } from '../actions/ledgerActionTypes.ts';
import type { LedgerTouchBarContext } from './touchBarContext.ts';

export type LedgerTouchBarMode = 'default' | 'hidden';

export interface LedgerTouchBarSyncContext {
  mode: LedgerTouchBarMode;
}

export type LedgerTouchBarAction = LedgerActionId;

export type TouchBarItem = NonNullable<TouchBarConstructorOptions['items']>[number];

export interface TouchBarWindow {
  isDestroyed(): boolean;
  setTouchBar(touchBar: TouchBar | null): void;
}

export interface TouchBarNativeFactory {
  createTouchBar(options: TouchBarConstructorOptions): TouchBar;
  createButton(options: TouchBarButtonConstructorOptions): TouchBarItem;
  createSpacer(options: TouchBarSpacerConstructorOptions): TouchBarItem;
  createSegmented(options: Electron.TouchBarSegmentedControlConstructorOptions): TouchBarItem;
  createPopover(options: Electron.TouchBarPopoverConstructorOptions): TouchBarItem;
  createIcon(asset: string): Electron.NativeImage;
}

export interface TouchBarControllerOptions {
  platform: NodeJS.Platform;
  getSidebarWindow: () => TouchBarWindow | null | undefined;
  getTouchBarWindow?: () => TouchBarWindow | null | undefined;
  native: TouchBarNativeFactory;
  dispatchAction: (action: LedgerTouchBarAction, context: LedgerActionContext) => void;
  canExecuteAction?: (action: unknown, context: LedgerActionContext) => boolean;
}

export type { LedgerTouchBarContext };
