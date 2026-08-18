import {
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  clampSidebarOpacity,
} from '../config/sidebarPreferences';

export type SidebarMaterialEngine =
  | 'solid'
  | 'renderer'
  | 'native-macos'
  | 'native-windows-mica'
  | 'native-windows-mica-alt'
  | 'native-windows-acrylic';

export type SidebarMaterialFallbackReason =
  | 'unsupported-platform'
  | 'unsupported-electron-version'
  | 'unsupported-os-version'
  | 'native-api-error'
  | 'material-rendering-defect'
  | 'accessibility-override'
  | 'native-feature-disabled'
  | 'frosted-disabled'
  | 'renderer-unavailable'
  | null;

export const SIDEBAR_MATERIAL_SUPPORT_MATRIX = {
  electronMajor: 30,
  macOSMajor: 11,
  // Electron's setBackgroundMaterial support starts on Windows 11 22H2.
  windowsBuild: 22621,
  productionMacEngine: 'native-macos' as const,
  productionMacVibrancy: 'under-window' as const,
  productionWindowsEngine: 'native-windows-acrylic' as const,
  developmentWindowsEngines: ['native-windows-mica', 'native-windows-mica-alt'] as const,
};

export type SidebarMaterialResolution = {
  requestedEngine: SidebarMaterialEngine;
  resolvedEngine: SidebarMaterialEngine;
  fallbackReason: SidebarMaterialFallbackReason;
};

export type SidebarMaterialResolutionInput = {
  platform: string;
  frostedBackgroundEnabled: boolean;
  prefersReducedTransparency: boolean;
  prefersHighContrast?: boolean;
  nativeMacFeatureEnabled: boolean;
  windowsNativeEngine: Extract<
    SidebarMaterialEngine,
    'native-windows-mica' | 'native-windows-mica-alt' | 'native-windows-acrylic'
  > | null;
  nativeMacSupported: boolean;
  windowsNativeSupported: boolean;
  rendererMaterialAvailable?: boolean;
};

export const resolveSidebarMaterial = (
  input: SidebarMaterialResolutionInput
): SidebarMaterialResolution => {
  const requestedEngine: SidebarMaterialEngine =
    input.platform === 'darwin' && input.nativeMacFeatureEnabled
      ? 'native-macos'
      : input.platform === 'win32' && input.windowsNativeEngine
      ? input.windowsNativeEngine
      : 'renderer';

  if (input.prefersReducedTransparency || input.prefersHighContrast === true) {
    return {
      requestedEngine,
      resolvedEngine: 'solid',
      fallbackReason: 'accessibility-override',
    };
  }

  if (!input.frostedBackgroundEnabled) {
    return {
      requestedEngine,
      resolvedEngine: 'renderer',
      fallbackReason: 'frosted-disabled',
    };
  }

  if (requestedEngine === 'renderer') {
    if (input.rendererMaterialAvailable === false) {
      return {
        requestedEngine,
        resolvedEngine: 'solid',
        fallbackReason: 'renderer-unavailable',
      };
    }
    return { requestedEngine, resolvedEngine: 'renderer', fallbackReason: null };
  }

  const supported =
    requestedEngine === 'native-macos' ? input.nativeMacSupported : input.windowsNativeSupported;
  if (!supported) {
    if (input.rendererMaterialAvailable === false) {
      return {
        requestedEngine,
        resolvedEngine: 'solid',
        fallbackReason: 'renderer-unavailable',
      };
    }
    return {
      requestedEngine,
      resolvedEngine: 'renderer',
      fallbackReason:
        input.platform !== 'darwin' && input.platform !== 'win32'
          ? 'unsupported-platform'
          : 'unsupported-os-version',
    };
  }

  return { requestedEngine, resolvedEngine: requestedEngine, fallbackReason: null };
};

export const SIDEBAR_MATERIAL_ALPHA_MIN = 0.84;
export const SIDEBAR_MATERIAL_ALPHA_MAX = 1;

// Native macOS material needs a substantially stronger tint than renderer
// frost. Without it, Electron's transparent window can leave readable content
// from the backing window showing through the sidebar.
export const SIDEBAR_NATIVE_MAC_TINT_ALPHA_MIN = 0.74;
export const SIDEBAR_NATIVE_MAC_TINT_ALPHA_MAX = 0.90;

export const getSidebarMaterialAlpha = (opacity: number) => {
  const normalizedOpacity =
    (clampSidebarOpacity(opacity) - SIDEBAR_OPACITY_MIN) /
    (SIDEBAR_OPACITY_MAX - SIDEBAR_OPACITY_MIN);
  return (
    SIDEBAR_MATERIAL_ALPHA_MIN +
    normalizedOpacity * (SIDEBAR_MATERIAL_ALPHA_MAX - SIDEBAR_MATERIAL_ALPHA_MIN)
  );
};

export const getSidebarNativeMacTintAlpha = (opacity: number) => {
  const normalizedOpacity =
    (clampSidebarOpacity(opacity) - SIDEBAR_OPACITY_MIN) /
    (SIDEBAR_OPACITY_MAX - SIDEBAR_OPACITY_MIN);
  return (
    SIDEBAR_NATIVE_MAC_TINT_ALPHA_MIN +
    normalizedOpacity *
      (SIDEBAR_NATIVE_MAC_TINT_ALPHA_MAX - SIDEBAR_NATIVE_MAC_TINT_ALPHA_MIN)
  );
};
