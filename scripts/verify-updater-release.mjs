import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value?.startsWith('--')) args.set(value.slice(2), process.argv[index + 1]);
}

const platform = args.get('platform');
const releaseDir = args.get('release-dir');

if (!['mac', 'win'].includes(platform) || typeof releaseDir !== 'string') {
  console.error('Usage: node scripts/verify-updater-release.mjs --platform <mac|win> --release-dir <path>');
  process.exit(2);
}

const absoluteReleaseDir = path.resolve(releaseDir);
const manifestName = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml';
const manifestPath = path.join(absoluteReleaseDir, manifestName);

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing updater manifest: ${manifestName}`);
}

const manifest = fs.readFileSync(manifestPath, 'utf8');
const version = manifest.match(/^version:\s*(.+)$/m)?.[1]?.trim();
const artifactPath = manifest.match(/^path:\s*(.+)$/m)?.[1]?.trim();
const expectedSha512 = manifest.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
const expectedSize = Number(manifest.match(/^\s+size:\s*(\d+)$/m)?.[1] ?? NaN);

if (!version || !artifactPath || !expectedSha512 || !Number.isFinite(expectedSize)) {
  throw new Error(`Incomplete updater manifest: ${manifestPath}`);
}

const artifact = path.join(absoluteReleaseDir, artifactPath);
if (!fs.existsSync(artifact)) {
  throw new Error(`Manifest points to a missing artifact: ${artifactPath}`);
}

const stat = fs.statSync(artifact);
if (stat.size !== expectedSize) {
  throw new Error(`Size mismatch for ${artifactPath}: manifest=${expectedSize}, actual=${stat.size}`);
}

const actualSha512 = crypto.createHash('sha512').update(fs.readFileSync(artifact)).digest('base64');
if (actualSha512 !== expectedSha512) {
  throw new Error(`SHA-512 mismatch for ${artifactPath}`);
}

const expectedExtensions = platform === 'mac' ? ['.dmg', '.zip'] : ['.exe'];
for (const extension of expectedExtensions) {
  const matchingArtifacts = fs
    .readdirSync(absoluteReleaseDir)
    .filter((name) => name.toLowerCase().endsWith(extension));
  if (matchingArtifacts.length === 0) {
    throw new Error(`Missing ${platform} release artifact with extension ${extension}`);
  }
}

console.log(`Updater release verified: ${platform} ${version} (${artifactPath})`);
