import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'dist', 'ui.html');
let html = await readFile(htmlPath, 'utf8');
const scriptMatch = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/i);
const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/i);
if (!scriptMatch || !styleMatch) throw new Error('Figma UI build assets were not found.');
const scriptPath = join(root, 'dist', scriptMatch[1].replace(/^\.\//, ''));
const stylePath = join(root, 'dist', styleMatch[1].replace(/^\.\//, ''));
const [script, style] = await Promise.all([readFile(scriptPath, 'utf8'), readFile(stylePath, 'utf8')]);
// Figma's document loader is more reliable when the compiled UI is self-contained.
// Escape script terminators inside the bundle so embedded strings cannot close the tag.
const safeScript = script.replace(/<\/script/gi, '<\\/script');
html = html
  .replace(scriptMatch[0], () => `<script>${safeScript}</script>`)
  .replace(styleMatch[0], () => `<style>${style}</style>`)
  .replace('<div id="root"></div>', '<div id="root"><div style="padding:24px;color:#6b7280;font:13px system-ui">Loading Ledger…</div></div>');
await writeFile(htmlPath, html);
