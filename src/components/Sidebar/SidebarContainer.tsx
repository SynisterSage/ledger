import { useSidebar } from '../../context/SidebarContext'
import { MinimizedSidebar } from './MinimizedSidebar'
import { ExpandedSidebar } from './ExpandedSidebar'
import { CollapsedSidebar } from './CollapsedSidebar'

export const SidebarContainer = () => {
  const { state, isVisible, isExpanded, position, floatingPosition } = useSidebar()

  if (!isVisible || state === 'fullscreen') return null

  const isFloating = position === 'floating'
  const isHorizontal = position === 'top' || position === 'bottom'
  const shellSizeClasses = isExpanded
    ? isHorizontal
      ? 'w-full h-16'
      : 'w-80 h-full'
    : 'w-16 h-16'

  const wrapperStyle = isFloating
    ? {
        position: 'fixed' as const,
        left: floatingPosition.x,
        top: floatingPosition.y,
        zIndex: 30,
      }
    : undefined

  const shellStyle = isExpanded
    ? wrapperStyle
    : {
        ...wrapperStyle,
        width: 64,
        height: 64,
        alignSelf: 'flex-start' as const,
      }

  return (
    <div
      style={shellStyle}
      className={`relative overflow-hidden transition-all duration-300 ease-in-out ${shellSizeClasses}`}
    >
      {state === 'expanded' && (
        <div className='h-full w-full'>
          <ExpandedSidebar />
        </div>
      )}

      {state === 'minimized' && isExpanded && (
        <div className='h-full w-full'>
          <MinimizedSidebar />
        </div>
      )}

      {state === 'minimized' && !isExpanded && (
        <div className='h-full w-full'>
          <CollapsedSidebar />
        </div>
      )}
    </div>
  )
}
