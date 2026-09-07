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
  const bridgeBundle = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'AppleCalendarBridge.app',
  );
  verifyDeploymentTarget(path.join(bridgeBundle, 'Contents', 'MacOS', 'AppleCalendarBridge'));
  execFileSync('codesign', ['--verify', '--deep', '--strict', bridgeBundle], { stdio: 'inherit' });
  execFileSync('codesign', ['-d', '--entitlements', '-', bridgeBundle], { stdio: 'inherit' });
}
