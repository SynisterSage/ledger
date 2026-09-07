import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'native');
const bridgeBundle = path.join(outputDir, 'AppleCalendarBridge.app');
const output = path.join(bridgeBundle, 'Contents', 'MacOS', 'AppleCalendarBridge');
const bridgeInfoPlist = path.join(bridgeBundle, 'Contents', 'Info.plist');
const audioOutput = path.join(outputDir, 'LedgerAudioCaptureBridge');
const zoomOutput = path.join(outputDir, 'ZoomAccessibilityBridge');
// Do not inherit the SDK's deployment target. A newer Xcode/Swift SDK can
// otherwise stamp its own macOS version into the Mach-O, making the helper
// refuse to launch on older supported systems before Ledger can report an
// integration error. Keep this aligned with the desktop app's supported
// macOS floor; the Swift source has availability fallbacks for macOS 14 APIs.
const swiftTarget = 'arm64-apple-macosx13.0';
mkdirSync(outputDir, { recursive: true });
if (process.platform !== 'darwin') process.exit(0);
mkdirSync(path.dirname(output), { recursive: true });
rmSync(path.join(bridgeBundle, 'Contents', '_CodeSignature'), { recursive: true, force: true });
execFileSync('cp', [path.join(outputDir, 'AppleCalendarBridge-Info.plist'), bridgeInfoPlist]);
const moduleCachePath = path.join('/private/tmp', 'ledger-swift-module-cache');
execFileSync('swiftc', [
  '-module-cache-path', moduleCachePath,
  '-target', swiftTarget,
  '-O', '-framework', 'EventKit', '-framework', 'Foundation',
  path.join(outputDir, 'AppleCalendarBridge.swift'),
  '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist',
  '-Xlinker', path.join(outputDir, 'AppleCalendarBridge-Info.plist'),
  '-o', output,
], { stdio: 'inherit' });
execFileSync('swiftc', ['-module-cache-path', moduleCachePath, '-target', swiftTarget, '-O', '-framework', 'AVFoundation', '-framework', 'CoreAudio', '-framework', 'CoreMedia', '-framework', 'CoreGraphics', '-framework', 'ScreenCaptureKit', '-framework', 'Foundation', path.join(outputDir, 'LedgerAudioCaptureBridge.swift'), '-o', audioOutput], { stdio: 'inherit' });
execFileSync('swiftc', ['-module-cache-path', moduleCachePath, '-target', swiftTarget, '-O', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'Foundation', path.join(outputDir, 'ZoomAccessibilityBridge.swift'), '-o', zoomOutput], { stdio: 'inherit' });
if (!existsSync(path.join(outputDir, 'whisper-cli'))) {
  throw new Error('native/whisper-cli is required for packaged local transcription builds. Build it from the pinned whisper.cpp runtime before packaging.');
}
