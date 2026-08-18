import type { BrowserWindow } from 'electron';
import {
  resolveSidebarMaterial,
  SIDEBAR_MATERIAL_SUPPORT_MATRIX,
  type SidebarMaterialEngine,
  type SidebarMaterialResolution,
} from '../src/theme/sidebarMaterial';

type NativeWindowsEngine = Extract<
  SidebarMaterialEngine,
  'native-windows-mica' | 'native-windows-mica-alt' | 'native-windows-acrylic'
>;

export type SidebarMacVibrancy = 'under-window' | 'sidebar' | 'hud';
export type SidebarMacVisualEffectState = 'followWindow' | 'active';
export type SidebarMaterialDevelopmentSelection =
  | boolean
  | SidebarMacVibrancy
  | 'mica'
  | 'mica-alt'
  | 'acrylic';

export type SidebarMaterialControllerInput = {
  frostedBackgroundEnabled: boolean;
  prefersReducedTransparency: boolean;
  prefersHighContrast?: boolean;
  nativeMacSupported: boolean;
  windowsNativeSupported: boolean;
  rendererMaterialAvailable?: boolean;
};

export type SidebarMaterialControllerSnapshot = SidebarMaterialResolution & {
  featureFlagEnabled: boolean;
  selectedWindowsEngine: NativeWindowsEngine | null;
  nativeMaterialActive: boolean;
  lastApplicationResult: 'applied' | 'cleared' | 'fallback' | 'unchanged';
  nativeMaterialApplyCount: number;
  nativeMaterialClearCount: number;
  opacityUpdateCount: number;
  lastApplicationTimestamp: number | null;
  rendererMaterialLayerCount: 1;
  rolloutEnabled: boolean;
  killSwitchActive: boolean;
  supportReason: string | null;
  requestedMacVibrancy?: SidebarMacVibrancy;
  resolvedMacVibrancy?: SidebarMacVibrancy | null;
  visualEffectState?: SidebarMacVisualEffectState;
  nativeVibrancyApplied?: boolean;
};

const isNativeWindowsEngine = (engine: SidebarMaterialEngine): engine is NativeWindowsEngine =>
  engine === 'native-windows-mica' ||
  engine === 'native-windows-mica-alt' ||
  engine === 'native-windows-acrylic';

const isSupportedEngine = (platform: NodeJS.Platform, engine: SidebarMaterialEngine) =>
  (platform === 'darwin' && engine === 'native-macos') ||
  (platform === 'win32' && isNativeWindowsEngine(engine));

const isUnexpectedFallback = (reason: SidebarMaterialResolution['fallbackReason']) =>
  reason === 'unsupported-platform' ||
  reason === 'unsupported-electron-version' ||
  reason === 'unsupported-os-version' ||
  reason === 'native-api-error' ||
  reason === 'material-rendering-defect';

export class SidebarMaterialController {
  private readonly platform: NodeJS.Platform;
  private readonly isPackaged: boolean;
  private readonly environment: NodeJS.ProcessEnv;
  private developmentOverride: SidebarMaterialEngine | null;
  private activeNativeEngine: SidebarMaterialEngine = 'renderer';
  private activeWindow: BrowserWindow | null = null;
  private nativeMaterialApplyCount = 0;
  private nativeMaterialClearCount = 0;
  private opacityUpdateCount = 0;
  private lastApplicationTimestamp: number | null = null;
  private readonly failedNativeEngines = new Set<SidebarMaterialEngine>();
  private macVibrancyOverride: SidebarMacVibrancy | null = null;
  private visualEffectStateOverride: SidebarMacVisualEffectState | null = null;
  private snapshot: SidebarMaterialControllerSnapshot;

  constructor({
    platform,
    isPackaged,
    environment,
  }: {
    platform: NodeJS.Platform;
    isPackaged: boolean;
    environment: NodeJS.ProcessEnv;
  }) {
    this.platform = platform;
    this.isPackaged = isPackaged;
    this.environment = environment;
    // Keep Windows development visually representative of the packaged native
    // path. The explicit diagnostics selector can still switch to renderer or
    // Mica for comparison.
    this.developmentOverride = platform === 'win32' ? 'native-windows-acrylic' : null;
    this.snapshot = {
      requestedEngine: 'renderer',
      resolvedEngine: 'renderer',
      fallbackReason: null,
      featureFlagEnabled: false,
      selectedWindowsEngine: null,
      nativeMaterialActive: false,
      lastApplicationResult: 'unchanged',
      nativeMaterialApplyCount: 0,
      nativeMaterialClearCount: 0,
      opacityUpdateCount: 0,
      lastApplicationTimestamp: null,
      rendererMaterialLayerCount: 1,
      rolloutEnabled: false,
      killSwitchActive: false,
      supportReason: null,
      ...this.macDiagnostics(),
    };
  }

  private macVibrancyFromEnvironment(): SidebarMacVibrancy {
    const value = this.environment.LEDGER_SIDEBAR_NATIVE_MACOS_VIBRANCY;
    return value === 'under-window' || value === 'hud' ? value : 'sidebar';
  }

  private macVisualEffectStateFromEnvironment(): SidebarMacVisualEffectState {
    return this.environment.LEDGER_SIDEBAR_NATIVE_MACOS_VISUAL_EFFECT_STATE === 'followWindow'
      ? 'followWindow'
      : 'active';
  }

  private selectedMacVibrancy() {
    return this.macVibrancyOverride ?? this.macVibrancyFromEnvironment();
  }

  private selectedMacVisualEffectState() {
    return this.visualEffectStateOverride ?? this.macVisualEffectStateFromEnvironment();
  }

  private macDiagnostics() {
    const requestedMacVibrancy = this.selectedMacVibrancy();
    return {
      requestedMacVibrancy,
      resolvedMacVibrancy:
        this.activeNativeEngine === 'native-macos' ? requestedMacVibrancy : null,
      visualEffectState: this.selectedMacVisualEffectState(),
      nativeVibrancyApplied: this.activeNativeEngine === 'native-macos',
    };
  }

  private isTruthy(value: string | undefined) {
    return value === '1' || value?.toLowerCase() === 'true';
  }

  private percentage(value: string | undefined) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  }

  private cohortIsIncluded(percentage: number) {
    const cohort = this.environment.LEDGER_SIDEBAR_NATIVE_COHORT;
    if (!cohort || percentage <= 0) return false;
    if (percentage >= 100) return true;
    let hash = 0;
    for (const character of cohort) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % 100 < percentage;
  }

  private productionNativeEngine() {
    if (!this.isPackaged || this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_KILL_SWITCH)) {
      return null;
    }
    // Electron's macOS vibrancy is painted at BrowserWindow level and uses a
    // compositor corner mask that cannot match Ledger's custom sidebar radius.
    // Keep it out of normal releases until we have a native masked material
    // surface; the renderer material preserves the product geometry.
    if (this.platform === 'darwin') return null;
    // Windows Acrylic is the supported packaged default. The environment flag
    // remains an explicit opt-out/rollout control for staged releases, while
    // a normal local build must not silently fall back to renderer glass.
    if (
      this.environment.LEDGER_SIDEBAR_NATIVE_MATERIAL_ENABLED !== undefined &&
      !this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_MATERIAL_ENABLED)
    ) {
      return null;
    }

    const rolloutVariable =
      this.platform === 'win32' ? 'LEDGER_SIDEBAR_NATIVE_WINDOWS_ROLLOUT' : null;
    const rolloutConfigured =
      rolloutVariable !== null &&
      (this.environment[rolloutVariable] !== undefined ||
        this.environment.LEDGER_SIDEBAR_NATIVE_COHORT !== undefined);
    if (rolloutConfigured && !this.cohortIsIncluded(this.percentage(this.environment[rolloutVariable!]))) {
      return null;
    }
    if (this.platform === 'win32') return SIDEBAR_MATERIAL_SUPPORT_MATRIX.productionWindowsEngine;
    return null;
  }

  private requestedNativeEngine() {
    const candidate = this.isPackaged ? this.productionNativeEngine() : this.developmentOverride;
    return isSupportedEngine(this.platform, candidate ?? 'renderer') ? candidate : null;
  }

  setDevelopmentSelection(selection: SidebarMaterialDevelopmentSelection) {
    if (this.isPackaged) return false;

    if (this.platform === 'darwin') {
      if (selection === false) {
        this.developmentOverride = 'renderer';
        return true;
      }
      if (selection === true) {
        this.macVibrancyOverride = SIDEBAR_MATERIAL_SUPPORT_MATRIX.productionMacVibrancy;
      } else if (selection === 'under-window' || selection === 'sidebar' || selection === 'hud') {
        this.macVibrancyOverride = selection;
      } else {
        return false;
      }
      this.developmentOverride = 'native-macos';
      return true;
    }

    if (this.platform === 'win32') {
      if (selection === false) this.developmentOverride = 'renderer';
      else if (selection === true || selection === 'mica') {
        this.developmentOverride = 'native-windows-mica';
      } else if (selection === 'mica-alt') {
        this.developmentOverride = 'native-windows-mica-alt';
      } else if (selection === 'acrylic') {
        this.developmentOverride = 'native-windows-acrylic';
      } else {
        return false;
      }
      return true;
    }

    return false;
  }

  setDevelopmentVisualEffectState(state: SidebarMacVisualEffectState) {
    if (this.isPackaged || this.platform !== 'darwin') return false;
    this.visualEffectStateOverride = state;
    return true;
  }

  getMacVisualEffectState() {
    return this.selectedMacVisualEffectState();
  }

  getSupportState(win: BrowserWindow | null) {
    let windowsBuild = 0;
    try {
      windowsBuild = Number(process.getSystemVersion().split('.')[2]);
    } catch {
      windowsBuild = 0;
    }
    const electronMajor = Number(process.versions.electron.split('.')[0]);
    const macVersion = process.getSystemVersion().split('.').map(Number);
    const macVersionSupported =
      macVersion[0] > SIDEBAR_MATERIAL_SUPPORT_MATRIX.macOSMajor ||
      (macVersion[0] === SIDEBAR_MATERIAL_SUPPORT_MATRIX.macOSMajor && macVersion[1] >= 0);
    const electronSupported = electronMajor >= SIDEBAR_MATERIAL_SUPPORT_MATRIX.electronMajor;
    return {
      nativeMacSupported:
        this.platform === 'darwin' &&
        electronSupported &&
        macVersionSupported &&
        typeof win?.setVibrancy === 'function',
      windowsNativeSupported:
        this.platform === 'win32' &&
        Number.isFinite(windowsBuild) &&
        windowsBuild >= SIDEBAR_MATERIAL_SUPPORT_MATRIX.windowsBuild &&
        electronSupported &&
        typeof win?.setBackgroundMaterial === 'function',
    };
  }

  resolve(input: SidebarMaterialControllerInput): SidebarMaterialResolution {
    const requestedEngine = this.requestedNativeEngine();
    const requestedForWindows = requestedEngine ?? 'renderer';
    const resolution = resolveSidebarMaterial({
      platform: this.platform,
      frostedBackgroundEnabled: input.frostedBackgroundEnabled,
      prefersReducedTransparency: input.prefersReducedTransparency,
      prefersHighContrast: input.prefersHighContrast,
      nativeMacFeatureEnabled: requestedEngine === 'native-macos',
      windowsNativeEngine: isNativeWindowsEngine(requestedForWindows) ? requestedForWindows : null,
      nativeMacSupported: input.nativeMacSupported,
      windowsNativeSupported: input.windowsNativeSupported,
      rendererMaterialAvailable: input.rendererMaterialAvailable,
    });
    if (this.failedNativeEngines.has(resolution.requestedEngine)) {
      return {
        ...resolution,
        resolvedEngine: 'renderer',
        fallbackReason: 'native-api-error',
      };
    }
    return resolution;
  }

  apply(win: BrowserWindow | null, input: SidebarMaterialControllerInput) {
    const resolution = this.resolve(input);
    const featureFlagEnabled = this.requestedNativeEngine() !== null;
    const selectedWindowsEngine = isNativeWindowsEngine(resolution.requestedEngine)
      ? resolution.requestedEngine
      : null;
    const nextIsNative =
      resolution.resolvedEngine !== 'renderer' && resolution.resolvedEngine !== 'solid';

    if (!win || win.isDestroyed()) {
      this.activeWindow = null;
      this.activeNativeEngine = 'renderer';
      this.snapshot = {
        ...resolution,
        featureFlagEnabled,
        selectedWindowsEngine,
        nativeMaterialActive: false,
        lastApplicationResult: 'unchanged',
        nativeMaterialApplyCount: this.nativeMaterialApplyCount,
        nativeMaterialClearCount: this.nativeMaterialClearCount,
        opacityUpdateCount: this.opacityUpdateCount,
        lastApplicationTimestamp: this.lastApplicationTimestamp,
        rendererMaterialLayerCount: 1,
        rolloutEnabled: this.isPackaged && this.productionNativeEngine() !== null,
        killSwitchActive: this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_KILL_SWITCH),
        supportReason: null,
        ...this.macDiagnostics(),
      };
      return this.snapshot;
    }

    const isNewWindow = this.activeWindow !== win;
    if (isNewWindow) {
      this.activeWindow = win;
      this.activeNativeEngine = 'renderer';
    }
    const engineUnchanged =
      !isNewWindow && this.snapshot.resolvedEngine === resolution.resolvedEngine;
    if (engineUnchanged && this.activeNativeEngine === resolution.resolvedEngine) {
      this.snapshot = {
        ...resolution,
        featureFlagEnabled,
        selectedWindowsEngine,
        nativeMaterialActive: nextIsNative,
        lastApplicationResult: isUnexpectedFallback(resolution.fallbackReason)
          ? 'fallback'
          : 'unchanged',
        nativeMaterialApplyCount: this.nativeMaterialApplyCount,
        nativeMaterialClearCount: this.nativeMaterialClearCount,
        opacityUpdateCount: this.opacityUpdateCount,
        lastApplicationTimestamp: this.lastApplicationTimestamp,
        rendererMaterialLayerCount: 1,
        rolloutEnabled: this.isPackaged && this.productionNativeEngine() !== null,
        killSwitchActive: this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_KILL_SWITCH),
        supportReason: null,
        ...this.macDiagnostics(),
      };
      return this.snapshot;
    }

    try {
      if (this.activeNativeEngine !== 'renderer') this.clearNativeMaterial(win);

      if (resolution.resolvedEngine === 'native-macos') {
        win.setVibrancy(this.selectedMacVibrancy());
      } else if (resolution.resolvedEngine === 'native-windows-mica') {
        win.setBackgroundMaterial('mica');
      } else if (resolution.resolvedEngine === 'native-windows-mica-alt') {
        win.setBackgroundMaterial('tabbed');
      } else if (resolution.resolvedEngine === 'native-windows-acrylic') {
        win.setBackgroundMaterial('acrylic');
      }

      if (nextIsNative) {
        this.nativeMaterialApplyCount += 1;
        this.lastApplicationTimestamp = Date.now();
      }

      this.activeNativeEngine = nextIsNative ? resolution.resolvedEngine : 'renderer';
      this.snapshot = {
        ...resolution,
        featureFlagEnabled,
        selectedWindowsEngine,
        nativeMaterialActive: nextIsNative,
        lastApplicationResult: isUnexpectedFallback(resolution.fallbackReason)
          ? 'fallback'
          : nextIsNative
          ? 'applied'
          : 'cleared',
        nativeMaterialApplyCount: this.nativeMaterialApplyCount,
        nativeMaterialClearCount: this.nativeMaterialClearCount,
        opacityUpdateCount: this.opacityUpdateCount,
        lastApplicationTimestamp: this.lastApplicationTimestamp,
        rendererMaterialLayerCount: 1,
        rolloutEnabled: this.isPackaged && this.productionNativeEngine() !== null,
        killSwitchActive: this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_KILL_SWITCH),
        supportReason: null,
        ...this.macDiagnostics(),
      };
      return this.snapshot;
    } catch {
      this.failedNativeEngines.add(resolution.requestedEngine);
      try {
        this.clearNativeMaterial(win);
      } catch {}
      this.activeNativeEngine = 'renderer';
      this.snapshot = {
        ...resolution,
        resolvedEngine: resolution.resolvedEngine === 'solid' ? 'solid' : 'renderer',
        fallbackReason:
          resolution.resolvedEngine === 'solid' ? resolution.fallbackReason : 'native-api-error',
        featureFlagEnabled,
        selectedWindowsEngine,
        nativeMaterialActive: false,
        lastApplicationResult: 'fallback',
        nativeMaterialApplyCount: this.nativeMaterialApplyCount,
        nativeMaterialClearCount: this.nativeMaterialClearCount,
        opacityUpdateCount: this.opacityUpdateCount,
        lastApplicationTimestamp: this.lastApplicationTimestamp,
        rendererMaterialLayerCount: 1,
        rolloutEnabled: this.isPackaged && this.productionNativeEngine() !== null,
        killSwitchActive: this.isTruthy(this.environment.LEDGER_SIDEBAR_NATIVE_KILL_SWITCH),
        supportReason: 'native-api-error',
        ...this.macDiagnostics(),
      };
      return this.snapshot;
    }
  }

  private clearNativeMaterial(win: BrowserWindow) {
    if (this.platform === 'darwin') {
      win.setVibrancy(null);
      this.nativeMaterialClearCount += 1;
      this.lastApplicationTimestamp = Date.now();
    } else if (this.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
      win.setBackgroundMaterial('none');
      this.nativeMaterialClearCount += 1;
      this.lastApplicationTimestamp = Date.now();
    }
  }

  noteOpacityUpdate() {
    this.opacityUpdateCount += 1;
  }

  resetDiagnostics() {
    this.nativeMaterialApplyCount = 0;
    this.nativeMaterialClearCount = 0;
    this.opacityUpdateCount = 0;
    this.lastApplicationTimestamp = null;
    this.snapshot = {
      ...this.snapshot,
      nativeMaterialApplyCount: 0,
      nativeMaterialClearCount: 0,
      opacityUpdateCount: 0,
      lastApplicationTimestamp: null,
    };
    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }
}
