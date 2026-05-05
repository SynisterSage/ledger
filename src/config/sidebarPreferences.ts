export type SidebarPosition = 'right' | 'left' | 'top' | 'bottom' | 'floating'

export type SidebarDefaultState = 'expanded' | 'collapsed' | 'remember'

export type SidebarFloatingPosition = {
  x: number
  y: number
}

export type SidebarPreferences = {
  position: SidebarPosition
  opacity: number
  blur: boolean
  defaultState: SidebarDefaultState
  alwaysOnTop: boolean
  autoHide: boolean
  isExpanded: boolean
  collapsedRestoreIsExpanded: boolean
  collapsedRestoreView: 'expanded' | 'rail' | 'collapsed'
  isHidden: boolean
  floatingPosition: SidebarFloatingPosition
  lastState: 'expanded' | 'collapsed'
}

export const SIDEBAR_PREFERENCES_STORAGE_KEY = 'ledger:sidebar:v1'
const clampSidebarOpacity = (value: number) => Math.max(0.7, Math.min(0.95, value))

export const defaultSidebarPreferences: SidebarPreferences = {
  position: 'right',
  opacity: 0.82,
  blur: true,
  defaultState: 'remember',
  alwaysOnTop: true,
  autoHide: false,
  isExpanded: true,
  collapsedRestoreIsExpanded: true,
  collapsedRestoreView: 'expanded',
  isHidden: false,
  floatingPosition: { x: 100, y: 200 },
  lastState: 'expanded',
}

export const loadSidebarPreferences = (): SidebarPreferences => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY)
    if (!raw) return defaultSidebarPreferences

    const parsed = JSON.parse(raw) as Partial<SidebarPreferences> | null
    
    // ExpandedSidebar only supports vertical positions (left/right/floating)
    // Reset to default if horizontal position is stored
    if (parsed?.position === 'top' || parsed?.position === 'bottom') {
      window.localStorage.removeItem(SIDEBAR_PREFERENCES_STORAGE_KEY)
      return defaultSidebarPreferences
    }
    
    const legacyVisible = (parsed as { isVisible?: boolean } | null)?.isVisible
    const legacyExpanded = (parsed as { isExpanded?: boolean } | null)?.isExpanded
    const legacyRestoreView: SidebarPreferences['collapsedRestoreView'] =
      parsed?.collapsedRestoreView ??
      (parsed?.lastState === 'collapsed'
        ? legacyExpanded === false
          ? 'collapsed'
          : 'rail'
        : 'expanded')
    return {
      position: parsed?.position ?? defaultSidebarPreferences.position,
      opacity:
        typeof parsed?.opacity === 'number'
          ? clampSidebarOpacity(parsed.opacity)
          : defaultSidebarPreferences.opacity,
      blur: true,
      defaultState: parsed?.defaultState ?? defaultSidebarPreferences.defaultState,
      alwaysOnTop: parsed?.alwaysOnTop ?? defaultSidebarPreferences.alwaysOnTop,
      autoHide: parsed?.autoHide ?? defaultSidebarPreferences.autoHide,
      isExpanded: parsed?.isExpanded ?? legacyExpanded ?? true,
      collapsedRestoreIsExpanded:
        parsed?.collapsedRestoreIsExpanded ?? (legacyExpanded ?? true),
      collapsedRestoreView: legacyRestoreView,
      isHidden: parsed?.isHidden ?? legacyVisible === false,
      floatingPosition: {
        x: parsed?.floatingPosition?.x ?? defaultSidebarPreferences.floatingPosition.x,
        y: parsed?.floatingPosition?.y ?? defaultSidebarPreferences.floatingPosition.y,
      },
      lastState: parsed?.lastState ?? (legacyExpanded === false ? 'collapsed' : 'expanded'),
    }
  } catch {
    return defaultSidebarPreferences
  }
}

export const saveSidebarPreferences = (preferences: SidebarPreferences) => {
  window.localStorage.setItem(
    SIDEBAR_PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      ...preferences,
      opacity: clampSidebarOpacity(preferences.opacity),
    }),
  )
}
