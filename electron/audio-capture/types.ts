import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export type AudioSourceName = 'user_microphone' | 'system_audio';

export type AudioPermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'requires_restart'
  | 'unavailable';

export type AudioPermissionStatus = {
  microphone: AudioPermissionState;
  systemAudio: AudioPermissionState;
};

export type AudioInputDevice = {
  id: string;
  name: string;
  kind: 'input';
  available: boolean;
  isBluetooth: boolean;
  isDefault: boolean;
  isOutputDefault: boolean;
  channelCount: number;
};

export type AudioDeviceInfo = {
  devices: AudioInputDevice[];
  outputDevice: { id: string; name: string; isBluetooth: boolean } | null;
};

export type AudioCaptureStartOptions = {
  sessionId: string;
  directory: string;
  microphone: boolean;
  systemAudio: boolean;
  microphoneDeviceId?: string | null;
  requesterId?: number;
};

export type AudioCaptureSource = {
  source: AudioSourceName;
  sampleRate: number;
  channels: number;
  active: boolean;
};

export type AudioCaptureWarning = { source: AudioSourceName; error: string };

export type AudioCaptureSession = {
  sessionId: string;
  sources: AudioCaptureSource[];
  warnings: AudioCaptureWarning[];
};

export type AudioCaptureStopResult = {
  durationSeconds: number;
  startedAt?: string;
  endedAt?: string;
};

export type AudioCaptureEvent =
  | { type: 'level'; source: AudioSourceName; level: number }
  | { type: 'devices-changed' }
  | {
      type: 'audio-data';
      sessionId: string;
      source: AudioSourceName;
      sampleRate: number;
      channels: number;
      format: 'f32le-interleaved';
      data: string;
      capturedAt: string;
      durationSeconds: number;
    }
  | { type: 'error'; source: AudioSourceName; error: string; code?: AudioCaptureErrorCode }
  | {
      type: 'chunk-finalized';
      id: string;
      sessionId: string;
      source: AudioSourceName;
      sequence: number;
      startAt: string;
      endAt: string | null;
      durationSeconds: number;
      fileName: string;
      sizeBytes: number;
      finalized: boolean;
    };

export type AudioCaptureErrorCode =
  | 'platform_unsupported'
  | 'microphone_permission_denied'
  | 'system_audio_permission_denied'
  | 'windows_loopback_unavailable'
  | 'display_capture_denied'
  | 'empty_audio_stream'
  | 'no_microphone_available'
  | 'no_output_device_available'
  | 'capture_initialization_failed'
  | 'capture_interrupted'
  | 'device_disconnected'
  | 'invalid_request'
  | 'already_recording'
  | 'invalid_state'
  | 'storage_failed'
  | 'unknown';

export class AudioCaptureError extends Error {
  readonly code: AudioCaptureErrorCode;
  readonly source?: AudioSourceName;

  constructor(code: AudioCaptureErrorCode, message: string, options: { source?: AudioSourceName; cause?: unknown } = {}) {
    super(message);
    this.name = 'AudioCaptureError';
    this.code = code;
    this.source = options.source;
    if (options.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export interface AudioCaptureAdapter {
  setRequesterId?(requesterId: number): void;
  isSupported(): boolean;
  permissions(): Promise<AudioPermissionStatus>;
  requestPermissions(): Promise<AudioPermissionStatus>;
  openSystemSettings(area: 'microphone' | 'screen-recording'): Promise<boolean>;
  devices(): Promise<AudioDeviceInfo>;
  start(options: AudioCaptureStartOptions): Promise<AudioCaptureSession>;
  testSource(options: AudioCaptureStartOptions): Promise<AudioCaptureSession>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<AudioCaptureStopResult>;
  flush?(): Promise<void>;
  checkHealth?(): Promise<AudioCaptureSource[]>;
  onEvent(listener: (event: AudioCaptureEvent) => void): () => void;
  shutdown(): Promise<void>;
}

export type NativeAudioBridge = ChildProcessWithoutNullStreams;
