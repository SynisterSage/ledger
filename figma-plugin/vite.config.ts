import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('./src/ui/ui.html', import.meta.url)) } },
  define: { __LEDGER_API_ORIGIN__: JSON.stringify(process.env.VITE_API_URL || 'https://api.ledgerworkspace.com') },
});
