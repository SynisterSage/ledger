import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalNoteOcrService, NoteOcrServiceError, type PaddleOcrCommandProvider } from './noteOcrService.ts';

const request = { noteId: 'note-1', mode: 'handwriting' as const };

const providerFor = (recognize: PaddleOcrCommandProvider['recognize']): PaddleOcrCommandProvider => ({
  status: () => ({ available: true, engine: 'paddleocr', executablePath: '/tmp/paddleocr' }),
  recognize,
});

const withImage = async (run: (imagePath: string) => Promise<void>) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ledger-note-ocr-'));
  const imagePath = path.join(root, 'note.jpg');
  await fs.promises.writeFile(imagePath, Buffer.from('test image'));
  try { await run(imagePath); } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
};

test('returns a validated local OCR result from the provider', async () => {
  await withImage(async (imagePath) => {
    const service = new LocalNoteOcrService(providerFor(async () => ({
      text: 'hello',
      lines: [{ text: 'hello', confidence: 0.9 }],
      engine: 'paddleocr',
    })));
    assert.equal((await service.recognize({ imagePath, request })).text, 'hello');
  });
});

test('rejects unsupported or missing images before invoking the provider', async () => {
  let called = false;
  const service = new LocalNoteOcrService(providerFor(async () => {
    called = true;
    return { text: '', lines: [], engine: 'paddleocr' };
  }));
  await assert.rejects(async () => service.recognize({ imagePath: '/tmp/note.txt', request }), (error: unknown) => error instanceof NoteOcrServiceError && error.code === 'invalid_image');
  assert.equal(called, false);
});

test('rejects malformed provider output before returning to the renderer', async () => {
  await withImage(async (imagePath) => {
    const service = new LocalNoteOcrService(providerFor(async () => ({
      text: 'bad',
      lines: [{ text: 'bad', confidence: 4 }],
      engine: 'paddleocr',
    } as never)));
    await assert.rejects(() => service.recognize({ imagePath, request }), (error: unknown) => error instanceof NoteOcrServiceError && error.code === 'invalid_result');
  });
});

test('passes cancellation through to the provider', async () => {
  await withImage(async (imagePath) => {
    const controller = new AbortController();
    const service = new LocalNoteOcrService(providerFor(async (_input, signal) => {
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new NoteOcrServiceError('cancelled', 'OCR was cancelled.');
    }));
    const pending = service.recognize({ imagePath, request }, controller.signal);
    controller.abort();
    await assert.rejects(() => pending, (error: unknown) => error instanceof NoteOcrServiceError && error.code === 'cancelled');
  });
});
