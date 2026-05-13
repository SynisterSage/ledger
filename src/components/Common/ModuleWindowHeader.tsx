import { type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Maximize2, Minus, X } from 'lucide-react'

type ModuleWindowHeaderProps = {
  eyebrow?: string
  title: string
  subtitle?: string
  icon: ReactNode
  onClose: () => void
  onMinimize?: () => void
  onToggleFullscreen?: () => void
  closeLabel?: string
  minimizeLabel?: string
  fullscreenLabel?: string
  actions?: ReactNode
}

type AppRegionStyle = CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag'
}

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' }

export const ModuleWindowHeader = ({
  eyebrow,
  title,
  subtitle,
  icon,
  onClose,
  onMinimize,
  onToggleFullscreen,
  closeLabel = 'Close window',
  minimizeLabel = 'Minimize window',
  fullscreenLabel = 'Toggle fullscreen',
  actions,
}: ModuleWindowHeaderProps) => {
  const controlClassName =
    'flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100 hover:text-gray-900'

  const handleTitleBarDoubleClick = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen()
    }
  }

  const triggerOnPrimaryMouseDown = (event: ReactMouseEvent<HTMLButtonElement>, action?: () => void) => {
    if (!action) return
    if (event.button !== 0) return
    event.preventDefault()
    action()
  }

  return (
    <div className="border-b border-gray-200 bg-white" style={dragRegionStyle}>
      <div className="h-10 px-4 py-2 flex items-center bg-gray-50 border-b border-gray-200 cursor-default" style={dragRegionStyle} onDoubleClick={handleTitleBarDoubleClick}>
        <div className="flex items-center gap-1.5" style={noDragRegionStyle}>
          <button
            type="button"
            onMouseDown={(event) => triggerOnPrimaryMouseDown(event, onClose)}
            onClick={onClose}
            title={closeLabel}
            aria-label={closeLabel}
            className={controlClassName}
          >
            <X size={12} />
          </button>
          {onMinimize && (
            <button
              type="button"
              onMouseDown={(event) => triggerOnPrimaryMouseDown(event, onMinimize)}
              onClick={onMinimize}
              title={minimizeLabel}
              aria-label={minimizeLabel}
              className={controlClassName}
            >
              <Minus size={12} />
            </button>
          )}
          {onToggleFullscreen && (
            <button
              type="button"
              onMouseDown={(event) => triggerOnPrimaryMouseDown(event, onToggleFullscreen)}
              onClick={onToggleFullscreen}
              title={fullscreenLabel}
              aria-label={fullscreenLabel}
              className={controlClassName}
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
        <div className="flex min-w-0 items-center gap-4" style={dragRegionStyle}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
            {icon}
          </div>

          <div className="min-w-0 space-y-0.5">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] leading-none text-gray-500">
                {eyebrow}
              </p>
            )}
            <h1 className="truncate text-[25px] font-semibold leading-[1.05] tracking-tight text-gray-900">
              {title}
            </h1>
            {subtitle && <p className="truncate text-xs leading-tight text-gray-500">{subtitle}</p>}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2" style={noDragRegionStyle}>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
