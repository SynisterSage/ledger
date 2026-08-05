import { MacAudioCaptureAdapter } from './adapters/MacAudioCaptureAdapter';
import { WindowsAudioCaptureAdapter } from './adapters/WindowsAudioCaptureAdapter';
import { AudioCaptureError, type AudioCaptureAdapter } from './types';

class UnsupportedAudioCaptureAdapter extends WindowsAudioCaptureAdapter {
  override isSupported() { return false; }
  override start() { return Promise.reject(new AudioCaptureError('platform_unsupported', 'Meeting audio capture is unavailable on this platform.')); }
}

export function createAudioCaptureAdapter(platform = process.platform): AudioCaptureAdapter {
  if (platform === 'darwin') return new MacAudioCaptureAdapter();
  if (platform === 'win32') return new WindowsAudioCaptureAdapter();
  return new UnsupportedAudioCaptureAdapter();
}
