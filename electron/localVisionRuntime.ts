import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseLocalVisionResponse, type LocalVisionTranscriptionRequest } from './localVisionContract.ts';
import { resolveLocalAIRuntime } from './localAIAssets.ts';
import { NoteOcrServiceError } from './noteOcrService.ts';
import type { NoteOcrResult } from '../packages/note-ocr-contract/index.ts';
import { LocalVisionAssetManager } from './localVisionAssets.ts';

const VISION_PORT = 39481;
const VISION_TIMEOUT_MS = 180_000;

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

const readResponse = async (response: Response) => {
  if (!response.ok) throw new NoteOcrServiceError('processing_failed', `Local Vision returned HTTP ${response.status}.`);
  const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new NoteOcrServiceError('invalid_result', 'Local Vision returned no transcription.');
  return content;
};

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
    const abort = () => child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGTERM'), VISION_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await waitForHealth(this.port, child, signal);
      const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(VISION_TIMEOUT_MS)]),
        body: JSON.stringify({
          stream: false,
          max_tokens: 1_500,
          temperature: 0.1,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `${request.mode ? `Mode: ${request.mode}.\n` : ''}${request.language ? `Language: ${request.language}.\n` : ''}Transcribe this image exactly.` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
        }),
      });
      const content = await readResponse(response);
      const result = parseLocalVisionResponse(content, Date.now() - startedAt);
      if (!result) throw new NoteOcrServiceError('invalid_result', 'Local Vision returned malformed transcription JSON.');
      return result;
    } catch (error) {
      if (signal?.aborted) throw new NoteOcrServiceError('cancelled', 'OCR was cancelled.', { cause: error });
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
