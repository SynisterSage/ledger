// vite.config.ts
import { defineConfig } from "file:///Users/lex/Desktop/ledger/node_modules/vite/dist/node/index.js";
import path from "node:path";
import electron from "file:///Users/lex/Desktop/ledger/node_modules/vite-plugin-electron/dist/simple.mjs";
import react from "file:///Users/lex/Desktop/ledger/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_dirname = "/Users/lex/Desktop/ledger";
var vite_config_default = defineConfig(({ mode }) => ({
  // Electron opens the packaged renderer from file://. Relative public asset
  // URLs keep icons and other files inside the bundled dist directory.
  base: mode === "production" ? "./" : "/",
  build: {
    copyPublicDir: true
  },
  plugins: [
    ...mode === "production" ? [
      {
        name: "ledger-relative-public-assets",
        generateBundle: (_options, bundle) => {
          for (const output of Object.values(bundle)) {
            if (output.type === "chunk" && output.code) {
              output.code = output.code.replace(/(["'`])\/([^"'`\s)]+\.(?:svg|png|jpg|jpeg|gif|webp))\1/g, "$1./$2$1");
            } else if (output.type === "asset" && typeof output.source === "string") {
              output.source = output.source.replace(/(["'])\/([^"'\s)]+\.(?:svg|png|jpg|jpeg|gif|webp))\1/g, "$1./$2$1");
            }
          }
        }
      }
    ] : [],
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["node-window-manager"]
            }
          }
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__vite_injected_original_dirname, "electron/preload.ts")
      },
      onstart: ({ startup }) => {
        if (process.env.VITE_LAUNCH_ELECTRON === "0") {
          return;
        }
        startup();
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === "test" ? (
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        void 0
      ) : {}
    })
  ]
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbGV4L0Rlc2t0b3AvbGVkZ2VyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbGV4L0Rlc2t0b3AvbGVkZ2VyL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9sZXgvRGVza3RvcC9sZWRnZXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgZWxlY3Ryb24gZnJvbSAndml0ZS1wbHVnaW4tZWxlY3Ryb24vc2ltcGxlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiAoe1xuICAvLyBFbGVjdHJvbiBvcGVucyB0aGUgcGFja2FnZWQgcmVuZGVyZXIgZnJvbSBmaWxlOi8vLiBSZWxhdGl2ZSBwdWJsaWMgYXNzZXRcbiAgLy8gVVJMcyBrZWVwIGljb25zIGFuZCBvdGhlciBmaWxlcyBpbnNpZGUgdGhlIGJ1bmRsZWQgZGlzdCBkaXJlY3RvcnkuXG4gIGJhc2U6IG1vZGUgPT09ICdwcm9kdWN0aW9uJyA/ICcuLycgOiAnLycsXG4gIGJ1aWxkOiB7XG4gICAgY29weVB1YmxpY0RpcjogdHJ1ZSxcbiAgfSxcbiAgcGx1Z2luczogW1xuICAgIC4uLihtb2RlID09PSAncHJvZHVjdGlvbidcbiAgICAgID8gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdsZWRnZXItcmVsYXRpdmUtcHVibGljLWFzc2V0cycsXG4gICAgICAgICAgICBnZW5lcmF0ZUJ1bmRsZTogKF9vcHRpb25zOiB1bmtub3duLCBidW5kbGU6IFJlY29yZDxzdHJpbmcsIHsgdHlwZTogc3RyaW5nOyBjb2RlPzogc3RyaW5nOyBzb3VyY2U/OiBzdHJpbmcgfT4pID0+IHtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBvdXRwdXQgb2YgT2JqZWN0LnZhbHVlcyhidW5kbGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKG91dHB1dC50eXBlID09PSAnY2h1bmsnICYmIG91dHB1dC5jb2RlKSB7XG4gICAgICAgICAgICAgICAgICBvdXRwdXQuY29kZSA9IG91dHB1dC5jb2RlLnJlcGxhY2UoLyhbXCInYF0pXFwvKFteXCInYFxccyldK1xcLig/OnN2Z3xwbmd8anBnfGpwZWd8Z2lmfHdlYnApKVxcMS9nLCAnJDEuLyQyJDEnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG91dHB1dC50eXBlID09PSAnYXNzZXQnICYmIHR5cGVvZiBvdXRwdXQuc291cmNlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgb3V0cHV0LnNvdXJjZSA9IG91dHB1dC5zb3VyY2UucmVwbGFjZSgvKFtcIiddKVxcLyhbXlwiJ1xccyldK1xcLig/OnN2Z3xwbmd8anBnfGpwZWd8Z2lmfHdlYnApKVxcMS9nLCAnJDEuLyQyJDEnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXVxuICAgICAgOiBbXSksXG4gICAgcmVhY3QoKSxcbiAgICBlbGVjdHJvbih7XG4gICAgICBtYWluOiB7XG4gICAgICAgIC8vIFNob3J0Y3V0IG9mIGBidWlsZC5saWIuZW50cnlgLlxuICAgICAgICBlbnRyeTogJ2VsZWN0cm9uL21haW4udHMnLFxuICAgICAgICB2aXRlOiB7XG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsnbm9kZS13aW5kb3ctbWFuYWdlciddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHByZWxvYWQ6IHtcbiAgICAgICAgLy8gU2hvcnRjdXQgb2YgYGJ1aWxkLnJvbGx1cE9wdGlvbnMuaW5wdXRgLlxuICAgICAgICAvLyBQcmVsb2FkIHNjcmlwdHMgbWF5IGNvbnRhaW4gV2ViIGFzc2V0cywgc28gdXNlIHRoZSBgYnVpbGQucm9sbHVwT3B0aW9ucy5pbnB1dGAgaW5zdGVhZCBgYnVpbGQubGliLmVudHJ5YC5cbiAgICAgICAgaW5wdXQ6IHBhdGguam9pbihfX2Rpcm5hbWUsICdlbGVjdHJvbi9wcmVsb2FkLnRzJyksXG4gICAgICB9LFxuICAgICAgb25zdGFydDogKHsgc3RhcnR1cCB9KSA9PiB7XG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5WSVRFX0xBVU5DSF9FTEVDVFJPTiA9PT0gJzAnKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHN0YXJ0dXAoKTtcbiAgICAgIH0sXG4gICAgICAvLyBQbG95ZmlsbCB0aGUgRWxlY3Ryb24gYW5kIE5vZGUuanMgQVBJIGZvciBSZW5kZXJlciBwcm9jZXNzLlxuICAgICAgLy8gSWYgeW91IHdhbnQgdXNlIE5vZGUuanMgaW4gUmVuZGVyZXIgcHJvY2VzcywgdGhlIGBub2RlSW50ZWdyYXRpb25gIG5lZWRzIHRvIGJlIGVuYWJsZWQgaW4gdGhlIE1haW4gcHJvY2Vzcy5cbiAgICAgIC8vIFNlZSBcdUQ4M0RcdURDNDkgaHR0cHM6Ly9naXRodWIuY29tL2VsZWN0cm9uLXZpdGUvdml0ZS1wbHVnaW4tZWxlY3Ryb24tcmVuZGVyZXJcbiAgICAgIHJlbmRlcmVyOlxuICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ3Rlc3QnXG4gICAgICAgICAgPyAvLyBodHRwczovL2dpdGh1Yi5jb20vZWxlY3Ryb24tdml0ZS92aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlci9pc3N1ZXMvNzgjaXNzdWVjb21tZW50LTIwNTM2MDA4MDhcbiAgICAgICAgICAgIHVuZGVmaW5lZFxuICAgICAgICAgIDoge30sXG4gICAgfSksXG4gIF0sXG59KSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTZQLFNBQVMsb0JBQW9CO0FBQzFSLE9BQU8sVUFBVTtBQUNqQixPQUFPLGNBQWM7QUFDckIsT0FBTyxXQUFXO0FBSGxCLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUE7QUFBQTtBQUFBLEVBR3pDLE1BQU0sU0FBUyxlQUFlLE9BQU87QUFBQSxFQUNyQyxPQUFPO0FBQUEsSUFDTCxlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLEdBQUksU0FBUyxlQUNUO0FBQUEsTUFDRTtBQUFBLFFBQ0UsTUFBTTtBQUFBLFFBQ04sZ0JBQWdCLENBQUMsVUFBbUIsV0FBNkU7QUFDL0cscUJBQVcsVUFBVSxPQUFPLE9BQU8sTUFBTSxHQUFHO0FBQzFDLGdCQUFJLE9BQU8sU0FBUyxXQUFXLE9BQU8sTUFBTTtBQUMxQyxxQkFBTyxPQUFPLE9BQU8sS0FBSyxRQUFRLDJEQUEyRCxVQUFVO0FBQUEsWUFDekcsV0FBVyxPQUFPLFNBQVMsV0FBVyxPQUFPLE9BQU8sV0FBVyxVQUFVO0FBQ3ZFLHFCQUFPLFNBQVMsT0FBTyxPQUFPLFFBQVEseURBQXlELFVBQVU7QUFBQSxZQUMzRztBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0YsSUFDQSxDQUFDO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsTUFDUCxNQUFNO0FBQUE7QUFBQSxRQUVKLE9BQU87QUFBQSxRQUNQLE1BQU07QUFBQSxVQUNKLE9BQU87QUFBQSxZQUNMLGVBQWU7QUFBQSxjQUNiLFVBQVUsQ0FBQyxxQkFBcUI7QUFBQSxZQUNsQztBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsU0FBUztBQUFBO0FBQUE7QUFBQSxRQUdQLE9BQU8sS0FBSyxLQUFLLGtDQUFXLHFCQUFxQjtBQUFBLE1BQ25EO0FBQUEsTUFDQSxTQUFTLENBQUMsRUFBRSxRQUFRLE1BQU07QUFDeEIsWUFBSSxRQUFRLElBQUkseUJBQXlCLEtBQUs7QUFDNUM7QUFBQSxRQUNGO0FBQ0EsZ0JBQVE7QUFBQSxNQUNWO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJQSxVQUNFLFFBQVEsSUFBSSxhQUFhO0FBQUE7QUFBQSxRQUVyQjtBQUFBLFVBQ0EsQ0FBQztBQUFBLElBQ1QsQ0FBQztBQUFBLEVBQ0g7QUFDRixFQUFFOyIsCiAgIm5hbWVzIjogW10KfQo=
