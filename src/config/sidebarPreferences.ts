export type SidebarPosition = 'right' | 'left' | 'top' | 'bottom' | 'floating';

export type SidebarDefaultState = 'expanded' | 'collapsed' | 'remember';

export type SidebarFloatingPosition = {
  x: number;
  y: number;
};

export type SidebarPreferences = {
  position: SidebarPosition;
  opacity: number;
  frostedBackgroundEnabled: boolean;
  defaultState: SidebarDefaultState;
  alwaysOnTop: boolean;
  autoHide: boolean;
  isExpanded: boolean;
  collapsedRestoreIsExpanded: boolean;
  collapsedRestoreView: 'expanded' | 'rail' | 'collapsed';
  isHidden: boolean;
  floatingPosition: SidebarFloatingPosition;
  floatingDockEnabled: boolean;
  floatingDockThreshold: number;
  lastState: 'expanded' | 'collapsed';
};

export const SIDEBAR_PREFERENCES_STORAGE_KEY = 'ledger:sidebar:v1';
export const SIDEBAR_OPACITY_MIN = 0.7;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_SETTINGS_MIGRATION_VERSION = 2;
export const clampSidebarOpacity = (value: number) =>
  Number.isFinite(value)
    ? Math.max(SIDEBAR_OPACITY_MIN, Math.min(SIDEBAR_OPACITY_MAX, value))
    : defaultSidebarPreferences.opacity;
const getDefaultSidebarOpacity = () => 0.9;
const isSidebarPosition = (value: unknown): value is SidebarPosition =>
  value === 'right' ||
  value === 'left' ||
  value === 'top' ||
  value === 'bottom' ||
  value === 'floating';
const isSidebarDefaultState = (value: unknown): value is SidebarDefaultState =>
  value === 'expanded' || value === 'collapsed' || value === 'remember';
const isCollapsedRestoreView = (value: unknown): value is SidebarPreferences['collapsedRestoreView'] =>
  value === 'expanded' || value === 'rail' || value === 'collapsed';
const isSidebarState = (value: unknown): value is SidebarPreferences['lastState'] =>
  value === 'expanded' || value === 'collapsed';

export const defaultSidebarPreferences: SidebarPreferences = {
  position: 'right',
  opacity: getDefaultSidebarOpacity(),
  frostedBackgroundEnabled: true,
  defaultState: 'collapsed',
  alwaysOnTop: false,
  autoHide: false,
  isExpanded: true,
  collapsedRestoreIsExpanded: true,
  collapsedRestoreView: 'expanded',
  isHidden: false,
  floatingPosition: { x: 100, y: 200 },
  floatingDockEnabled: true,
  floatingDockThreshold: 28,
  lastState: 'expanded',
};

export const normalizeSidebarPreferences = (
  parsed: Partial<SidebarPreferences> & {
    blur?: unknown;
    sidebarSettingsVersion?: number;
    floatingSnapEnabled?: boolean;
    floatingSnapThreshold?: number;
  }
): SidebarPreferences => {
  const legacyVisible = (parsed as { isVisible?: boolean }).isVisible;
  const legacyExpanded = parsed.isExpanded;
  const legacyRestoreView: SidebarPreferences['collapsedRestoreView'] =
    parsed.collapsedRestoreView ??
    (parsed.lastState === 'collapsed'
      ? legacyExpanded === false
        ? 'collapsed'
        : 'rail'
      : 'expanded');
  const frostedBackgroundEnabled =
    typeof parsed.frostedBackgroundEnabled === 'boolean'
      ? parsed.frostedBackgroundEnabled
      : typeof parsed.blur === 'boolean'
      ? parsed.blur
      : defaultSidebarPreferences.frostedBackgroundEnabled;

  return {
    position: isSidebarPosition(parsed.position)
      ? parsed.position
      : defaultSidebarPreferences.position,
    opacity:
      typeof parsed.opacity === 'number'
        ? clampSidebarOpacity(parsed.opacity)
        : defaultSidebarPreferences.opacity,
    frostedBackgroundEnabled,
    defaultState: isSidebarDefaultState(parsed.defaultState)
      ? parsed.defaultState
      : defaultSidebarPreferences.defaultState,
    alwaysOnTop: parsed.alwaysOnTop ?? defaultSidebarPreferences.alwaysOnTop,
    autoHide: parsed.autoHide ?? defaultSidebarPreferences.autoHide,
    isExpanded: parsed.isExpanded ?? legacyExpanded ?? true,
    collapsedRestoreIsExpanded: parsed.collapsedRestoreIsExpanded ?? legacyExpanded ?? true,
    collapsedRestoreView: isCollapsedRestoreView(legacyRestoreView)
      ? legacyRestoreView
      : defaultSidebarPreferences.collapsedRestoreView,
    isHidden: parsed.isHidden ?? legacyVisible === false,
    floatingPosition: {
      x:
        typeof parsed.floatingPosition?.x === 'number' && Number.isFinite(parsed.floatingPosition.x)
          ? parsed.floatingPosition.x
          : defaultSidebarPreferences.floatingPosition.x,
      y:
        typeof parsed.floatingPosition?.y === 'number' && Number.isFinite(parsed.floatingPosition.y)
          ? parsed.floatingPosition.y
          : defaultSidebarPreferences.floatingPosition.y,
    },
    floatingDockEnabled:
      parsed.floatingDockEnabled ??
      parsed.floatingSnapEnabled ??
      defaultSidebarPreferences.floatingDockEnabled,
    floatingDockThreshold:
      typeof parsed.floatingDockThreshold === 'number'
        ? Math.max(8, Math.min(80, parsed.floatingDockThreshold))
        : typeof parsed.floatingSnapThreshold === 'number'
        ? Math.max(8, Math.min(80, parsed.floatingSnapThreshold))
        : defaultSidebarPreferences.floatingDockThreshold,
    lastState: isSidebarState(parsed.lastState)
      ? parsed.lastState
      : legacyExpanded === false
      ? 'collapsed'
      : defaultSidebarPreferences.lastState,
  };
};

export const loadSidebarPreferences = (): SidebarPreferences => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultSidebarPreferences;

    const parsed = JSON.parse(raw) as
      | (Partial<SidebarPreferences> & {
          blur?: unknown;
          sidebarSettingsVersion?: number;
          floatingSnapEnabled?: boolean;
          floatingSnapThreshold?: number;
        })
      | null;
    const normalized = normalizeSidebarPreferences(parsed ?? {});
    const hadLegacyBlur = typeof parsed?.blur === 'boolean';
    const needsMigration = hadLegacyBlur || parsed?.sidebarSettingsVersion !== SIDEBAR_SETTINGS_MIGRATION_VERSION;
    if (needsMigration) saveSidebarPreferences(normalized);
    return normalized;
  } catch {
    return defaultSidebarPreferences;
  }
};

export const saveSidebarPreferences = (preferences: SidebarPreferences) => {
  window.localStorage.setItem(
    SIDEBAR_PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      ...preferences,
      sidebarSettingsVersion: SIDEBAR_SETTINGS_MIGRATION_VERSION,
      opacity: clampSidebarOpacity(preferences.opacity),
      frostedBackgroundEnabled: Boolean(preferences.frostedBackgroundEnabled),
      floatingDockThreshold: Math.max(8, Math.min(80, preferences.floatingDockThreshold)),
      floatingSnapEnabled: preferences.floatingDockEnabled,
      floatingSnapThreshold: Math.max(8, Math.min(80, preferences.floatingDockThreshold)),
    })
  );
};
