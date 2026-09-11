import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type MobileNoteOcrLine = {
  text: string;
  confidence?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type MobileNoteOcrResult = {
  text: string;
  lines: MobileNoteOcrLine[];
  engine: 'apple-vision' | 'paddleocr';
  language: string;
  durationMs?: number;
};

type NoteOcrNativeModule = {
  recognizeText(imageUri: string, language?: string): Promise<MobileNoteOcrResult>;
  visionModelStatus?: () => Promise<{ installed: boolean; bytes: number; expectedBytes: number }>;
  installVisionModel?: (sourceUri: string) => Promise<{ installed: boolean; bytes: number; expectedBytes: number }>;
};

const parseMobileNoteOcrResult = (value: unknown): MobileNoteOcrResult | null => {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (typeof result.text !== 'string' || !Array.isArray(result.lines)) return null;
  if (result.engine !== 'apple-vision' && result.engine !== 'paddleocr') return null;
  if (result.language !== undefined && typeof result.language !== 'string') return null;
  const lines: MobileNoteOcrLine[] = [];
  for (const line of result.lines) {
    if (!line || typeof line !== 'object') return null;
    const parsedLine = line as Record<string, unknown>;
    if (typeof parsedLine.text !== 'string') return null;
    if (parsedLine.confidence !== undefined && (typeof parsedLine.confidence !== 'number' || !Number.isFinite(parsedLine.confidence) || parsedLine.confidence < 0 || parsedLine.confidence > 1)) return null;
    lines.push({
      text: parsedLine.text,
      ...(parsedLine.confidence === undefined ? {} : { confidence: parsedLine.confidence }),
      ...(parsedLine.boundingBox && typeof parsedLine.boundingBox === 'object' ? { boundingBox: parsedLine.boundingBox as MobileNoteOcrLine['boundingBox'] } : {}),
    });
  }
  return {
    text: result.text,
    lines,
    engine: result.engine,
    language: typeof result.language === 'string' ? result.language : 'auto',
  };
};

const nativeModule = Platform.OS === 'ios' || Platform.OS === 'android'
  ? requireOptionalNativeModule<NoteOcrNativeModule>('LedgerNoteOcr')
  : null;

export const noteOcrNative = {
  supported: nativeModule !== null,
  visionModelStatus: async () => nativeModule?.visionModelStatus?.() ?? { installed: false, bytes: 0, expectedBytes: 0 },
  installVisionModel: async (sourceUri: string) => {
    if (!nativeModule?.installVisionModel) throw new Error('Android Ledger Vision installation is unavailable in this build.');
    return nativeModule.installVisionModel(sourceUri);
  },
  recognizeText: async (imageUri: string, language = 'auto'): Promise<MobileNoteOcrResult> => {
    if (!nativeModule) throw new Error('On-device OCR is unavailable in this build.');
    const result = parseMobileNoteOcrResult(await nativeModule.recognizeText(imageUri, language) as unknown);
    if (!result || (result.engine !== 'apple-vision' && result.engine !== 'paddleocr')) throw new Error('On-device OCR returned an invalid result.');
    return { ...result, language: result.language ?? language } as MobileNoteOcrResult;
  },
};
