import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import {
  SIDEBAR_PREFERENCES_STORAGE_KEY,
  loadSidebarPreferences,
  saveSidebarPreferences,
  type SidebarFloatingPosition,
  type SidebarDefaultState,
  type SidebarPosition,
  type SidebarPreferences,
} from '../config/sidebarPreferences'

export type SidebarState = 'minimized' | 'expanded' | 'fullscreen'
export type ModuleView = 'dashboard' | 'calendar'

interface SidebarContextType {
  state: SidebarState
  setState: (state: SidebarState) => void
  toggleExpand: () => void
  isExpanded: boolean
  setIsExpanded: (isExpanded: boolean) => void
  collapsedRestoreIsExpanded: boolean
  isHidden: boolean
  setIsHidden: (isHidden: boolean) => void
  toggleHidden: () => void
  isVisible: boolean
  setIsVisible: (isVisible: boolean) => void
  toggleVisibility: () => void
  position: SidebarPosition
  setPosition: (position: SidebarPosition) => void
  opacity: number
  setOpacity: (opacity: number) => void
  blur: boolean
  setBlur: (blur: boolean) => void
  defaultState: SidebarDefaultState
  setDefaultState: (defaultState: SidebarDefaultState) => void
  alwaysOnTop: boolean
  setAlwaysOnTop: (alwaysOnTop: boolean) => void
  autoHide: boolean
  setAutoHide: (autoHide: boolean) => void
  setFloatingDockEnabled: (enabled: boolean) => void
  setFloatingDockThreshold: (threshold: number) => void
  collapseSidebar: () => void
  collapseToRail: () => void
  restoreSidebarView: () => void
  floatingPosition: SidebarFloatingPosition
  setFloatingPosition: (position: SidebarFloatingPosition) => void
  isFloatingDocked: boolean
  sidebarPreferences: SidebarPreferences
  moduleView: ModuleView
  setModuleView: (view: ModuleView) => void
  focusDate: string | null
  setFocusDate: (date: string | null) => void
  isHydrated: boolean
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(() => loadSidebarPreferences())
  const [isHydrated, setIsHydrated] = React.useState(false)
  const didNormalizeFloatingStartupRef = React.useRef(false)
  const wasFloatingDockedRef = React.useRef(false)
  const [isFloatingDocked, setIsFloatingDocked] = React.useState(false)
  const [state, setSidebarState] = React.useState<SidebarState>(() => {
    const prefs = loadSidebarPreferences()
    if (prefs.defaultState === 'expanded') return 'expanded'
    if (prefs.defaultState === 'collapsed') return 'minimized'
    return prefs.lastState === 'collapsed' ? 'minimized' : 'expanded'
  })
  const [moduleView, setModuleView] = React.useState<ModuleView>('dashboard')
  const [focusDate, setFocusDate] = React.useState<string | null>(null)

  useEffect(() => {
    saveSidebarPreferences(sidebarPreferences)
    // preferences saved; mark hydrated after initial preferences write
    if (!isHydrated) setIsHydrated(true)
  }, [sidebarPreferences])

  useEffect(() => {
    const handlePreferenceSync = (_event: unknown, nextPreferences: Partial<SidebarPreferences>) => {
      let didChange = false

      setSidebarPreferences((current) => {
        const mergedPreferences = {
          ...current,
          ...nextPreferences,
        }

        didChange = JSON.stringify(mergedPreferences) !== JSON.stringify(current)

        return didChange ? mergedPreferences : current
      })

      if (!didChange) return

      if (typeof nextPreferences.isExpanded === 'boolean' && state !== 'fullscreen') {
        setSidebarState(nextPreferences.isExpanded ? 'expanded' : 'minimized')
      }
    }

    window.ipcRenderer?.on('sidebar:preferences-updated', handlePreferenceSync)
    return () => {
      window.ipcRenderer?.off('sidebar:preferences-updated', handlePreferenceSync)
    }
  }, [state])

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== SIDEBAR_PREFERENCES_STORAGE_KEY) return

      const nextPreferences = loadSidebarPreferences()
      setSidebarPreferences(nextPreferences)

      if (state !== 'fullscreen') {
        setSidebarState(nextPreferences.lastState === 'collapsed' ? 'minimized' : 'expanded')
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [state])

  useEffect(() => {
    if (didNormalizeFloatingStartupRef.current) return
    if (!isHydrated) return
    if (sidebarPreferences.position !== 'floating') return
    if (state !== 'minimized' && sidebarPreferences.lastState !== 'collapsed') {
      didNormalizeFloatingStartupRef.current = true
      return
    }

    didNormalizeFloatingStartupRef.current = true
    setSidebarState('minimized')
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: true,
      collapsedRestoreView: 'expanded',
      isExpanded: true,
      lastState: 'collapsed',
    }))
  }, [isHydrated, sidebarPreferences.lastState, sidebarPreferences.position, state])

  useEffect(() => {
    const handleFloatingDockChanged = (_event: unknown, payload: { isDocked?: boolean }) => {
      const nextIsDocked = Boolean(payload?.isDocked)
      const wasDocked = wasFloatingDockedRef.current

      wasFloatingDockedRef.current = nextIsDocked
      setIsFloatingDocked(nextIsDocked)

      if (wasDocked && !nextIsDocked && sidebarPreferences.position === 'floating' && state === 'minimized') {
        setSidebarPreferences((current) => ({
          ...current,
          collapsedRestoreIsExpanded: true,
          collapsedRestoreView: 'expanded',
          isExpanded: true,
          lastState: 'collapsed',
        }))
      }
    }

    window.ipcRenderer?.on('sidebar:floating-dock-changed', handleFloatingDockChanged)
    return () => {
      window.ipcRenderer?.off('sidebar:floating-dock-changed', handleFloatingDockChanged)
    }
  }, [sidebarPreferences.position, state])

  const toggleExpand = () => {
    setState(state === 'expanded' ? 'minimized' : 'expanded')
  }

  const setState = (nextState: SidebarState) => {
    setSidebarState(nextState)
    if (nextState === 'fullscreen') return

    setSidebarPreferences((current) => ({
      ...current,
      isExpanded: nextState === 'expanded',
      lastState: nextState === 'expanded' ? 'expanded' : 'collapsed',
    }))
  }

  const setIsExpanded = (isExpanded: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: isExpanded ? current.collapsedRestoreIsExpanded : current.isExpanded,
      isExpanded,
    }))
  }

  const collapseSidebar = () => {
    const nextRestoreView: SidebarPreferences['collapsedRestoreView'] =
      state === 'expanded' ? 'expanded' : sidebarPreferences.isExpanded ? 'rail' : 'collapsed'
    setSidebarState('minimized')
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: current.isExpanded,
      collapsedRestoreView: nextRestoreView,
      isExpanded: false,
      lastState: 'collapsed',
    }))
  }

  const collapseToRail = () => {
    setSidebarState('minimized')
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: true,
      collapsedRestoreView: 'expanded',
      isExpanded: true,
      lastState: 'collapsed',
    }))
  }

  const restoreSidebarView = () => {
    const restoreView = sidebarPreferences.collapsedRestoreView

    if (restoreView === 'expanded') {
      setSidebarState('expanded')
      setSidebarPreferences((current) => ({
        ...current,
        isExpanded: true,
        lastState: 'expanded',
      }))
      return
    }

    setSidebarState('minimized')
    setSidebarPreferences((current) => ({
      ...current,
      collapsedRestoreIsExpanded: restoreView === 'rail',
      isExpanded: restoreView === 'rail',
      lastState: 'collapsed',
    }))
  }

  const setIsHidden = (isHidden: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      isHidden,
    }))
  }

  const toggleHidden = () => {
    setSidebarPreferences((current) => ({
      ...current,
      isHidden: !current.isHidden,
    }))
  }

  const setIsVisible = (isVisible: boolean) => {
    setIsHidden(!isVisible)
  }

  const toggleVisibility = () => {
    toggleHidden()
  }

  const setPosition = (position: SidebarPosition) => {
    setSidebarPreferences((current) => ({
      ...current,
      position,
    }))
  }

  const setOpacity = (opacity: number) => {
    const clampedOpacity = Math.max(0.7, Math.min(0.95, opacity))
    setSidebarPreferences((current) => ({
      ...current,
      opacity: clampedOpacity,
    }))
  }

  const setBlur = (blur: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      blur,
    }))
  }

  const setDefaultState = (defaultState: SidebarDefaultState) => {
    setSidebarPreferences((current) => ({
      ...current,
      defaultState,
    }))
  }

  const setAlwaysOnTop = (alwaysOnTop: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      alwaysOnTop,
    }))
  }

  const setAutoHide = (autoHide: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      autoHide,
    }))
  }

  const setFloatingDockEnabled = (floatingDockEnabled: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      floatingDockEnabled,
    }))
  }

  const setFloatingDockThreshold = (floatingDockThreshold: number) => {
    const clamped = Math.max(8, Math.min(80, floatingDockThreshold))
    setSidebarPreferences((current) => ({
      ...current,
      floatingDockThreshold: clamped,
    }))
  }

  const setFloatingPosition = (floatingPosition: SidebarFloatingPosition) => {
    setSidebarPreferences((current) => ({
      ...current,
      floatingPosition,
    }))
  }

  return (
    <SidebarContext.Provider
      value={{
        state,
        setState,
        toggleExpand,
        isExpanded: sidebarPreferences.isExpanded,
        setIsExpanded,
        collapsedRestoreIsExpanded: sidebarPreferences.collapsedRestoreIsExpanded,
        isHidden: sidebarPreferences.isHidden,
        setIsHidden,
        toggleHidden,
        isVisible: !sidebarPreferences.isHidden,
        setIsVisible,
        toggleVisibility,
        position: sidebarPreferences.position,
        setPosition,
        opacity: sidebarPreferences.opacity,
        setOpacity,
        blur: sidebarPreferences.blur,
        setBlur,
        defaultState: sidebarPreferences.defaultState,
        setDefaultState,
        alwaysOnTop: sidebarPreferences.alwaysOnTop,
        setAlwaysOnTop,
        autoHide: sidebarPreferences.autoHide,
        setAutoHide,
        setFloatingDockEnabled,
        setFloatingDockThreshold,
        collapseSidebar,
        collapseToRail,
        restoreSidebarView,
        floatingPosition: sidebarPreferences.floatingPosition,
        setFloatingPosition,
        isFloatingDocked,
        sidebarPreferences,
        moduleView,
        setModuleView,
        focusDate,
        setFocusDate,
        isHydrated,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within SidebarProvider')
  return context
}
