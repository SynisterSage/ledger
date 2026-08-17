import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { AppShell } from '../App';
import { NotificationCenterProvider } from '../components/Notifications/NotificationCenterContext';
import { NotificationMonitor } from '../components/Common/NotificationMonitor';
import { SearchModal } from '../components/Search/SearchModal';
import { SearchProvider } from '../context/SearchContext';
import { ToastProvider, useToast } from '../components/Common/ToastProvider';
import { useWorkspaceContext } from '../context/WorkspaceContext';
import { usePlatform, type LedgerWorkspaceRoute } from '../platform';
import { WebShellLayout } from './WebSidebar';
import { WebModuleHost } from './WebModuleHost';
import { parseWebLocation, useWebRouteState } from './webRouteState';
import { QuickCaptureWindow } from '../components/Common/QuickCaptureWindow';
import SettingsWindow from '../components/Settings/SettingsWindow';
import { WebReliabilityProvider } from './WebReliabilityProvider';
import {
  NotificationTray,
  NOTIFICATION_TRAY_TOGGLE_EVENT,
} from '../components/Notifications/NotificationTray';
import { runtimeConfig } from '../config/runtime';

const WEB_DOWNLOAD_TOAST_DISMISSED = 'ledger:web-download-toast-dismissed:v1';

const WebDownloadToast = () => {
  const { activeWorkspaceId } = useWorkspaceContext();
  const [dismissed, setDismissed] = useState(false);
  const isNewTabRoute = typeof window !== 'undefined' && /\/app\/w\/[^/]+\/home(?:\/|$)/.test(window.location.pathname);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(WEB_DOWNLOAD_TOAST_DISMISSED) === 'true');
    } catch {
      // Storage is optional; the toast can still be dismissed for this session.
    }
  }, []);

  if (!activeWorkspaceId || dismissed || isNewTabRoute) return null;
  const downloadUrl = `${(runtimeConfig.ledgerWebUrl || 'https://ledgerworkspace.com').replace(/\/$/, '')}/download`;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(WEB_DOWNLOAD_TOAST_DISMISSED, 'true');
    } catch {
      // Ignore unavailable browser storage.
    }
  };

  return (
    <aside className="fixed bottom-5 right-5 z-[60] w-[min(340px,calc(100vw-2rem))] rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3.5 shadow-[0_14px_36px_rgba(17,24,39,0.16)]" role="status" aria-label="Download Ledger">
      <button type="button" onClick={dismiss} aria-label="Dismiss download Ledger message" className="absolute right-2.5 top-2.5 rounded-md p-1 text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]">
        <X size={14} />
      </button>
      <div className="flex items-start gap-3 pr-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]">
          <Download size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">Download Ledger for desktop</p>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ledger-text-muted)]">Keep Ledger beside the work you’re doing.</p>
          <a href={downloadUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-[var(--ledger-text-secondary)] underline decoration-[var(--ledger-border-strong)] underline-offset-2 transition hover:text-[var(--ledger-text-primary)]">Get the desktop app</a>
        </div>
      </div>
    </aside>
  );
};

const Status = ({ children, error = false }: { children: string; error?: boolean }) => (
  <div
    className={`flex h-screen items-center justify-center bg-[var(--ledger-background)] px-6 text-center text-sm ${
      error ? 'text-[var(--ledger-danger)]' : 'text-[var(--ledger-text-muted)]'
    }`}
  >
    {children}
  </div>
);

const LoadingScreen = () => (
  <div
    className="flex min-h-screen items-center justify-center bg-[var(--ledger-background)]"
    role="status"
    aria-label="Loading Ledger"
  >
    <img
      src={`${import.meta.env.BASE_URL}logo-color.svg`}
      alt="Ledger"
      className="h-10 w-10 select-none"
    />
  </div>
);

const WorkspaceSelection = ({ requestedRoute }: { requestedRoute?: LedgerWorkspaceRoute }) => {
  const platform = usePlatform();
  const { workspaces, setActiveWorkspace } = useWorkspaceContext();
  const toast = useToast();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ledger-background)] px-6 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]">
        <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Ledger workspace</p>
        <h1 className="mt-2 text-2xl font-normal text-[var(--ledger-text-primary)]">
          Choose a workspace
        </h1>
        <p className="mt-2 text-sm text-[var(--ledger-text-muted)]">
          Select where you want to continue.
        </p>
        <div className="mt-6 space-y-2">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => {
                void setActiveWorkspace(workspace.id)
                  .then(() => {
                    platform.navigation.openRoute({
                      kind: 'workspace',
                      workspaceId: requestedRoute?.workspaceId ?? workspace.id,
                      page:
                        requestedRoute?.page === 'dashboard'
                          ? 'dashboard'
                          : requestedRoute?.page === 'today'
                          ? 'today'
                          : 'home',
                      ...(requestedRoute?.page === 'dashboard'
                        ? { query: requestedRoute.query }
                        : {}),
                    });
                  })
                  .catch((error: unknown) =>
                    toast.show('Could not switch workspace', {
                      detail: error instanceof Error ? error.message : 'Please try again.',
                      variant: 'error',
                    })
                  );
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-4 py-3 text-left transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)]"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: workspace.color ?? 'var(--ledger-accent)' }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">
                  {workspace.name}
                </span>
                <span className="block text-xs text-[var(--ledger-text-muted)]">
                  {workspace.is_personal ? 'Personal' : 'Team'} · {workspace.role}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const WebAuthenticatedContent = () => {
  const platform = usePlatform();
  const { activeWorkspaceId, workspaces, isLoading, setActiveWorkspace } = useWorkspaceContext();
  const locationState = useWebRouteState();

  useEffect(() => {
    if (locationState.kind === 'app-root' && activeWorkspaceId) {
      platform.navigation.openRoute(
        { kind: 'workspace', workspaceId: activeWorkspaceId, page: 'home' },
        { replace: true }
      );
      return;
    }
    if (locationState.kind === 'workspace-root') {
      platform.navigation.openRoute(
        { kind: 'workspace', workspaceId: locationState.workspaceId, page: 'home' },
        { replace: true }
      );
      return;
    }
    const requestedWorkspaceId =
      locationState.kind === 'route' && locationState.route.kind === 'workspace'
        ? locationState.route.workspaceId
        : locationState.kind === 'overlay'
        ? locationState.route.workspaceId
        : null;
    if (requestedWorkspaceId) {
      const requestedWorkspace = workspaces.find(
        (workspace) => workspace.id === requestedWorkspaceId
      );
      if (requestedWorkspace && requestedWorkspace.id !== activeWorkspaceId && !isLoading) {
        void setActiveWorkspace(requestedWorkspace.id);
      }
    }
  }, [
    activeWorkspaceId,
    isLoading,
    locationState,
    platform.navigation,
    setActiveWorkspace,
    workspaces,
  ]);

  if (locationState.kind === 'app-settings') {
    return (
      <WebShellLayout>
        <SettingsWindow
          initialSection={
            locationState.section === 'browser-extension' ? 'integrations' : locationState.section
          }
        />
      </WebShellLayout>
    );
  }
  if (locationState.kind === 'app-root' || locationState.kind === 'app-page') {
    if (locationState.kind === 'app-page' && locationState.page === 'onboarding') {
      return <Status>Onboarding is already complete for this account.</Status>;
    }
    if (isLoading) return <LoadingScreen />;
    if (workspaces.length === 0)
      return <Status>No workspace found. Start onboarding to continue.</Status>;
    return <WorkspaceSelection />;
  }
  if (locationState.kind === 'invite') return <Status>Processing your invitation…</Status>;
  if (locationState.kind === 'overlay') {
    if (isLoading) return <LoadingScreen />;
    const hasOverlayAccess = workspaces.some(
      (workspace) => workspace.id === locationState.route.workspaceId
    );
    if (!hasOverlayAccess) return <Status error>You do not have access to this workspace.</Status>;
    if (activeWorkspaceId !== locationState.route.workspaceId)
      return <LoadingScreen />;
    const backgroundState = locationState.backgroundPath
      ? parseWebLocation(new URL(locationState.backgroundPath, window.location.origin))
      : null;
    const backgroundRoute =
      backgroundState?.kind === 'route' && backgroundState.route.kind === 'workspace'
        ? backgroundState.route
        : {
            kind: 'workspace' as const,
            workspaceId: routeWorkspaceId(locationState.route.workspaceId),
            page: 'home' as const,
          };
    const context =
      locationState.route.page === 'capture'
        ? locationState.route.context ??
          (locationState.route.projectId
            ? `ledger-selection|||${locationState.route.projectId}`
            : undefined)
        : locationState.route.entityId;
    return (
      <WebShellLayout>
        <WebModuleHost route={backgroundRoute} />
        <div className="absolute inset-0 z-50 flex min-h-0 items-center justify-center bg-[var(--ledger-backdrop)] p-6">
          <div className="flex max-h-[calc(100vh-48px)] min-h-0 w-full max-w-xl overflow-hidden rounded-[var(--ledger-window-radius)]">
            <QuickCaptureWindow
              browserMode
              kind={
                locationState.route.page === 'follow-up'
                  ? 'quick-follow-up'
                  : (`quick-${locationState.route.action}` as
                      | 'quick-note'
                      | 'quick-task'
                      | 'quick-event'
                      | 'quick-reminder')
              }
              context={context}
              initialDate={
                locationState.route.page === 'capture' ? locationState.route.date : undefined
              }
            />
          </div>
        </div>
      </WebShellLayout>
    );
  }
  if (locationState.kind === 'workspace-root') return <LoadingScreen />;
  if (locationState.kind === 'unknown') return <Status error>Ledger route not found.</Status>;
  if (locationState.route.kind !== 'workspace')
    return <Status error>Ledger route is not available here.</Status>;

  const route = locationState.route;
  if (isLoading) return <LoadingScreen />;
  const hasAccess = workspaces.some((workspace) => workspace.id === route.workspaceId);
  if (!hasAccess) return <Status error>You do not have access to this workspace.</Status>;
  const workspace = workspaces.find((candidate) => candidate.id === route.workspaceId);
  if (
    workspace?.is_personal &&
    (route.page === 'circle' || route.page === 'teams' || route.page === 'team')
  ) {
    return (
      <Status error>{`${
        route.page === 'circle' ? 'Circle' : 'Teams'
      } is available in team workspaces only.`}</Status>
    );
  }
  if (activeWorkspaceId !== route.workspaceId)
    return <LoadingScreen />;

  return (
    <WebShellLayout>
      <WebModuleHost route={route} />
    </WebShellLayout>
  );
};

const routeWorkspaceId = (workspaceId: string) => workspaceId;

export const WebAppShell = () => {
  const [isNotificationTrayOpen, setIsNotificationTrayOpen] = useState(false);

  useEffect(() => {
    const handleToggleNotificationTray = () => setIsNotificationTrayOpen((current) => !current);
    window.addEventListener(NOTIFICATION_TRAY_TOGGLE_EVENT, handleToggleNotificationTray);
    return () =>
      window.removeEventListener(NOTIFICATION_TRAY_TOGGLE_EVENT, handleToggleNotificationTray);
  }, []);

  return (
    <div data-platform="web" className="web-app-root">
      <WebReliabilityProvider>
        <SearchProvider>
          <ToastProvider>
            <NotificationCenterProvider>
              <NotificationMonitor />
              <AppShell browserMode browserContent={<WebAuthenticatedContent />} />
              <WebDownloadToast />
              <NotificationTray
                isOpen={isNotificationTrayOpen}
                onClose={() => setIsNotificationTrayOpen(false)}
              />
              <SearchModal />
            </NotificationCenterProvider>
          </ToastProvider>
        </SearchProvider>
      </WebReliabilityProvider>
    </div>
  );
};
