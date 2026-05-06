import { type ReactNode, type CSSProperties } from 'react'
import { X } from 'lucide-react'

type ModuleWindowHeaderProps = {
  eyebrow?: string
  title: string
  subtitle?: string
  icon: ReactNode
  onClose: () => void
  closeLabel?: string
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
  closeLabel = 'Close window',
  actions,
}: ModuleWindowHeaderProps) => {
  return (
    <div className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-xl" style={dragRegionStyle}>
      <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3" style={noDragRegionStyle}>
          <button
            type="button"
            onClick={onClose}
            title={closeLabel}
            aria-label={closeLabel}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <X size={16} />
          </button>

          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
            {icon}
          </div>

          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                {eyebrow}
              </p>
            )}
            <h1 className="truncate text-[26px] font-semibold tracking-tight text-gray-900">
              {title}
            </h1>
            {subtitle && <p className="mt-1 truncate text-xs text-gray-500">{subtitle}</p>}
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
