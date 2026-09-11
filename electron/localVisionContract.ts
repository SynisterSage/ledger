import { parseNoteOcrResult, type NoteOcrResult } from '../packages/note-ocr-contract/index.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

export type LocalVisionImage = {
  /** PNG or JPEG bytes encoded for the local multimodal chat endpoint. */
  dataBase64: string;
  mediaType: 'image/png' | 'image/jpeg';
};

export type LocalVisionTranscriptionRequest = {
  image: LocalVisionImage;
  language?: string;
  mode?: 'auto' | 'handwriting' | 'printed';
};

export const LOCAL_VISION_TRANSCRIPTION_PROMPT = `Transcribe the note image exactly.

Rules:
- Preserve the original reading order and line breaks.
- Do not summarize, rewrite, or invent missing words.
- If a word or region cannot be read, use [unclear] and report the region in unclearRegions.
- Infer headings, bullets, and checkboxes only when the visual layout clearly supports them.
- Return JSON only, with this shape:
{"text":"...","lines":[{"text":"..."}],"blocks":[{"type":"heading|paragraph|bullet|todo","text":"...","checked":false}],"uncertain":false,"unclearRegions":[]}
- Use an empty array for blocks or unclearRegions when there are none.`;

const extractJsonObject = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]?.trim().startsWith('{')) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
};

/**
 * Converts untrusted multimodal model output into the shared OCR result.
 * The model is never allowed to bypass the same validation used by native OCR.
 */
export const parseLocalVisionResponse = (value: string, durationMs?: number): NoteOcrResult | null => {
  const json = extractJsonObject(value);
  if (!json) {
    const text = value.trim();
    if (!text || /^```(?:json)?$/i.test(text) || text.startsWith('{')) return null;
    if (/^(?:I cannot|I can't|Unable to|I am unable to)\b/i.test(text)) return null;
    return {
      text,
      lines: text.split(/\r?\n/).map((line) => ({ text: line })),
      engine: 'local-vision',
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Some multimodal checkpoints add confidence metadata to unclear regions
    // even when the prompt asks for strings. Normalize that harmless variant
    // before applying the shared OCR contract validator.
    if (Array.isArray(parsed.unclearRegions)) {
      parsed.unclearRegions = parsed.unclearRegions.flatMap((region) => {
        if (typeof region === 'string') return [region];
        if (isRecord(region) && typeof region.region === 'string') return [region.region];
        return [];
      });
    }
    if (Array.isArray(parsed.blocks)) {
      parsed.blocks = parsed.blocks.map((block) => {
        if (!isRecord(block) || block.type === 'todo' || block.checked !== false) return block;
        const { checked: _checked, ...withoutChecked } = block;
        return withoutChecked;
      });
    }
    return parseNoteOcrResult({
      ...parsed,
      engine: 'local-vision',
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  } catch {
    return null;
  }
};
