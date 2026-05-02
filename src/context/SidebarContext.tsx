import React, { createContext, useContext, ReactNode } from 'react'

export type SidebarState = 'minimized' | 'expanded' | 'fullscreen'
export type ModuleView = 'dashboard' | 'calendar'

interface SidebarContextType {
  state: SidebarState
  setState: (state: SidebarState) => void
  toggleExpand: () => void
  moduleView: ModuleView
  setModuleView: (view: ModuleView) => void
  focusDate: string | null
  setFocusDate: (date: string | null) => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = React.useState<SidebarState>('minimized')
  const [moduleView, setModuleView] = React.useState<ModuleView>('dashboard')
  const [focusDate, setFocusDate] = React.useState<string | null>(null)

  const toggleExpand = () => {
    if (state === 'minimized') setState('expanded')
    else if (state === 'expanded') setState('fullscreen')
    else setState('minimized')
  }

  return (
    <SidebarContext.Provider value={{ state, setState, toggleExpand, moduleView, setModuleView, focusDate, setFocusDate }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within SidebarProvider')
  return context
}
