import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { parseNoteOcrResult } from '../../../../packages/note-ocr-contract/index';

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
    const result = parseNoteOcrResult(await nativeModule.recognizeText(imageUri, language) as unknown);
    if (!result || (result.engine !== 'apple-vision' && result.engine !== 'paddleocr')) throw new Error('On-device OCR returned an invalid result.');
    return { ...result, language: result.language ?? language } as MobileNoteOcrResult;
  },
};
