import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { LOCAL_VISION_TRANSCRIPTION_PROMPT, parseLocalVisionResponse, type LocalVisionTranscriptionRequest } from './localVisionContract.ts';
import { resolveLocalAIRuntime } from './localAIAssets.ts';
import { NoteOcrServiceError } from './noteOcrService.ts';
import type { NoteOcrResult } from '../packages/note-ocr-contract/index.ts';
import { LocalVisionAssetManager } from './localVisionAssets.ts';

const VISION_PORT = 39481;
const VISION_TIMEOUT_MS = 300_000;

export type LocalVisionRuntimeStatus = {
  available: boolean;
  runtimePath: string | null;
  modelPath: string | null;
  mmprojPath: string | null;
};

const visionAssets = new LocalVisionAssetManager();
const resolveVisionModelPath = () => process.env.LEDGER_LOCAL_VISION_MODEL_PATH?.trim() || (visionAssets.status().available ? visionAssets.status().modelPath : null);
const resolveVisionMmprojPath = () => process.env.LEDGER_LOCAL_VISION_MMPROJ_PATH?.trim() || (visionAssets.status().available ? visionAssets.status().mmprojPath : null);

export const localVisionRuntimeStatus = (): LocalVisionRuntimeStatus => {
  const runtimePath = resolveLocalAIRuntime();
  const modelPath = resolveVisionModelPath();
  const mmprojPath = resolveVisionMmprojPath();
  return {
    available: Boolean(runtimePath && modelPath && mmprojPath && fs.existsSync(runtimePath) && fs.existsSync(modelPath) && fs.existsSync(mmprojPath)),
    runtimePath,
    modelPath,
    mmprojPath,
  };
};

const postJson = (port: number, payload: unknown, signal?: AbortSignal) => new Promise<unknown>((resolve, reject) => {
  const body = JSON.stringify(payload);
  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: VISION_TIMEOUT_MS,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.once('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        reject(new NoteOcrServiceError('processing_failed', `Local Vision returned HTTP ${response.statusCode ?? 500}.`));
        return;
      }
      try { resolve(JSON.parse(text)); } catch (error) {
        reject(new NoteOcrServiceError('invalid_result', 'Local Vision returned invalid JSON.', { cause: error }));
      }
    });
  });
  const abort = () => request.destroy(new Error('Local Vision request was cancelled.'));
  signal?.addEventListener('abort', abort, { once: true });
  request.once('timeout', () => request.destroy(new Error('Local Vision inference timed out.')));
  request.once('error', (error) => reject(error));
  request.once('close', () => signal?.removeEventListener('abort', abort));
  request.end(body);
});

const waitForHealth = async (port: number, child: ChildProcess, signal?: AbortSignal) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (signal?.aborted) throw new NoteOcrServiceError('cancelled', 'OCR was cancelled.');
    if (child.exitCode !== null) throw new NoteOcrServiceError('processing_failed', 'Local Vision stopped before it was ready.');
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) })).ok) return;
    } catch { /* The server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new NoteOcrServiceError('processing_failed', 'Local Vision did not become ready in time.');
};

const imageDataUrl = async (imagePath: string, mediaType: LocalVisionTranscriptionRequest['image']['mediaType']) => {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === '.heic' || extension === '.heif') throw new NoteOcrServiceError('invalid_image', 'Local Vision requires a PNG or JPEG image after HEIC conversion.');
  const dataBase64 = (await fs.promises.readFile(imagePath)).toString('base64');
  return `data:${mediaType};base64,${dataBase64}`;
};

/**
 * Dedicated desktop multimodal runtime. It intentionally does not share the
 * text Qwen process because that process is launched with --no-mmproj.
 */
export class LocalVisionRuntime {
  private child: ChildProcess | null = null;
  private port = VISION_PORT + (process.pid % 1000);

  status() { return localVisionRuntimeStatus(); }

  async recognize(imagePath: string, request: LocalVisionTranscriptionRequest, signal?: AbortSignal): Promise<NoteOcrResult> {
    const status = this.status();
    if (!status.available || !status.runtimePath || !status.modelPath || !status.mmprojPath) {
      throw new NoteOcrServiceError('unavailable', 'Local Vision is not installed.');
    }
    const startedAt = Date.now();
    const dataUrl = await imageDataUrl(imagePath, request.image.mediaType);
    const child = spawn(status.runtimePath, [
      '--model', status.modelPath,
      '--mmproj', status.mmprojPath,
      '--host', '127.0.0.1',
      '--port', String(this.port),
      '--ctx-size', '8192',
      '--jinja',
      '--n-gpu-layers', 'all',
      '--parallel', '1',
      '--reasoning', 'off',
      '--verbosity', process.env.LEDGER_LLAMA_VERBOSE === '1' ? '4' : '1',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let diagnostics = '';
    const collectDiagnostics = (chunk: Buffer) => {
      diagnostics = `${diagnostics}${String(chunk)}`.slice(-12_000);
    };
    child.stdout?.on('data', collectDiagnostics);
    child.stderr?.on('data', collectDiagnostics);
    child.once('exit', (code, exitSignal) => {
      if (code !== 0 && code !== null) console.warn('[note-ocr] vision runtime exited', { code, signal: exitSignal, diagnostics });
    });
    const abort = () => child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGTERM'), VISION_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await waitForHealth(this.port, child, signal);
      const response = await postJson(this.port, {
        stream: false,
        response_format: { type: 'json_object' },
        max_tokens: 2_000,
        temperature: 0.1,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${request.mode ? `Mode: ${request.mode}.\n` : ''}${request.language ? `Language: ${request.language}.\n` : ''}${LOCAL_VISION_TRANSCRIPTION_PROMPT}` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] }],
      }, AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(VISION_TIMEOUT_MS)]));
      const body = response as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new NoteOcrServiceError('invalid_result', 'Local Vision returned no transcription.');
      const result = parseLocalVisionResponse(content, Date.now() - startedAt);
      if (!result) {
        console.warn('[note-ocr] vision returned invalid transcription payload', { responseLength: content.length, responseTail: content.slice(-300), responsePreview: content.slice(0, 1_000) });
        throw new NoteOcrServiceError('invalid_result', 'Local Vision returned malformed transcription JSON.');
      }
      return result;
    } catch (error) {
      if (signal?.aborted) throw new NoteOcrServiceError('cancelled', 'OCR was cancelled.', { cause: error });
      if (error instanceof Error && /timed out|fetch failed|headers timeout/i.test(error.message)) {
        console.error('[note-ocr] vision request failed', { message: error.message, diagnostics });
        throw new NoteOcrServiceError('processing_failed', 'Local Vision took too long to respond. The first scan can be slow while the model warms up; try again once the device is idle.', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (this.child === child) this.child = null;
      if (!child.killed) child.kill('SIGTERM');
    }
  }

  shutdown() {
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
    this.child = null;
  }
}
