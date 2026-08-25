export type SpeechWindow = {
  source: 'user_microphone' | 'system_audio';
  startOffsetMs: number;
  endOffsetMs: number;
  samples: Float32Array;
  speechDurationMs: number;
  silenceSkippedMs: number;
  overlapMs: number;
};

type BufferOptions = {
  source: SpeechWindow['source'];
  sampleRate?: number;
  silenceThreshold?: number;
  minSpeechMs?: number;
  silenceFinalizeMs?: number;
  maxWindowMs?: number;
  preRollMs?: number;
};

/** Small deterministic endpointing buffer. It emits only closed, stable windows. */
export class LiveSpeechBuffer {
  private readonly options: BufferOptions;
  private readonly sampleRate: number;
  private readonly silenceThreshold: number;
  private readonly minSpeechMs: number;
  private readonly silenceFinalizeMs: number;
  private readonly maxWindowMs: number;
  private readonly preRollSamples: number;
  private pending: number[] = [];
  private pendingStartMs: number | null = null;
  private active = false;
  private speechSamples = 0;
  private silenceSamples = 0;
  private skippedSilenceSamples = 0;
  private lastOffsetMs = 0;

  constructor(options: BufferOptions) {
    this.options = options;
    this.sampleRate = options.sampleRate ?? 16_000;
    this.silenceThreshold = options.silenceThreshold ?? 0.012;
    this.minSpeechMs = options.minSpeechMs ?? 320;
    this.silenceFinalizeMs = options.silenceFinalizeMs ?? 850;
    this.maxWindowMs = options.maxWindowMs ?? 12_000;
    this.preRollSamples = Math.round((options.preRollMs ?? 220) * this.sampleRate / 1000);
  }

  push(samples: Float32Array, startOffsetMs: number) {
    const windows: SpeechWindow[] = [];
    if (!samples.length) return windows;
    this.lastOffsetMs = startOffsetMs + samples.length * 1000 / this.sampleRate;
    const blockSamples = Math.max(1, Math.round(this.sampleRate * 80 / 1000));
    for (let offset = 0; offset < samples.length; offset += blockSamples) {
      const block = samples.subarray(offset, Math.min(samples.length, offset + blockSamples));
      const speech = rms(block) >= this.silenceThreshold;
      if (speech && !this.active) {
        this.active = true;
        const start = Math.max(0, offset - this.preRollSamples);
        this.pendingStartMs = startOffsetMs + start * 1000 / this.sampleRate;
        this.pending = this.recentPreRoll(samples, offset);
      }
      if (this.active) {
        this.pending.push(...block);
        if (speech) { this.speechSamples += block.length; this.silenceSamples = 0; }
        else this.silenceSamples += block.length;
        if (this.pending.length * 1000 / this.sampleRate >= this.maxWindowMs || this.silenceSamples * 1000 / this.sampleRate >= this.silenceFinalizeMs) {
          const window = this.close();
          if (window) windows.push(window);
        }
      } else if (!speech) {
        this.skippedSilenceSamples += block.length;
      }
    }
    return windows;
  }

  flush() {
    const window = this.close();
    return window ? [window] : [];
  }

  takeSkippedSilenceMs() {
    const value = this.skippedSilenceSamples * 1000 / this.sampleRate;
    this.skippedSilenceSamples = 0;
    return value;
  }

  private recentPreRoll(samples: Float32Array, end: number) {
    const start = Math.max(0, end - this.preRollSamples);
    return Array.from(samples.subarray(start, end));
  }

  private close(): SpeechWindow | null {
    const wasActive = this.active;
    const startOffsetMs = this.pendingStartMs;
    const values = this.pending;
    const speechDurationMs = this.speechSamples * 1000 / this.sampleRate;
    const endOffsetMs = startOffsetMs === null ? this.lastOffsetMs : startOffsetMs + values.length * 1000 / this.sampleRate;
    const silenceSkippedMs = this.skippedSilenceSamples * 1000 / this.sampleRate;
    this.pending = [];
    this.pendingStartMs = null;
    this.active = false;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    if (wasActive) this.skippedSilenceSamples = 0;
    if (startOffsetMs === null || speechDurationMs < this.minSpeechMs) return null;
    return { source: this.options.source, startOffsetMs, endOffsetMs, samples: Float32Array.from(values), speechDurationMs, silenceSkippedMs, overlapMs: 0 };
  }
}

function rms(samples: Float32Array) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, samples.length));
}
