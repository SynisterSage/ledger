import { execFileSync } from 'node:child_process';
import path from 'node:path';

const minimumSupportedMacOS = 13;

function verifyDeploymentTarget(executable) {
  const loadCommands = execFileSync('otool', ['-l', executable], { encoding: 'utf8' });
  const match = loadCommands.match(/LC_BUILD_VERSION[\s\S]*?minos\s+(\d+)(?:\.(\d+))?/);
  if (!match) throw new Error(`Could not read the macOS deployment target from ${executable}.`);
  const target = Number(`${match[1]}.${match[2] ?? '0'}`);
  if (target > minimumSupportedMacOS) {
    throw new Error(`${path.basename(executable)} targets macOS ${target}; expected <= ${minimumSupportedMacOS}.0.`);
  }
}

export default async function verifyAppleCalendarBridge(context) {
  if (context.packager.platform.name !== 'mac') return;
  const appBundle = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const bridgeBundle = path.join(
    appBundle,
    'Contents',
    'Resources',
    'AppleCalendarBridge.app',
  );
  verifyDeploymentTarget(path.join(bridgeBundle, 'Contents', 'MacOS', 'AppleCalendarBridge'));
  execFileSync('codesign', ['--verify', '--deep', '--strict', bridgeBundle], { stdio: 'inherit' });
  execFileSync('codesign', ['-d', '--entitlements', '-', bridgeBundle], { stdio: 'inherit' });

  const widgetBundle = path.join(
    appBundle,
    'Contents',
    'PlugIns',
    'LedgerWidget.appex',
  );
  // afterPack signs the nested extension before Electron Builder signs and
  // notarizes the outer app. Verify the final result without modifying it.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', widgetBundle], { stdio: 'inherit' });
  const widgetEntitlementsOutput = execFileSync(
    'codesign',
    ['-d', '--entitlements', '-', widgetBundle],
    { encoding: 'utf8' },
  );
  if (!widgetEntitlementsOutput.includes('com.apple.security.app-sandbox') ||
      !widgetEntitlementsOutput.includes('group.com.ledger.desktop.shared')) {
    throw new Error('LedgerWidget.appex is missing its sandbox or App Group entitlement.');
  }
}
