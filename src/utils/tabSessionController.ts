import {
  reduceTabSession,
  type TabRoute,
  type TabSession,
  type TabSessionAction,
  type TabSessionReduction,
  type TabSessionState,
} from './tabSessionState.ts';

export type TabSessionListener = (state: TabSessionState, action: TabSessionAction) => void;

/**
 * Serialized command boundary for a single workspace window.
 *
 * Platform adapters own transport (Electron IPC or browser history); this
 * controller owns ordering, revision checks, and state publication.
 */
export class TabSessionController {
  private state: TabSessionState;
  private readonly listeners = new Set<TabSessionListener>();

  constructor(initial: TabSessionState) {
    this.state = {
      ...initial,
      tabs: initial.tabs.map((tab) => ({
        ...tab,
        route: { ...tab.route },
        backStack: tab.backStack.map((route) => ({ ...route })),
        forwardStack: tab.forwardStack.map((route) => ({ ...route })),
      })),
    };
    this.assertInvariants();
  }

  getSnapshot(): TabSessionState {
    return {
      ...this.state,
      tabs: this.state.tabs.map((tab) => ({
        ...tab,
        route: { ...tab.route },
        backStack: tab.backStack.map((route) => ({ ...route })),
        forwardStack: tab.forwardStack.map((route) => ({ ...route })),
      })),
    };
  }

  subscribe(listener: TabSessionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: TabSessionAction): TabSessionReduction {
    const reduction = reduceTabSession(this.state, {
      ...action,
      expectedRevision: action.expectedRevision ?? this.state.revision,
    });
    if (!reduction.accepted) return reduction;
    this.state = reduction.state;
    this.assertInvariants();
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot, action);
      } catch (error) {
        // A diagnostics/rendering subscriber must not roll back or interrupt a
        // committed navigation transition.
        console.error('[tabs] subscriber failed', error);
      }
    }
    return { state: snapshot, accepted: true };
  }

  open(
    tab: Omit<TabSession, 'backStack' | 'forwardStack'> &
      Partial<Pick<TabSession, 'backStack' | 'forwardStack'>>,
    select = true
  ) {
    return this.dispatch({
      type: 'open',
      tab: {
        ...tab,
        backStack: tab.backStack?.map((route) => ({ ...route })) ?? [],
        forwardStack: tab.forwardStack?.map((route) => ({ ...route })) ?? [],
      },
      select,
    });
  }

  navigate(tabId: string, route: TabRoute, pushHistory = true) {
    return this.dispatch({ type: 'navigate', tabId, route, pushHistory });
  }

  select(tabId: string) {
    return this.dispatch({ type: 'select', tabId });
  }

  close(tabId: string) {
    return this.dispatch({ type: 'close', tabId });
  }

  back(tabId: string) {
    return this.dispatch({ type: 'back', tabId });
  }

  forward(tabId: string) {
    return this.dispatch({ type: 'forward', tabId });
  }

  rename(tabId: string, title: string) {
    return this.dispatch({ type: 'rename', tabId, title });
  }

  /** Export a detached-window/reload-safe session payload. */
  serialize() {
    return this.getSnapshot();
  }

  /** Restore a previously serialized session after validating its invariants. */
  static restore(snapshot: TabSessionState) {
    return new TabSessionController(snapshot);
  }

  reorder(tabId: string, toIndex: number) {
    return this.dispatch({ type: 'reorder', tabId, toIndex });
  }

  private assertInvariants() {
    const ids = new Set<string>();
    const destinations = new Set<string>();
    for (const tab of this.state.tabs) {
      if (ids.has(tab.id)) throw new Error(`Duplicate tab id: ${tab.id}`);
      if (destinations.has(tab.destinationKey)) {
        throw new Error(`Duplicate destination: ${tab.destinationKey}`);
      }
      ids.add(tab.id);
      destinations.add(tab.destinationKey);
    }
    if (this.state.activeTabId !== null && !ids.has(this.state.activeTabId)) {
      throw new Error(`Active tab is missing: ${this.state.activeTabId}`);
    }
  }
}
