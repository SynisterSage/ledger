import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default async function signAppleCalendarBridge(context) {
  if (context.packager.platform.name !== 'mac') return;
  const bridgeBundle = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'AppleCalendarBridge.app',
  );
  const entitlements = path.join(context.packager.projectDir, 'entitlements.mac.plist');
  const bridgeExecutable = path.join(bridgeBundle, 'Contents', 'MacOS', 'AppleCalendarBridge');
  const identity = context.packager.platformSpecificBuildOptions.identity;
  if (!identity) throw new Error('A macOS signing identity is required for AppleCalendarBridge.app.');
  // Sign the executable and its containing app separately. This keeps the
  // EventKit entitlements attached to the code that actually calls EventKit;
  // --deep alone can leave the nested helper with an incomplete signature.
  execFileSync('codesign', ['--force', '--options', 'runtime', '--entitlements', entitlements, '--sign', identity, bridgeExecutable], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--options', 'runtime', '--entitlements', entitlements, '--sign', identity, bridgeBundle], { stdio: 'inherit' });
}
