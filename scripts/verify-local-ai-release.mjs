import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const platform = process.env.LEDGER_RELEASE_PLATFORM || process.platform;
const arch = process.env.LEDGER_RELEASE_ARCH || process.arch;
const executable = platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const runtime = path.join(root, 'native', 'local-ai-runtime', `${platform}-${arch}`, executable);
const runtimeDirectory = path.dirname(runtime);
const runtimeManifestPath = path.join(runtimeDirectory, 'runtime-manifest.json');

if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Local AI release verification does not support ${platform}.`);
if (!fs.existsSync(runtime)) throw new Error(`Missing pinned llama-server runtime: ${runtime}`);
if (platform !== 'win32' && (fs.statSync(runtime).mode & 0o111) === 0) throw new Error(`Runtime is not executable: ${runtime}`);
if (platform === 'darwin') {
  if (!fs.existsSync(runtimeManifestPath)) throw new Error(`Missing pinned runtime manifest: ${runtimeManifestPath}`);
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
  if (runtimeManifest.runtime !== 'llama.cpp' || runtimeManifest.release !== 'b10472' || runtimeManifest.platform !== platform || runtimeManifest.arch !== arch) {
    throw new Error(`Pinned runtime manifest does not match ${platform}-${arch}: ${runtimeManifestPath}`);
  }
  const versionResult = spawnSync(runtime, ['--version'], { encoding: 'utf8' });
  const version = `${versionResult.stdout ?? ''}${versionResult.stderr ?? ''}`;
  if (!version.includes(`build ${runtimeManifest.release.slice(1)}`) || !version.includes(runtimeManifest.commit.slice(0, 8))) {
    throw new Error(`Runtime version does not match pinned release ${runtimeManifest.release}: ${version.trim()}`);
  }
  const linkedLibraries = execFileSync('otool', ['-L', runtime], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.match(/@rpath\/(lib[^\s]+\.dylib)/)?.[1])
    .filter(Boolean);
  const requiredLibraries = Array.isArray(runtimeManifest.requiredLibraries) ? runtimeManifest.requiredLibraries : [];
  const missingLibraries = [...new Set([...linkedLibraries, ...requiredLibraries])].filter((library) => !fs.existsSync(path.join(runtimeDirectory, library)));
  if (missingLibraries.length) throw new Error(`Runtime is missing companion macOS libraries: ${missingLibraries.join(', ')}`);
  if (execFileSync('otool', ['-L', runtime], { encoding: 'utf8' }).includes('/opt/homebrew/')) throw new Error('Bundled runtime must not depend on Homebrew paths.');
}

const required = [
  'LEDGER_LOCAL_AI_GENERATION_URL',
  'LEDGER_LOCAL_AI_GENERATION_SIZE',
  'LEDGER_LOCAL_AI_GENERATION_SHA256',
  'LEDGER_LOCAL_AI_EMBEDDING_URL',
  'LEDGER_LOCAL_AI_EMBEDDING_SIZE',
  'LEDGER_LOCAL_AI_EMBEDDING_SHA256',
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing verified Local AI artifact metadata: ${missing.join(', ')}`);

console.log(`Local AI release inputs present for ${platform}-${arch}: ${runtime}`);
