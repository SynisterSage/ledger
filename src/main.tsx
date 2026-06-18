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
} from './theme/desktopTokens';

const applySystemTheme = () => {
  if (typeof document === 'undefined') {
    return;
  }

  applyDesktopCssVars(document.documentElement, getSystemDesktopThemeScheme());
};

if (typeof document !== 'undefined') {
  applySystemTheme();

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (_event: MediaQueryListEvent) => {
      applySystemTheme();
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
