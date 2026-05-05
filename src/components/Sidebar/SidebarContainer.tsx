import { useEffect, useState, useRef } from 'react'
import { useSidebar } from '../../context/SidebarContext'
import { MinimizedSidebar } from './MinimizedSidebar'
import { ExpandedSidebar } from './ExpandedSidebar'
import { CollapsedSidebar } from './CollapsedSidebar'

export const SidebarContainer = () => {
  const { state, isVisible, isExpanded, position, opacity, blur, autoHide, setState, setIsExpanded, floatingPosition, setFloatingPosition } = useSidebar()
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

  const wrapperStyle: React.CSSProperties = isFloating
    ? {
        position: 'fixed',
        left: floatingPosition.x,
        top: floatingPosition.y,
        zIndex: 30,
      }
    : {}

  const shellStyle: React.CSSProperties = {
    ...wrapperStyle,
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
  const dragStateRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)

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
    setIsDragging(true)
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: floatingPosition.x,
      startTop: floatingPosition.y,
    }
  }

  useEffect(() => {
    if (!isDragging || !isFloating) return

    const handleMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return

      const dx = moveEvent.clientX - state.startX
      const dy = moveEvent.clientY - state.startY

      setFloatingPosition({
        x: Math.max(0, state.startLeft + dx),
        y: Math.max(0, state.startTop + dy),
      })
    }

    const handleUp = () => {
      setIsDragging(false)
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, isFloating, setFloatingPosition])

  return (
    <div
      style={shellStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden ${shellSizeClasses} transition-[width,height] duration-180 ease-out ${autoHide && !isHovered ? 'shadow-sm' : ''}`}
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
