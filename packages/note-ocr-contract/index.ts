export type NoteOcrEngine = 'apple-vision' | 'paddleocr' | 'local-vision';

export type NoteOcrBlockType = 'heading' | 'paragraph' | 'bullet' | 'todo';

export type NoteOcrBlock = {
  type: NoteOcrBlockType;
  text: string;
  checked?: boolean;
};

export type NoteOcrBoundingBox = {
  /** Normalized coordinates, origin at the top-left of the source image. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NoteOcrLine = {
  text: string;
  confidence?: number;
  boundingBox?: NoteOcrBoundingBox;
};

export type NoteOcrResult = {
  text: string;
  lines: NoteOcrLine[];
  engine: NoteOcrEngine;
  /** Structured blocks are provided by vision models and are optional for legacy OCR engines. */
  blocks?: NoteOcrBlock[];
  /** True when the provider detected text it could not transcribe confidently. */
  uncertain?: boolean;
  unclearRegions?: string[];
  language?: string;
  durationMs?: number;
};

export type NoteOcrErrorCode =
  | 'unavailable'
  | 'model_missing'
  | 'permission_denied'
  | 'no_text_found'
  | 'processing_failed'
  | 'cancelled';

export type NoteOcrRequest = {
  noteId: string;
  language?: string;
  mode?: 'auto' | 'handwriting' | 'printed';
};

const MAX_OCR_TEXT_LENGTH = 200_000;
const MAX_OCR_LINES = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const parseBoundingBox = (value: unknown): NoteOcrBoundingBox | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const keys = ['x', 'y', 'width', 'height'] as const;
  if (!keys.every((key) => isFiniteNumber(value[key]))) return undefined;
  if (keys.some((key) => (value[key] as number) < 0 || (value[key] as number) > 1)) return undefined;
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
  };
};

/**
 * Validate the untrusted boundary between a native/local OCR provider and
 * the Notes UI. Invalid provider output must not reach Lexical insertion.
 */
export const parseNoteOcrResult = (value: unknown): NoteOcrResult | null => {
  if (!isRecord(value)) return null;
  if (typeof value.text !== 'string' || value.text.length > MAX_OCR_TEXT_LENGTH) return null;
  if (!Array.isArray(value.lines) || value.lines.length > MAX_OCR_LINES) return null;
  if (value.engine !== 'apple-vision' && value.engine !== 'paddleocr' && value.engine !== 'local-vision') return null;

  const lines: NoteOcrLine[] = [];
  for (const line of value.lines) {
    if (!isRecord(line) || typeof line.text !== 'string' || line.text.length > 10_000) return null;
    if (line.confidence !== undefined && (!isFiniteNumber(line.confidence) || line.confidence < 0 || line.confidence > 1)) return null;
    const boundingBox = parseBoundingBox(line.boundingBox);
    if (line.boundingBox !== undefined && !boundingBox) return null;
    lines.push({
      text: line.text,
      ...(line.confidence === undefined ? {} : { confidence: line.confidence as number }),
      ...(boundingBox ? { boundingBox } : {}),
    });
  }

  let blocks: NoteOcrBlock[] | undefined;
  if (value.blocks !== undefined) {
    if (!Array.isArray(value.blocks) || value.blocks.length > MAX_OCR_LINES) return null;
    blocks = [];
    for (const block of value.blocks) {
      if (!isRecord(block) || (block.type !== 'heading' && block.type !== 'paragraph' && block.type !== 'bullet' && block.type !== 'todo') || typeof block.text !== 'string' || block.text.length > 10_000) return null;
      if (block.checked !== undefined && typeof block.checked !== 'boolean') return null;
      if (block.type !== 'todo' && block.checked !== undefined) return null;
      blocks.push({
        type: block.type,
        text: block.text,
        ...(block.checked === undefined ? {} : { checked: block.checked }),
      });
    }
  }

  if (value.language !== undefined && typeof value.language !== 'string') return null;
  if (value.durationMs !== undefined && (!isFiniteNumber(value.durationMs) || value.durationMs < 0)) return null;
  if (value.uncertain !== undefined && typeof value.uncertain !== 'boolean') return null;
  if (value.unclearRegions !== undefined && (!Array.isArray(value.unclearRegions) || value.unclearRegions.some((region) => typeof region !== 'string' || region.length > 1_000))) return null;

  return {
    text: value.text,
    lines,
    engine: value.engine,
    ...(blocks === undefined ? {} : { blocks }),
    ...(value.uncertain === undefined ? {} : { uncertain: value.uncertain }),
    ...(value.unclearRegions === undefined ? {} : { unclearRegions: value.unclearRegions as string[] }),
    ...(value.language === undefined ? {} : { language: value.language }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs as number }),
  };
};
