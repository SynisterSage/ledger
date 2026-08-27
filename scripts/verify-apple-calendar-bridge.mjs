import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default async function verifyAppleCalendarBridge(context) {
  if (context.packager.platform.name !== 'mac') return;
  const bridgeBundle = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'AppleCalendarBridge.app',
  );
  execFileSync('codesign', ['--verify', '--deep', '--strict', bridgeBundle], { stdio: 'inherit' });
  execFileSync('codesign', ['-d', '--entitlements', '-', bridgeBundle], { stdio: 'inherit' });
}
