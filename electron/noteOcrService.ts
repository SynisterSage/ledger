import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNoteOcrResult, type NoteOcrEngine, type NoteOcrRequest } from '../packages/note-ocr-contract/index.ts';
import { LocalVisionRuntime } from './localVisionRuntime.ts';
import { LocalCapturePrivacyStore } from './localCapturePrivacy.ts';

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
  visionAvailable?: boolean;
  visionModelPath?: string | null;
  visionMmprojPath?: string | null;
};

export type NoteOcrProgressStage = 'preparing' | 'converting' | 'recognizing' | 'complete';
type NoteOcrProgressListener = (stage: NoteOcrProgressStage) => void;

export type PaddleOcrCommandProvider = {
  status: () => NoteOcrServiceStatus;
  recognize: (input: { imagePath: string; request: NoteOcrRequest }, signal?: AbortSignal, onProgress?: NoteOcrProgressListener) => Promise<unknown>;
};

const executableName = process.platform === 'win32' ? 'paddleocr.exe' : 'paddleocr';

const candidateExecutablePaths = () => [
  process.env.LEDGER_PADDLEOCR_PATH?.trim(),
  process.env.LEDGER_PADDLEOCR_COMMAND?.trim(),
  path.join(process.resourcesPath, 'local-ocr-runtime', `${process.platform}-${process.arch}`, executableName),
  path.join(process.resourcesPath, 'local-ocr-runtime', `${process.platform}-${process.arch}`, 'paddleocr', executableName),
  path.join(process.resourcesPath, 'local-ocr-runtime', 'paddleocr_adapter.py'),
  path.join(__dirname, '..', 'native', 'local-ocr-runtime', 'paddleocr_adapter.py'),
  path.join(__dirname, '..', 'native', 'local-ocr-runtime', `${process.platform}-${process.arch}`, executableName),
  path.join(__dirname, '..', 'native', 'local-ocr-runtime', `${process.platform}-${process.arch}`, 'paddleocr', executableName),
].filter((candidate): candidate is string => Boolean(candidate));

const isExecutableFile = (candidate: string) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const resolveExecutablePath = () => candidateExecutablePaths().find(isExecutableFile) ?? null;

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

const prepareImageForOcr = async (imagePath: string, onProgress?: NoteOcrProgressListener) => {
  const extension = path.extname(imagePath).toLowerCase();
  if (process.platform !== 'darwin' || (extension !== '.heic' && extension !== '.heif')) {
    return { imagePath, convertedFromHeic: false, cleanup: async () => undefined };
  }

  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ledger-note-ocr-'));
  onProgress?.('converting');
  // `sips` can flatten some iPhone HEIC/HDR images to black. Quick Look uses
  // the same renderer macOS uses for Finder previews and preserves the visible
  // pixels. Its thumbnail is also a safe OCR-sized image.
  const convertedPath = path.join(directory, `${path.basename(imagePath)}.png`);
  const conversion = spawn('qlmanage', ['-t', '-s', '2048', '-o', directory, imagePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = await readChildOutput(conversion);
  if (output.code !== 0 || !fs.existsSync(convertedPath)) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw new NoteOcrServiceError('processing_failed', output.stderr.trim().slice(0, 500) || 'Could not prepare this HEIC image for OCR.');
  }
  return {
    imagePath: convertedPath,
    convertedFromHeic: true,
    cleanup: () => fs.promises.rm(directory, { recursive: true, force: true }),
  };
};

const createPaddleOcrCommandProvider = (): PaddleOcrCommandProvider => ({
  status: () => {
    const executablePath = resolveExecutablePath();
    return { available: Boolean(executablePath), engine: 'paddleocr', executablePath };
  },
  async recognize({ imagePath, request }, signal, onProgress) {
    const executablePath = resolveExecutablePath();
    if (!executablePath) throw new NoteOcrServiceError('unavailable', 'Local OCR is not installed on this device.');

    const isPythonAdapter = path.extname(executablePath).toLowerCase() === '.py';
    const engine: NoteOcrEngine = 'paddleocr';
    const developmentPython = path.join(__dirname, '..', '.venv', 'note-ocr', 'bin', 'python');
    const developmentCache = path.join(__dirname, '..', '.cache', 'paddlex');
    const command = isPythonAdapter
      ? (process.env.LEDGER_PADDLEOCR_PYTHON?.trim() || (fs.existsSync(developmentPython) ? developmentPython : 'python3'))
      : executablePath;
    const commandArgs = isPythonAdapter ? [executablePath] : [];
    onProgress?.('preparing');
    const prepared = await prepareImageForOcr(imagePath, onProgress);
    const startedAt = Date.now();
    console.info('[note-ocr] starting', {
      file: path.basename(imagePath),
      input: prepared.convertedFromHeic ? 'heic-converted-to-png' : path.extname(imagePath).toLowerCase().slice(1),
      runtime: path.basename(command),
    });
    onProgress?.('recognizing');
    const child = spawn(command, [...commandArgs,
      '--input', prepared.imagePath,
      '--language', request.language ?? 'auto',
      '--mode', request.mode ?? 'auto',
      '--json',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ...(isPythonAdapter && fs.existsSync(path.join(developmentCache, 'official_models'))
          ? { LEDGER_PADDLEX_CACHE_HOME: developmentCache }
          : process.env.LEDGER_PADDLEX_CACHE_HOME
            ? { LEDGER_PADDLEX_CACHE_HOME: process.env.LEDGER_PADDLEX_CACHE_HOME }
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
      if (output.code !== 0) {
        console.error('[note-ocr] failed', { code: output.code, stderr: output.stderr.trim().slice(-4000) });
        throw new NoteOcrServiceError('processing_failed', 'Local OCR could not process this image. Try a clear JPEG or PNG, or check the desktop log for the technical error.');
      }
      let parsed: unknown;
      try { parsed = JSON.parse(output.stdout); } catch (error) { throw new NoteOcrServiceError('invalid_result', 'Local OCR returned invalid output.', { cause: error }); }
      const lineCount = Array.isArray((parsed as { lines?: unknown }).lines) ? (parsed as { lines: unknown[] }).lines.length : 0;
      console.info('[note-ocr] completed', { durationMs: Date.now() - startedAt, lineCount, convertedFromHeic: prepared.convertedFromHeic });
      onProgress?.('complete');
      return { ...(parsed as Record<string, unknown>), engine };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (!child.killed) child.kill('SIGTERM');
      await prepared.cleanup();
    }
  },
});

export class LocalNoteOcrService {
  private readonly provider: PaddleOcrCommandProvider;
  private readonly vision = new LocalVisionRuntime();
  private readonly privacy = new LocalCapturePrivacyStore();

  constructor(provider: PaddleOcrCommandProvider = createPaddleOcrCommandProvider()) {
    this.provider = provider;
  }

  status() {
    const paddle = this.provider.status();
    const vision = this.vision.status();
    return {
      ...paddle,
      visionAvailable: vision.available,
      visionModelPath: vision.modelPath,
      visionMmprojPath: vision.mmprojPath,
    };
  }

  async recognize(input: { imagePath: string; request: NoteOcrRequest }, signal?: AbortSignal, onProgress?: NoteOcrProgressListener) {
    if (!input.request.noteId || !input.request.noteId.trim()) throw new NoteOcrServiceError('invalid_image', 'OCR requires an active note.');
    validateImagePath(input.imagePath);
    const visionStatus = this.vision.status();
    if (visionStatus.available) {
      onProgress?.('preparing');
      const prepared = await prepareImageForOcr(input.imagePath, onProgress);
      try {
        onProgress?.('recognizing');
        const extension = path.extname(prepared.imagePath).toLowerCase();
        const result = await this.vision.recognize(prepared.imagePath, {
          image: { dataBase64: '', mediaType: extension === '.png' ? 'image/png' : 'image/jpeg' },
          language: input.request.language,
          mode: input.request.mode,
        }, signal);
        onProgress?.('complete');
        await this.privacy.retainScan(input.imagePath);
        return result;
      } finally {
        await prepared.cleanup();
      }
    }
    return this.provider.recognize(input, signal, onProgress).then(async (value) => {
      const result = parseNoteOcrResult(value);
      if (!result) throw new NoteOcrServiceError('invalid_result', 'Local OCR returned an invalid result.');
      await this.privacy.retainScan(input.imagePath);
      return result;
    });
  }
}
