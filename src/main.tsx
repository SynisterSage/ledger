import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { SidebarProvider } from './context/SidebarContext';
import './index.css';
import {
  applyDesktopCssVars,
  getSystemDesktopThemeScheme,
  resolveDesktopThemeScheme,
} from './theme/desktopTokens';

const loadStoredDesktopThemePreference = () => {
  if (typeof document === 'undefined') {
    return 'system' as const;
  }

  try {
    const raw = window.localStorage.getItem('ledger:settings:v1');
    if (!raw) return 'system' as const;
    const parsed = JSON.parse(raw) as { theme?: 'light' | 'dark' | 'system' } | null;
    return parsed?.theme ?? 'system';
  } catch {
    return 'system' as const;
  }
};

const applyDesktopThemeFromPreference = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const preference = loadStoredDesktopThemePreference();
  const scheme = resolveDesktopThemeScheme(preference, getSystemDesktopThemeScheme());
  applyDesktopCssVars(document.documentElement, scheme);
};

if (typeof document !== 'undefined') {
  applyDesktopThemeFromPreference();

  const handleThemeBroadcast = (
    _event: unknown,
    payload: { theme?: 'light' | 'dark' | 'system' } | null
  ) => {
    const preference = payload?.theme ?? loadStoredDesktopThemePreference();
    const scheme = resolveDesktopThemeScheme(preference, getSystemDesktopThemeScheme());
    applyDesktopCssVars(document.documentElement, scheme);
  };

  window.ipcRenderer?.on?.('ledger:theme-updated', handleThemeBroadcast as any);

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (_event: MediaQueryListEvent) => {
      applyDesktopThemeFromPreference();
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleThemeChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleThemeChange as never);
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <WorkspaceProvider>
        <SidebarProvider>
          <App />
        </SidebarProvider>
      </WorkspaceProvider>
    </AuthProvider>
  </React.StrictMode>
);
