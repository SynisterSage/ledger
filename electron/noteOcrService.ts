import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNoteOcrResult, type NoteOcrEngine, type NoteOcrRequest } from '../packages/note-ocr-contract/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OCR_TIMEOUT_MS = 120_000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export type NoteOcrServiceErrorCode =
  | 'unavailable'
  | 'invalid_image'
  | 'processing_failed'
  | 'cancelled'
  | 'invalid_result';

export class NoteOcrServiceError extends Error {
  readonly code: NoteOcrServiceErrorCode;

  constructor(code: NoteOcrServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = 'NoteOcrServiceError';
  }
}

export type NoteOcrServiceStatus = {
  available: boolean;
  engine: NoteOcrEngine;
  executablePath: string | null;
};

export type PaddleOcrCommandProvider = {
  status: () => NoteOcrServiceStatus;
  recognize: (input: { imagePath: string; request: NoteOcrRequest }, signal?: AbortSignal) => Promise<unknown>;
};

const executableName = process.platform === 'win32' ? 'paddleocr.exe' : 'paddleocr';

const candidateExecutablePaths = () => [
  process.env.LEDGER_PADDLEOCR_PATH?.trim(),
  process.env.LEDGER_PADDLEOCR_COMMAND?.trim(),
  path.join(process.resourcesPath, 'local-ocr-runtime', `${process.platform}-${process.arch}`, executableName),
  path.join(process.resourcesPath, 'local-ocr-runtime', 'paddleocr_adapter.py'),
  path.join(__dirname, '..', 'native', 'local-ocr-runtime', `${process.platform}-${process.arch}`, executableName),
  path.join(__dirname, '..', 'native', 'local-ocr-runtime', 'paddleocr_adapter.py'),
].filter((candidate): candidate is string => Boolean(candidate));

const resolveExecutablePath = () => candidateExecutablePaths().find((candidate) => fs.existsSync(candidate)) ?? null;

const validateImagePath = (imagePath: string) => {
  if (!path.isAbsolute(imagePath) || !IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase())) {
    throw new NoteOcrServiceError('invalid_image', 'Choose a supported image file.');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(imagePath);
  } catch (error) {
    throw new NoteOcrServiceError('invalid_image', 'The selected image could not be read.', { cause: error });
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
    throw new NoteOcrServiceError('invalid_image', 'Images must be between 1 byte and 20 MB.');
  }
};

const readChildOutput = (child: ReturnType<typeof spawn>) => new Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  const maxOutputBytes = 2 * 1024 * 1024;
  child.stdout?.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes <= maxOutputBytes) stdout.push(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).length < 32_000) stderr.push(chunk); });
  child.once('error', reject);
  child.once('close', (code, signal) => resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code, signal }));
});

const createPaddleOcrCommandProvider = (): PaddleOcrCommandProvider => ({
  status: () => {
    const executablePath = resolveExecutablePath();
    return { available: Boolean(executablePath), engine: 'paddleocr', executablePath };
  },
  async recognize({ imagePath, request }, signal) {
    const executablePath = resolveExecutablePath();
    if (!executablePath) throw new NoteOcrServiceError('unavailable', 'Local OCR is not installed on this device.');

    const isPythonAdapter = path.extname(executablePath).toLowerCase() === '.py';
    const developmentPython = path.join(__dirname, '..', '.venv', 'note-ocr', 'bin', 'python');
    const command = isPythonAdapter
      ? (process.env.LEDGER_PADDLEOCR_PYTHON?.trim() || (fs.existsSync(developmentPython) ? developmentPython : 'python3'))
      : executablePath;
    const commandArgs = isPythonAdapter ? [executablePath] : [];
    const child = spawn(command, [...commandArgs,
      '--input', imagePath,
      '--language', request.language ?? 'auto',
      '--mode', request.mode ?? 'auto',
      '--json',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.env.LEDGER_PADDLEX_CACHE_HOME
          ? { PADDLE_PDX_CACHE_HOME: process.env.LEDGER_PADDLEX_CACHE_HOME }
          : {}),
      },
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), OCR_TIMEOUT_MS);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const output = await readChildOutput(child);
      if (signal?.aborted) throw new NoteOcrServiceError('cancelled', 'OCR was cancelled.');
      if (output.signal === 'SIGTERM' && Date.now() >= 0) throw new NoteOcrServiceError('processing_failed', 'Local OCR timed out or stopped unexpectedly.');
      if (output.code !== 0) throw new NoteOcrServiceError('processing_failed', output.stderr.trim().slice(0, 500) || 'Local OCR could not process this image.');
      let parsed: unknown;
      try { parsed = JSON.parse(output.stdout); } catch (error) { throw new NoteOcrServiceError('invalid_result', 'Local OCR returned invalid output.', { cause: error }); }
      return { ...(parsed as Record<string, unknown>), engine: 'paddleocr' };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (!child.killed) child.kill('SIGTERM');
    }
  },
});

export class LocalNoteOcrService {
  private readonly provider: PaddleOcrCommandProvider;

  constructor(provider: PaddleOcrCommandProvider = createPaddleOcrCommandProvider()) {
    this.provider = provider;
  }

  status() { return this.provider.status(); }

  recognize(input: { imagePath: string; request: NoteOcrRequest }, signal?: AbortSignal) {
    if (!input.request.noteId || !input.request.noteId.trim()) throw new NoteOcrServiceError('invalid_image', 'OCR requires an active note.');
    validateImagePath(input.imagePath);
    return this.provider.recognize(input, signal).then((value) => {
      const result = parseNoteOcrResult(value);
      if (!result) throw new NoteOcrServiceError('invalid_result', 'Local OCR returned an invalid result.');
      return result;
    });
  }
}
