import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import test, { mock } from 'node:test';
import { RECOMMENDED_MODEL, TranscriptionModelManager } from './transcriptionModelManager.ts';

const testRoot = `${process.cwd()}/.ledger-whisper-test-data`;
const modelPath = `${testRoot}/models/whisper/${RECOMMENDED_MODEL.fileName}`;

const withMockDownload = async (content: Buffer, run: (manager: TranscriptionModelManager) => Promise<void>) => {
  const previous = { url: RECOMMENDED_MODEL.url, expectedBytes: RECOMMENDED_MODEL.expectedBytes, sha256: RECOMMENDED_MODEL.sha256, approximateBytes: RECOMMENDED_MODEL.approximateBytes };
  RECOMMENDED_MODEL.url = 'https://test.invalid/whisper.bin';
  RECOMMENDED_MODEL.expectedBytes = content.length;
  RECOMMENDED_MODEL.approximateBytes = content.length;
  RECOMMENDED_MODEL.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const get = mock.method(https, 'get', (_url: unknown, callback: (response: EventEmitter & { statusCode: number; headers: Record<string, string>; pipe: (file: NodeJS.WritableStream) => NodeJS.WritableStream }) => void) => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; pipe: (file: NodeJS.WritableStream) => NodeJS.WritableStream };
    response.statusCode = 200;
    response.headers = {};
    response.pipe = (file) => { response.emit('data', content); file.write(content); file.end(); return file; };
    callback(response);
    return new EventEmitter() as import('node:http').ClientRequest;
  });
  fs.rmSync(testRoot, { recursive: true, force: true });
  try { await run(new TranscriptionModelManager()); }
  finally {
    get.mock.restore();
    fs.rmSync(testRoot, { recursive: true, force: true });
    RECOMMENDED_MODEL.url = previous.url;
    RECOMMENDED_MODEL.expectedBytes = previous.expectedBytes;
    RECOMMENDED_MODEL.approximateBytes = previous.approximateBytes;
    RECOMMENDED_MODEL.sha256 = previous.sha256;
  }
};

test('Whisper manifest is pinned and includes exact integrity metadata', () => {
  assert.match(RECOMMENDED_MODEL.url, /resolve\/5359861c739e955e79d9a303bcbc70fb988958b1\//);
  assert.equal(RECOMMENDED_MODEL.expectedBytes, 147_964_211);
  assert.match(RECOMMENDED_MODEL.sha256, /^[a-f0-9]{64}$/);
});

test('Whisper download installs atomically and deduplicates concurrent callers', async () => {
  await withMockDownload(Buffer.concat([Buffer.from('lmgg'), Buffer.from('valid-whisper-model')]), async (manager) => {
    const [first, second] = await Promise.all([manager.download(), manager.download()]);
    assert.equal(first.installed, true);
    assert.equal(second.installed, true);
    assert.equal(manager.status().installed, true);
    assert.equal(fs.existsSync(`${modelPath}.${process.pid}.download`), false);
  });
});

test('Whisper checksum failures do not install or retain partial files', async () => {
  await withMockDownload(Buffer.from('invalid-whisper-model'), async (manager) => {
    RECOMMENDED_MODEL.sha256 = '0'.repeat(64);
    await assert.rejects(manager.download(), /SHA-256 verification/);
    assert.equal(manager.status().installed, false);
    assert.equal(fs.existsSync(modelPath), false);
    assert.equal(fs.existsSync(`${modelPath}.${process.pid}.download`), false);
  });
});
