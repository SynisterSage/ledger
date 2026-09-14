import { TabSessionController, type TabSessionListener } from './tabSessionController.ts';
import type { TabRoute, TabSessionState } from './tabSessionState.ts';

export type WebTabSessionAdapterOptions = {
  storageKey: string;
  readRoute: () => TabRoute | null;
  writeRoute: (route: TabRoute, replace: boolean) => void;
};

/** Browser-history adapter for the shared tab-session controller. */
export class WebTabSessionAdapter {
  readonly controller: TabSessionController;
  private readonly options: WebTabSessionAdapterOptions;
  private readonly storage: Storage | null;

  constructor(options: WebTabSessionAdapterOptions, workspaceId: string) {
    this.options = options;
    this.storage = typeof window === 'undefined' ? null : window.sessionStorage;
    const restored = this.restore(workspaceId);
    this.controller = new TabSessionController(restored);
  }

  subscribe(listener: TabSessionListener) {
    return this.controller.subscribe((state, action) => {
      this.persist(state);
      listener(state, action);
    });
  }

  select(tabId: string) {
    const result = this.controller.select(tabId);
    if (result.accepted) this.options.writeRoute(this.routeForActive(), true);
    return result;
  }

  navigate(tabId: string, route: TabRoute, replace = false) {
    const result = this.controller.navigate(tabId, route, !replace);
    if (result.accepted) this.options.writeRoute(route, replace);
    return result;
  }

  applyPopState(route: TabRoute) {
    const activeTabId = this.controller.getSnapshot().activeTabId;
    if (!activeTabId) return false;
    return this.controller.navigate(activeTabId, route, false).accepted;
  }

  private routeForActive() {
    const snapshot = this.controller.getSnapshot();
    return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)?.route ?? this.options.readRoute() ?? { kind: 'new-tab' };
  }

  private restore(workspaceId: string): TabSessionState {
    const fallback: TabSessionState = {
      workspaceId,
      revision: 0,
      activeTabId: null,
      tabs: [],
    };
    if (!this.storage) return fallback;
    try {
      const parsed = JSON.parse(this.storage.getItem(this.options.storageKey) ?? 'null') as Partial<TabSessionState> | null;
      if (!parsed || parsed.workspaceId !== workspaceId || !Array.isArray(parsed.tabs)) return fallback;
      return {
        workspaceId,
        revision: Number.isSafeInteger(parsed.revision) ? Number(parsed.revision) : 0,
        activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
        tabs: parsed.tabs as TabSessionState['tabs'],
      };
    } catch {
      return fallback;
    }
  }

  private persist(state: TabSessionState) {
    try {
      this.storage?.setItem(this.options.storageKey, JSON.stringify(state));
    } catch {
      // Browser privacy settings can disable sessionStorage; memory remains valid.
    }
  }
}

