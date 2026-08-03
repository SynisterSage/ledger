import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function inlineEditorAssets(): Plugin {
  return { name: 'inline-editor-assets', apply: 'build', writeBundle() {
    const outDir = resolve(process.cwd(), '../mobile/assets/mobile-editor');
    const htmlPath = resolve(outDir, 'index.html');
    let html = readFileSync(htmlPath, 'utf8');
    const script = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
    if (script) { const scriptPath = resolve(outDir, script[1].replace(/^\//, '')); html = html.replace(script[0], () => `<script>${readFileSync(scriptPath, 'utf8')}</script>`); if (existsSync(scriptPath)) unlinkSync(scriptPath); }
    const styles = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
    if (styles) { const stylePath = resolve(outDir, styles[1].replace(/^\//, '')); html = html.replace(styles[0], () => `<style>${readFileSync(stylePath, 'utf8')}</style>`); if (existsSync(stylePath)) unlinkSync(stylePath); }
    const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
    if (inlineScript) html = html.replace(inlineScript[0], '').replace(/\n[ \t]*\n[ \t]*(?=<style>)/, '\n').replace('</body>', `${inlineScript[0]}\n  </body>`);
    writeFileSync(htmlPath, html);
  } };
}

export default defineConfig({
  plugins: [react(), inlineEditorAssets()],
  base: './',
  build: { outDir: resolve(process.cwd(), '../mobile/assets/mobile-editor'), emptyOutDir: true, assetsInlineLimit: 10_000_000 },
});
