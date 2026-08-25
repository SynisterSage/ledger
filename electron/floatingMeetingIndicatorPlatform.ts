export function getFloatingMeetingIndicatorPlatformOptions(platform: string) {
  return {
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    ...(platform === 'darwin'
      ? { type: 'panel' as const, visibleOnAllWorkspaces: true }
      : {}),
  };
}
