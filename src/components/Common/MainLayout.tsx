import { ReactNode } from 'react'
import { useSidebar } from '../../context/SidebarContext'
import { SidebarContainer } from '../Sidebar/SidebarContainer'

interface MainLayoutProps {
  children: ReactNode
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  const { state, isVisible, position } = useSidebar()
  const isHorizontal = position === 'top' || position === 'bottom'
  const isFloating = position === 'floating'
  const shouldShowSidebar = state !== 'fullscreen' && isVisible
  const sidebarNode = shouldShowSidebar ? (
    <div className={isHorizontal ? 'w-full shrink-0 self-stretch' : 'shrink-0 self-stretch'}>
      <SidebarContainer />
    </div>
  ) : null

  return (
    <div className={`relative h-screen overflow-hidden bg-gray-50 ${isHorizontal ? 'flex flex-col' : 'flex items-stretch'}`}>
      {shouldShowSidebar && !isFloating && (
        position === 'top' ? sidebarNode : null
      )}

      {state === 'fullscreen' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {children}
        </div>
      )}

      {shouldShowSidebar && !isFloating && position !== 'top' && (
        sidebarNode
      )}

      {shouldShowSidebar && isFloating && (
        <SidebarContainer />
      )}
    </div>
  )
}
