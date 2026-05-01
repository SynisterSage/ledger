import React, { createContext, useContext, ReactNode } from 'react'

export type SidebarState = 'minimized' | 'expanded' | 'fullscreen'

interface SidebarContextType {
  state: SidebarState
  setState: (state: SidebarState) => void
  toggleExpand: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = React.useState<SidebarState>('minimized')

  const toggleExpand = () => {
    if (state === 'minimized') setState('expanded')
    else if (state === 'expanded') setState('fullscreen')
    else setState('minimized')
  }

  return (
    <SidebarContext.Provider value={{ state, setState, toggleExpand }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within SidebarProvider')
  return context
}
