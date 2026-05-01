import { useSidebar } from '../../context/SidebarContext'
import { MinimizedSidebar } from './MinimizedSidebar'
import { ExpandedSidebar } from './ExpandedSidebar'

export const SidebarContainer = () => {
  const { state } = useSidebar()

  if (state === 'fullscreen') return null

  return (
    <div>
      {state === 'minimized' && <MinimizedSidebar />}
      {state === 'expanded' && <ExpandedSidebar />}
    </div>
  )
}
