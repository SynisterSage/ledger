import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (!manifest.name || !manifest.id || !manifest.main || !manifest.ui) throw new Error('Manifest requires name, id, main, and ui');
if (!Array.isArray(manifest.editorType) || !manifest.editorType.includes('figma')) throw new Error('Manifest must target the Figma editor');
if (!manifest.networkAccess?.allowedDomains?.length) throw new Error('Manifest must restrict network domains');
if (manifest.networkAccess.allowedDomains.some((domain) => domain === '*')) throw new Error('Wildcard network access is not allowed');
console.log('Figma plugin manifest is valid.');
