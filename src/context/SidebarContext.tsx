import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import {
  loadSidebarPreferences,
  saveSidebarPreferences,
  type SidebarFloatingPosition,
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
  isHidden: boolean
  setIsHidden: (isHidden: boolean) => void
  toggleHidden: () => void
  isVisible: boolean
  setIsVisible: (isVisible: boolean) => void
  toggleVisibility: () => void
  position: SidebarPosition
  setPosition: (position: SidebarPosition) => void
  floatingPosition: SidebarFloatingPosition
  setFloatingPosition: (position: SidebarFloatingPosition) => void
  sidebarPreferences: SidebarPreferences
  moduleView: ModuleView
  setModuleView: (view: ModuleView) => void
  focusDate: string | null
  setFocusDate: (date: string | null) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(() => loadSidebarPreferences())
  const [state, setSidebarState] = React.useState<SidebarState>('minimized')
  const [moduleView, setModuleView] = React.useState<ModuleView>('dashboard')
  const [focusDate, setFocusDate] = React.useState<string | null>(null)

  useEffect(() => {
    saveSidebarPreferences(sidebarPreferences)
  }, [sidebarPreferences])

  const toggleExpand = () => {
    setIsExpanded(!sidebarPreferences.isExpanded)
  }

  const setState = (nextState: SidebarState) => {
    setSidebarState(nextState)
    if (nextState === 'fullscreen') return

    setSidebarPreferences((current) => ({
      ...current,
      isExpanded: true,
    }))
  }

  const setIsExpanded = (isExpanded: boolean) => {
    setSidebarPreferences((current) => ({
      ...current,
      isExpanded,
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
        isHidden: sidebarPreferences.isHidden,
        setIsHidden,
        toggleHidden,
        isVisible: !sidebarPreferences.isHidden,
        setIsVisible,
        toggleVisibility,
        position: sidebarPreferences.position,
        setPosition,
        floatingPosition: sidebarPreferences.floatingPosition,
        setFloatingPosition,
        sidebarPreferences,
        moduleView,
        setModuleView,
        focusDate,
        setFocusDate,
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
