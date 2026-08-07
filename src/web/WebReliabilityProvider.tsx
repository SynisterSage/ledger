import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useWorkspaceContext } from '../context/WorkspaceContext';

export type WebConnectionState = 'online' | 'offline' | 'reconnecting' | 'restored';
type WebEvent =
  | { type: 'signed-out' | 'session-expired'; source: string }
  | { type: 'workspace-changed'; source: string; workspaceId: string | null }
  | { type: 'resource-updated'; source: string; resource?: string; resourceId?: string };
type WebEventInput =
  | { type: 'signed-out' | 'session-expired' }
  | { type: 'workspace-changed'; workspaceId: string | null }
  | { type: 'resource-updated'; resource?: string; resourceId?: string };

type WebReliabilityValue = {
  connectionState: WebConnectionState;
  isOnline: boolean;
  broadcast: (event: WebEventInput) => void;
};

const WebReliabilityContext = createContext<WebReliabilityValue | undefined>(undefined);
const CHANNEL_NAME = 'ledger:web-coordination';
const STORAGE_EVENT_KEY = 'ledger:web-coordination:event';
const tabId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const WebReliabilityProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, signOut } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const sourceRef = useRef(tabId());
  const previousUserRef = useRef<string | null>(user?.id ?? null);
  const suppressAuthBroadcastRef = useRef(false);
  const [connectionState, setConnectionState] = useState<WebConnectionState>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'
  );

  const broadcast = (event: WebEventInput) => {
    if (typeof window === 'undefined') return;
    const payload = { ...event, source: sourceRef.current } as WebEvent;
    try {
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage(payload);
        channel.close();
      } else {
        globalThis.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(payload));
        globalThis.localStorage.removeItem(STORAGE_EVENT_KEY);
      }
    } catch {
      // Coordination is best effort; Supabase remains authoritative.
    }
  };

  useEffect(() => {
    const onOffline = () => setConnectionState('offline');
    const onOnline = () => {
      setConnectionState('reconnecting');
      const timer = window.setTimeout(() => setConnectionState('restored'), 350);
      window.setTimeout(() => setConnectionState('online'), 1800);
      return () => window.clearTimeout(timer);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const handleAuthTransition = () => {
      const previous = previousUserRef.current;
      const next = user?.id ?? null;
      if (previous && !next && !suppressAuthBroadcastRef.current) {
        broadcast({ type: 'signed-out' });
      }
      previousUserRef.current = next;
      suppressAuthBroadcastRef.current = false;
    };
    handleAuthTransition();
  }, [user?.id]);

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string | null; source?: string }>).detail;
      if (detail?.source === 'broadcast') return;
      broadcast({ type: 'workspace-changed', workspaceId: detail?.workspaceId ?? activeWorkspaceId });
    };
    window.addEventListener('ledger:workspace-changed', handleWorkspaceChange);
    return () => window.removeEventListener('ledger:workspace-changed', handleWorkspaceChange);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let channel: BroadcastChannel | null = null;
    const handleMessage = (event: MessageEvent<WebEvent>) => {
      const payload = event.data;
      if (!payload || payload.source === sourceRef.current) return;
      if (payload.type === 'workspace-changed') {
        window.localStorage.setItem('ledger:active-workspace-id', payload.workspaceId ?? '');
        window.dispatchEvent(new CustomEvent('ledger:workspace-broadcast', { detail: payload }));
      }
      if (payload.type === 'signed-out' || payload.type === 'session-expired') {
        suppressAuthBroadcastRef.current = true;
        void signOut().catch(() => undefined);
      }
      window.dispatchEvent(new CustomEvent('ledger:web-coordination', { detail: payload }));
    };
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', handleMessage);
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
      try { handleMessage({ data: JSON.parse(event.newValue) } as MessageEvent<WebEvent>); } catch { /* ignore malformed coordination data */ }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      channel?.removeEventListener('message', handleMessage);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [signOut]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine === false) setConnectionState('offline');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const value = useMemo(() => ({
    connectionState,
    isOnline: connectionState !== 'offline',
    broadcast,
  }), [connectionState]);

  const message = connectionState === 'offline'
    ? 'You are offline. Changes will stay in this form until you reconnect.'
    : connectionState === 'reconnecting'
    ? 'Reconnecting…'
    : connectionState === 'restored'
    ? 'Connection restored.'
    : null;

  return (
    <WebReliabilityContext.Provider value={value}>
      {message && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-2">
          <div className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-xs text-[var(--ledger-text-secondary)] shadow-[var(--ledger-shadow)]">
            {message}
          </div>
        </div>
      )}
      {children}
    </WebReliabilityContext.Provider>
  );
};

export const useWebReliability = () => {
  const value = useContext(WebReliabilityContext);
  if (!value) throw new Error('useWebReliability must be used within WebReliabilityProvider');
  return value;
};
