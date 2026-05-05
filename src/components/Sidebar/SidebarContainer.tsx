import { useEffect, useState, useRef } from 'react'
import { useSidebar } from '../../context/SidebarContext'
import { MinimizedSidebar } from './MinimizedSidebar'
import { ExpandedSidebar } from './ExpandedSidebar'
import { CollapsedSidebar } from './CollapsedSidebar'

export const SidebarContainer = () => {
  const { state, isVisible, isExpanded, position, opacity, blur, autoHide, setState, setIsExpanded, floatingPosition, setFloatingPosition: saveFloatingPosition, isHydrated } = useSidebar()
  const [isHovered, setIsHovered] = useState(false)
  const suppressAutoHideExpandRef = useRef(false)
  const suppressAutoHideResetTimerRef = useRef<number | null>(null)
  const autoHideFadeTimerRef = useRef<number | null>(null)
  const autoHideCollapseTimerRef = useRef<number | null>(null)
  const [isAutoHideFading, setIsAutoHideFading] = useState(false)
  const AUTO_HIDE_DELAY_MS = 3000
  const AUTO_HIDE_FADE_MS = 300

  useEffect(() => {
    if (!autoHide) {
      setIsHovered(false)
    }
  }, [autoHide])

  useEffect(() => {
    return () => {
      if (suppressAutoHideResetTimerRef.current !== null) {
        window.clearTimeout(suppressAutoHideResetTimerRef.current)
      }
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current)
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current)
      }
    }
  }, [])

  if (!isVisible || state === 'fullscreen') return null

  const isFloating = position === 'floating'
  const isHorizontal = position === 'top' || position === 'bottom'
  const shellSizeClasses = isExpanded
    ? isHorizontal
      ? 'w-full h-16'
      : 'w-80 h-full'
    : 'w-16 h-16'

  const shellStyle: React.CSSProperties = {
    opacity: autoHide && !isHovered && isAutoHideFading ? 0 : opacity,
    backgroundColor: blur ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 1)',
    backdropFilter: blur ? 'blur(12px)' : 'none',
    WebkitBackdropFilter: blur ? 'blur(12px)' : 'none',
    transitionProperty: 'opacity, background-color, backdrop-filter, -webkit-backdrop-filter, box-shadow',
    transitionDuration: '300ms',
    transitionTimingFunction: 'ease-out',
  }

  const handleMouseEnter = () => {
    setIsHovered(true)
    setIsAutoHideFading(false)
    if (autoHideFadeTimerRef.current !== null) {
      window.clearTimeout(autoHideFadeTimerRef.current)
      autoHideFadeTimerRef.current = null
    }
    if (autoHideCollapseTimerRef.current !== null) {
      window.clearTimeout(autoHideCollapseTimerRef.current)
      autoHideCollapseTimerRef.current = null
    }
    if (suppressAutoHideResetTimerRef.current !== null) {
      window.clearTimeout(suppressAutoHideResetTimerRef.current)
      suppressAutoHideResetTimerRef.current = null
    }
    if (autoHide && state !== 'expanded' && !suppressAutoHideExpandRef.current) {
      setState('minimized')
      setIsExpanded(true)
    }
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    if (autoHideFadeTimerRef.current !== null) {
      window.clearTimeout(autoHideFadeTimerRef.current)
    }
    if (autoHideCollapseTimerRef.current !== null) {
      window.clearTimeout(autoHideCollapseTimerRef.current)
    }
    setIsAutoHideFading(false)
    if (suppressAutoHideResetTimerRef.current !== null) {
      window.clearTimeout(suppressAutoHideResetTimerRef.current)
    }
    suppressAutoHideResetTimerRef.current = window.setTimeout(() => {
      suppressAutoHideExpandRef.current = false
      suppressAutoHideResetTimerRef.current = null
    }, AUTO_HIDE_DELAY_MS)
    if (autoHide) {
      autoHideFadeTimerRef.current = window.setTimeout(() => {
        setIsAutoHideFading(true)
        autoHideFadeTimerRef.current = null
        autoHideCollapseTimerRef.current = window.setTimeout(() => {
          setState('minimized')
          setIsAutoHideFading(false)
          autoHideCollapseTimerRef.current = null
        }, AUTO_HIDE_FADE_MS)
      }, AUTO_HIDE_DELAY_MS)
    }
  }

  const handleCollapseRequest = () => {
    if (autoHide) {
      suppressAutoHideExpandRef.current = true
      setIsAutoHideFading(false)
      if (suppressAutoHideResetTimerRef.current !== null) {
        window.clearTimeout(suppressAutoHideResetTimerRef.current)
        suppressAutoHideResetTimerRef.current = null
      }
      if (autoHideFadeTimerRef.current !== null) {
        window.clearTimeout(autoHideFadeTimerRef.current)
        autoHideFadeTimerRef.current = null
      }
      if (autoHideCollapseTimerRef.current !== null) {
        window.clearTimeout(autoHideCollapseTimerRef.current)
        autoHideCollapseTimerRef.current = null
      }
    }
  }

  // Floating mode drag handling - ONLY for ExpandedSidebar header
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<{
    startScreenX: number
    startScreenY: number
    startLeft: number
    startTop: number
    currentPosition: { x: number; y: number }
  } | null>(null)
  const moveFloatingWindow = (nextPosition: { x: number; y: number }) => {
    void window.desktopWindow?.setFloatingPosition(nextPosition).catch(() => {
      // No-op outside Electron
    })
  }

  // Reset dragging state when floating mode is disabled
  useEffect(() => {
    if (!isFloating) {
      setIsDragging(false)
      dragStateRef.current = null
    }
  }, [isFloating])

  const handleDragHandleStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isFloating || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragStateRef.current = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startLeft: floatingPosition.x,
      startTop: floatingPosition.y,
      currentPosition: {
        x: floatingPosition.x,
        y: floatingPosition.y,
      },
    }
  }

  useEffect(() => {
    if (!isDragging || !isFloating) return

    const handleMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return

      const dx = moveEvent.screenX - state.startScreenX
      const dy = moveEvent.screenY - state.startScreenY

      const nextPosition = {
        x: state.startLeft + dx,
        y: state.startTop + dy,
      }

      state.currentPosition = nextPosition

      moveFloatingWindow(nextPosition)
    }

    const handleUp = () => {
      const finalPosition = dragStateRef.current?.currentPosition
      if (finalPosition) {
        saveFloatingPosition(finalPosition)
      }
      setIsDragging(false)
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, isFloating])

  // keep layout width/height but hide visually until hydration completes to avoid flashes
  const hydrationClass = isHydrated ? '' : 'opacity-0 pointer-events-none'

  return (
    <div
      style={shellStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden ${shellSizeClasses} transition-[width,height,opacity] duration-180 ease-out ${autoHide && !isHovered ? 'shadow-sm' : ''} ${hydrationClass}`}
    >
      {state === 'expanded' && (
        <div className='h-full min-h-0 w-full'>
          <ExpandedSidebar
            onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined}
            onCollapseRequest={handleCollapseRequest}
          />
        </div>
      )}

      {state === 'minimized' && isExpanded && (
        <div className='h-full w-full'>
          <MinimizedSidebar onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined} />
        </div>
      )}

      {state === 'minimized' && !isExpanded && (
        <div className='h-full w-full'>
          <CollapsedSidebar onDragHandleMouseDown={isFloating ? handleDragHandleStart : undefined} />
        </div>
      )}
    </div>
  )
}
