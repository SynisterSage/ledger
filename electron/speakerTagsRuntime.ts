import path from 'node:path';

export function resolveZoomAccessibilityBridgePath(input: { isPackaged: boolean; resourcesPath: string; appPath: string }) {
  return input.isPackaged
    ? path.join(input.resourcesPath, 'ZoomAccessibilityBridge')
    : path.join(input.appPath, 'native', 'ZoomAccessibilityBridge');
}
