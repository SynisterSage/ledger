import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

assert.match(preload, /exposeInMainWorld\('ledgerIpc'/);
assert.doesNotMatch(preload, /exposeInMainWorld\('ipcRenderer'/);
assert.doesNotMatch(preload, /\b(on|off|send|invoke)\s*\(\.\.\.args\)/);
assert.match(preload, /const ledgerEventChannels = \{/);
assert.match(preload, /const ledgerCommands = \{/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /setWindowOpenHandler/);
assert.match(main, /will-navigate/);
assert.match(main, /window:open-external/);
assert.doesNotMatch(main, /setWindowOpenHandler\(\{[\s\S]{0,500}?shell\.openExternal/);
console.log('IPC security regression checks passed');
