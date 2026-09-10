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
};

const nativeModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NoteOcrNativeModule>('LedgerNoteOcr')
  : null;

export const noteOcrNative = {
  supported: nativeModule !== null,
  recognizeText: async (imageUri: string, language = 'auto'): Promise<MobileNoteOcrResult> => {
    if (!nativeModule) throw new Error('On-device OCR is unavailable in this build.');
    const result = parseNoteOcrResult(await nativeModule.recognizeText(imageUri, language) as unknown);
    if (!result || (result.engine !== 'apple-vision' && result.engine !== 'paddleocr')) throw new Error('On-device OCR returned an invalid result.');
    return { ...result, language: result.language ?? language } as MobileNoteOcrResult;
  },
};
