import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'native');
const output = path.join(outputDir, 'AppleCalendarBridge');
const audioOutput = path.join(outputDir, 'LedgerAudioCaptureBridge');
mkdirSync(outputDir, { recursive: true });
if (process.platform !== 'darwin') process.exit(0);
const moduleCachePath = path.join('/private/tmp', 'ledger-swift-module-cache');
execFileSync('swiftc', ['-module-cache-path', moduleCachePath, '-O', '-framework', 'EventKit', '-framework', 'Foundation', path.join(outputDir, 'AppleCalendarBridge.swift'), '-o', output], { stdio: 'inherit' });
execFileSync('swiftc', ['-module-cache-path', moduleCachePath, '-O', '-framework', 'AVFoundation', '-framework', 'CoreMedia', '-framework', 'CoreGraphics', '-framework', 'ScreenCaptureKit', '-framework', 'Foundation', path.join(outputDir, 'LedgerAudioCaptureBridge.swift'), '-o', audioOutput], { stdio: 'inherit' });
if (!existsSync(path.join(outputDir, 'whisper-cli'))) {
  throw new Error('native/whisper-cli is required for packaged local transcription builds. Build it from the pinned whisper.cpp runtime before packaging.');
}
