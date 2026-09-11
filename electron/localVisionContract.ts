import { parseNoteOcrResult, type NoteOcrResult } from '../packages/note-ocr-contract/index.ts';

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
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parseNoteOcrResult({
      ...parsed,
      engine: 'local-vision',
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  } catch {
    return null;
  }
};
