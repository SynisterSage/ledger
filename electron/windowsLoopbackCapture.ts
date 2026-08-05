import { desktopCapturer, session } from 'electron';

/**
 * Electron owns the Windows loopback permission hand-off. The capture adapter
 * remains responsible for asking the renderer for a display stream; this
 * handler only supplies the display source and requests the output mix.
 */
export function registerWindowsLoopbackCapture() {
  if (process.platform !== 'win32') return;
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const selectedSource = sources[0];
      if (!selectedSource) {
        callback({ video: undefined, audio: undefined });
        return;
      }
      callback({ video: selectedSource, audio: 'loopback' });
    } catch {
      callback({ video: undefined, audio: undefined });
    }
  });
}
