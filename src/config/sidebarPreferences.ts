export type SidebarPosition = 'right' | 'left' | 'top' | 'bottom' | 'floating'

export type SidebarFloatingPosition = {
  x: number
  y: number
}

export type SidebarPreferences = {
  position: SidebarPosition
  isExpanded: boolean
  isHidden: boolean
  floatingPosition: SidebarFloatingPosition
}

export const SIDEBAR_PREFERENCES_STORAGE_KEY = 'ledger:sidebar:v1'

export const defaultSidebarPreferences: SidebarPreferences = {
  position: 'right',
  isExpanded: true,
  isHidden: false,
  floatingPosition: { x: 100, y: 200 },
}

export const loadSidebarPreferences = (): SidebarPreferences => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY)
    if (!raw) return defaultSidebarPreferences

    const parsed = JSON.parse(raw) as Partial<SidebarPreferences> | null
    const legacyVisible = (parsed as { isVisible?: boolean } | null)?.isVisible
    return {
      position: parsed?.position ?? defaultSidebarPreferences.position,
      isExpanded: parsed?.isExpanded ?? true,
      isHidden: parsed?.isHidden ?? legacyVisible === false,
      floatingPosition: {
        x: parsed?.floatingPosition?.x ?? defaultSidebarPreferences.floatingPosition.x,
        y: parsed?.floatingPosition?.y ?? defaultSidebarPreferences.floatingPosition.y,
      },
    }
  } catch {
    return defaultSidebarPreferences
  }
}

export const saveSidebarPreferences = (preferences: SidebarPreferences) => {
  window.localStorage.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
}