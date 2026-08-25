import path from 'node:path';

export const FLOATING_MEETING_INDICATOR_ASSET = 'floating-meeting-indicator.html';

export function resolveFloatingMeetingIndicatorRenderer(options: {
  devServerUrl?: string;
  rendererDist: string;
}) {
  return options.devServerUrl
    ? `${options.devServerUrl.replace(/\/$/, '')}/${FLOATING_MEETING_INDICATOR_ASSET}`
    : path.join(options.rendererDist, FLOATING_MEETING_INDICATOR_ASSET);
}
