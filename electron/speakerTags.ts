export type SpeakerTagsPermission = 'authorized' | 'not_authorized' | 'unsupported';
export type ZoomProcessState = { running: boolean; pid: number | null };

export function mapAccessibilityPermission(platform: NodeJS.Platform, trusted: boolean): SpeakerTagsPermission {
  if (platform !== 'darwin') return 'unsupported';
  return trusted ? 'authorized' : 'not_authorized';
}

export function observerEligibility(platform: NodeJS.Platform, permission: SpeakerTagsPermission, zoom: ZoomProcessState) {
  return platform === 'darwin' && permission === 'authorized' && zoom.running && Number.isInteger(zoom.pid);
}

export function diagnosticSpeakerEvent(displayName: unknown, observedAtMs = Date.now()) {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (!name || !Number.isFinite(observedAtMs)) return null;
  return { type: 'speaker-change' as const, displayName: name, observedAtMs };
}

export function isUsableSpeakerName(value: unknown) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name.length >= 2 && name.length <= 160 && !/^(zoom|participants?|gallery|speaker view|mute|unmute)$/i.test(name);
}
