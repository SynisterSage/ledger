import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';

const prepareElectronDevelopmentPermissions = () => {
  if (process.platform !== 'darwin') return;
  const infoPlist = path.join(__dirname, 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
  if (!fs.existsSync(infoPlist)) return;
  const entries = {
    NSCalendarsUsageDescription: 'Ledger uses Calendar access to show events from calendars you choose.',
    NSCalendarsFullAccessUsageDescription: 'Ledger uses Calendar access to show events from calendars you choose.',
    NSRemindersFullAccessUsageDescription: 'Ledger uses Reminders access to show reminders from lists you choose.',
  };
  for (const [key, value] of Object.entries(entries)) {
    const plistValue = value.replaceAll("'", "\\'");
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string '${plistValue}'`, infoPlist], { stdio: 'ignore' });
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} '${plistValue}'`, infoPlist], { stdio: 'ignore' });
    }
  }
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isWebDevelopment = mode !== 'production' && process.env.LEDGER_DEV_TARGET === 'web';
  const isBrowserBuild = mode === 'web' || process.env.LEDGER_BUILD_TARGET === 'web';
  const isDevelopmentServer = mode !== 'production' && !isBrowserBuild;

  return ({
  // Electron opens the packaged renderer from file://. Relative public asset
  // URLs keep icons and other files inside the bundled dist directory. The
  // browser build is a separate target and must use normal absolute web paths.
  // Ledger Web is served beneath /app in production. Vite dev also serves
  // the browser shell at /app, so one base path keeps preview and production
  // asset URLs identical. Electron retains its relative file:// asset base.
  base: isBrowserBuild ? '/app/' : mode === 'production' ? './' : '/',
  ...(isDevelopmentServer
    ? {
        server: {
          proxy: {
            '/api': {
              target: process.env.LEDGER_DEV_API_TARGET?.trim() || 'https://api.ledgerworkspace.com',
              changeOrigin: true,
              secure: true,
              configure(proxy) {
                proxy.on('proxyReq', (proxyRequest) => {
                  // This is a local server-to-server hop. Do not forward the
                  // renderer's localhost Origin to the production CORS gate.
                  proxyRequest.removeHeader('origin');
                });
              },
            },
          },
        },
      }
    : {}),
  build: {
    copyPublicDir: true,
    outDir: isBrowserBuild ? 'dist-web' : 'dist',
  },
  plugins: [
    ...(mode === 'production' && !isBrowserBuild
      ? [
          {
            name: 'ledger-relative-public-assets',
            generateBundle: (_options: unknown, bundle: Record<string, { type: string; code?: string; source?: string }>) => {
              for (const output of Object.values(bundle)) {
                if (output.type === 'chunk' && output.code) {
                  output.code = output.code.replace(/(["'`])\/([^"'`\s)]+\.(?:svg|png|jpg|jpeg|gif|webp))\1/g, '$1./$2$1');
                } else if (output.type === 'asset' && typeof output.source === 'string') {
                  output.source = output.source.replace(/(["'])\/([^"'\s)]+\.(?:svg|png|jpg|jpeg|gif|webp))\1/g, '$1./$2$1');
                }
              }
            },
          },
        ]
      : []),
    react(),
    ...(isWebDevelopment || isBrowserBuild ? [] : [electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['node-window-manager'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              output: {
                // vite-plugin-electron emits this entry as preload.mjs. Keep
                // the generated module ESM so Electron does not execute a
                // CommonJS `require` inside an ES-module preload.
                format: 'es',
              },
            },
          },
        },
      },
      onstart: ({ startup }) => {
        if (process.env.VITE_LAUNCH_ELECTRON === '0') {
          return;
        }
        prepareElectronDevelopmentPermissions();
        startup();
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === 'test'
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    })]),
  ],
  });
});
