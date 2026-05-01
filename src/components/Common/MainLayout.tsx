import { ReactNode } from 'react'
import { useSidebar } from '../../context/SidebarContext'
import { SidebarContainer } from '../Sidebar/SidebarContainer'

interface MainLayoutProps {
  children: ReactNode
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  const { state } = useSidebar()

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar - Hidden in fullscreen */}
      {state !== 'fullscreen' && (
        <div>
          <SidebarContainer />
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden ${state === 'fullscreen' ? 'bg-white' : ''}`}>
        {children}
      </div>
    </div>
  )
}
