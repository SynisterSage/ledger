/**
 * Platform-neutral state for Ledger's browser-like workspace tabs.
 *
 * This module deliberately has no Electron, React, or browser-history
 * dependencies. Desktop IPC and web URL adapters can both project the same
 * state machine and reject stale commands by revision.
 */

export type TabRoute = {
  kind: string;
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusInboxId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};

export type TabSession = {
  id: string;
  destinationKey: string;
  route: TabRoute;
  title: string;
  backStack: TabRoute[];
  forwardStack: TabRoute[];
};

export type TabSessionState = {
  workspaceId: string;
  revision: number;
  activeTabId: string | null;
  tabs: TabSession[];
};

export type TabSessionAction =
  | { type: 'open'; tab: TabSession; select?: boolean; expectedRevision?: number }
  | { type: 'select'; tabId: string; expectedRevision?: number }
  | { type: 'navigate'; tabId: string; route: TabRoute; pushHistory?: boolean; expectedRevision?: number }
  | { type: 'close'; tabId: string; expectedRevision?: number }
  | { type: 'back' | 'forward'; tabId: string; expectedRevision?: number }
  | { type: 'rename'; tabId: string; title: string; expectedRevision?: number }
  | { type: 'reorder'; tabId: string; toIndex: number; expectedRevision?: number };

export type TabSessionReduction = {
  state: TabSessionState;
  accepted: boolean;
  reason?: 'stale-revision' | 'missing-tab' | 'duplicate-destination' | 'invalid-index';
};

const routeValue = (route: TabRoute, key: keyof TabRoute) => route[key] ?? null;

export const sameTabRoute = (left: TabRoute, right: TabRoute) =>
  left.kind === right.kind &&
  (routeValue(left, 'focusDate') === routeValue(right, 'focusDate')) &&
  (routeValue(left, 'focusProjectId') === routeValue(right, 'focusProjectId')) &&
  (routeValue(left, 'focusNoteId') === routeValue(right, 'focusNoteId')) &&
  (routeValue(left, 'focusTaskId') === routeValue(right, 'focusTaskId')) &&
  (routeValue(left, 'focusInboxId') === routeValue(right, 'focusInboxId')) &&
  (routeValue(left, 'focusContext') === routeValue(right, 'focusContext')) &&
  (routeValue(left, 'focusSection') === routeValue(right, 'focusSection'));

const cloneRoute = (route: TabRoute): TabRoute => ({ ...route });
const cloneTab = (tab: TabSession): TabSession => ({
  ...tab,
  route: cloneRoute(tab.route),
  backStack: tab.backStack.map(cloneRoute),
  forwardStack: tab.forwardStack.map(cloneRoute),
});

const cloneState = (state: TabSessionState): TabSessionState => ({
  ...state,
  tabs: state.tabs.map(cloneTab),
});

const reject = (state: TabSessionState, reason: TabSessionReduction['reason']): TabSessionReduction => ({
  state,
  accepted: false,
  reason,
});

export const reduceTabSession = (
  state: TabSessionState,
  action: TabSessionAction
): TabSessionReduction => {
  if (action.expectedRevision !== undefined && action.expectedRevision !== state.revision) {
    return reject(state, 'stale-revision');
  }

  const next = cloneState(state);
  const bump = () => {
    next.revision += 1;
    return { state: next, accepted: true } satisfies TabSessionReduction;
  };

  if (action.type === 'open') {
    if (next.tabs.some((tab) => tab.id === action.tab.id)) return reject(state, 'duplicate-destination');
    const existing = next.tabs.find((tab) => tab.destinationKey === action.tab.destinationKey);
    if (existing) {
      if (action.select !== false) next.activeTabId = existing.id;
      return bump();
    }
    next.tabs.push(cloneTab(action.tab));
    if (action.select !== false || next.activeTabId === null) next.activeTabId = action.tab.id;
    return bump();
  }

  const tabIndex = next.tabs.findIndex((tab) => tab.id === action.tabId);
  if (tabIndex < 0) return reject(state, 'missing-tab');
  const tab = next.tabs[tabIndex];

  if (action.type === 'select') {
    next.activeTabId = action.tabId;
    return bump();
  }

  if (action.type === 'rename') {
    next.tabs[tabIndex].title = action.title.trim() || next.tabs[tabIndex].title;
    return bump();
  }

  if (action.type === 'navigate') {
    if (action.pushHistory !== false && !sameTabRoute(tab.route, action.route)) {
      tab.backStack.push(cloneRoute(tab.route));
      tab.forwardStack = [];
    }
    tab.route = cloneRoute(action.route);
    next.activeTabId = action.tabId;
    return bump();
  }

  if (action.type === 'close') {
    next.tabs.splice(tabIndex, 1);
    if (next.activeTabId === action.tabId) {
      const fallback = next.tabs[tabIndex - 1] ?? next.tabs[tabIndex] ?? null;
      next.activeTabId = fallback?.id ?? null;
    }
    return bump();
  }

  if (action.type === 'back' || action.type === 'forward') {
    const source = action.type === 'back' ? tab.backStack : tab.forwardStack;
    const destination = source.pop();
    if (!destination) return reject(state, 'missing-tab');
    const opposite = action.type === 'back' ? tab.forwardStack : tab.backStack;
    opposite.push(cloneRoute(tab.route));
    tab.route = cloneRoute(destination);
    next.activeTabId = action.tabId;
    return bump();
  }

  if (action.type !== 'reorder') return reject(state, 'missing-tab');
  if (!Number.isInteger(action.toIndex) || action.toIndex < 0 || action.toIndex >= next.tabs.length) {
    return reject(state, 'invalid-index');
  }
  const [movedTab] = next.tabs.splice(tabIndex, 1);
  next.tabs.splice(action.toIndex, 0, movedTab);
  return bump();
};
