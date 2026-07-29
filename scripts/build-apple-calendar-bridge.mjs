import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'native');
const output = path.join(outputDir, 'AppleCalendarBridge');
mkdirSync(outputDir, { recursive: true });
if (process.platform !== 'darwin') process.exit(0);
execFileSync('swiftc', ['-module-cache-path', path.join('/private/tmp', 'ledger-swift-module-cache'), '-O', '-framework', 'EventKit', '-framework', 'Foundation', path.join(outputDir, 'AppleCalendarBridge.swift'), '-o', output], { stdio: 'inherit' });
