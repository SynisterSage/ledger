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

  const childrenNode = (
    <div
      className={`flex-1 flex flex-col overflow-hidden bg-transparent ${
        position === 'left' || position === 'top' ? 'order-2' : 'order-1'
      }`}
    >
      {children}
    </div>
  )

  // Fullscreen mode: no sidebar
  if (state === 'fullscreen') {
    return (
      <div className="relative h-screen overflow-hidden bg-transparent">
        {childrenNode}
      </div>
    )
  }

  // Floating mode: sidebar floats above everything
  if (isFloating) {
    return (
      <div className="relative h-screen overflow-hidden bg-transparent">
        {shouldShowSidebar && <SidebarContainer />}
      </div>
    )
  }

  const sidebarNode = shouldShowSidebar ? (
    <div className={`${isHorizontal ? 'w-full' : ''} shrink-0 self-stretch ${position === 'left' || position === 'top' ? 'order-1' : 'order-2'}`}>
      <SidebarContainer />
    </div>
  ) : null

  // Docked positions
  if (isHorizontal) {
    // Top or bottom position (horizontal layout)
    return (
      <div className="relative h-screen overflow-hidden bg-transparent flex flex-col">
        {sidebarNode}
        {childrenNode}
      </div>
    )
  } else {
    // Left or right position (vertical layout)
    return (
      <div className="relative h-screen overflow-hidden bg-transparent flex items-stretch">
        {sidebarNode}
        {childrenNode}
      </div>
    )
  }
}
