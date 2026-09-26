import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (process.platform !== 'darwin') process.exit(0);

const source = path.join(root, 'native', 'LedgerWidget', 'LedgerWidget.swift');
const refreshSource = path.join(root, 'native', 'LedgerWidgetRefreshBridge.swift');
const sourceInfo = path.join(root, 'native', 'LedgerWidget', 'Info.plist');
const outputRoot = path.join(root, 'native', '.build');
const appex = path.join(outputRoot, 'LedgerWidget.appex');
const executable = path.join(appex, 'Contents', 'MacOS', 'LedgerWidget');
const refreshExecutable = path.join(outputRoot, 'LedgerWidgetRefreshBridge');
const info = path.join(appex, 'Contents', 'Info.plist');
const moduleCachePath = path.join('/private/tmp', 'ledger-widget-module-cache');
const swiftTarget = 'arm64-apple-macosx13.0';

rmSync(appex, { recursive: true, force: true });
mkdirSync(path.dirname(executable), { recursive: true });
copyFileSync(sourceInfo, info);
writeFileSync(info, readFileSync(info, 'utf8').replaceAll('$(EXECUTABLE_NAME)', 'LedgerWidget'));

execFileSync(
  'swiftc',
  [
    '-module-cache-path',
    moduleCachePath,
    '-target',
    swiftTarget,
    '-parse-as-library',
    '-O',
    '-framework',
    'Foundation',
    '-framework',
    'SwiftUI',
    '-framework',
    'WidgetKit',
    source,
    '-o',
    executable,
  ],
  { stdio: 'inherit' }
);

execFileSync(
  'swiftc',
  [
    '-module-cache-path',
    moduleCachePath,
    '-target',
    swiftTarget,
    '-O',
    '-framework',
    'WidgetKit',
    refreshSource,
    '-o',
    refreshExecutable,
  ],
  { stdio: 'inherit' }
);

console.log(`[mac-widget] built ${path.relative(root, appex)}`);
