import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type WavData = { sampleRate: number; channels: number; samples: Float32Array };

export type NormalizedTranscriptionAudio = {
  path: string;
  originalDurationSeconds: number;
  preprocessingMs: number;
  converted: boolean;
};

const TARGET_SAMPLE_RATE = 16_000;

export function decodeFloat32Base64(data: string) {
  const bytes = Buffer.from(data, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function resampleToMono16k(samples: Float32Array, channels: number, sampleRate: number) {
  return toMono16k(samples, Math.max(1, channels), Math.max(1, sampleRate));
}

export function normalizeWavForTranscription(inputPath: string, cacheRoot: string): NormalizedTranscriptionAudio {
  const startedAt = Date.now();
  const stat = fs.statSync(inputPath);
  const wav = readWav(inputPath);
  const originalDurationSeconds = wav.samples.length / Math.max(1, wav.channels * wav.sampleRate);
  const cacheKey = crypto.createHash('sha256').update(`${inputPath}:${stat.size}:${stat.mtimeMs}`).digest('hex');
  const outputPath = path.join(cacheRoot, 'normalized-audio', `${cacheKey}.wav`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (!fs.existsSync(outputPath)) writePcm16Wav(outputPath, toMono16k(wav.samples, wav.channels, wav.sampleRate));
  return { path: outputPath, originalDurationSeconds, preprocessingMs: Date.now() - startedAt, converted: true };
}

function readWav(filePath: string): WavData {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Unsupported transcription audio container.');
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && length >= 16) format = { audioFormat: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), bitsPerSample: buffer.readUInt16LE(start + 14) };
    if (id === 'data') { dataStart = start; dataLength = Math.min(length, buffer.length - start); break; }
    offset = start + length + (length % 2);
  }
  if (!format || dataStart < 0 || !format.channels || !format.sampleRate || ![1, 3].includes(format.audioFormat) || ![16, 32].includes(format.bitsPerSample)) throw new Error('Unsupported transcription WAV format.');
  const bytesPerSample = format.bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * format.channels));
  const samples = new Float32Array(frameCount * format.channels);
  for (let index = 0; index < samples.length; index += 1) {
    const position = dataStart + index * bytesPerSample;
    if (format.audioFormat === 3 && format.bitsPerSample === 32) samples[index] = buffer.readFloatLE(position);
    else if (format.bitsPerSample === 32) samples[index] = buffer.readInt32LE(position) / 2147483648;
    else samples[index] = buffer.readInt16LE(position) / 32768;
  }
  return { sampleRate: format.sampleRate, channels: format.channels, samples };
}

function toMono16k(samples: Float32Array, channels: number, sampleRate: number) {
  const inputFrames = Math.floor(samples.length / channels);
  const outputFrames = Math.max(1, Math.round(inputFrames * TARGET_SAMPLE_RATE / sampleRate));
  const output = new Float32Array(outputFrames);
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourcePosition = frame * sampleRate / TARGET_SAMPLE_RATE;
    const leftFrame = Math.min(inputFrames - 1, Math.floor(sourcePosition));
    const rightFrame = Math.min(inputFrames - 1, leftFrame + 1);
    const ratio = sourcePosition - leftFrame;
    let value = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const left = samples[leftFrame * channels + channel] ?? 0;
      const right = samples[rightFrame * channels + channel] ?? left;
      value += left * (1 - ratio) + right * ratio;
    }
    output[frame] = Math.max(-1, Math.min(1, value / channels));
  }
  return output;
}

function writePcm16Wav(filePath: string, samples: Float32Array) {
  const dataLength = samples.length * 2;
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0); output.writeUInt32LE(36 + dataLength, 4); output.write('WAVE', 8); output.write('fmt ', 12);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(TARGET_SAMPLE_RATE, 24); output.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + index * 2);
  }
  fs.writeFileSync(filePath, output, { mode: 0o600 });
}

export function writeTranscriptionWav(filePath: string, samples: Float32Array) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writePcm16Wav(filePath, samples);
}
