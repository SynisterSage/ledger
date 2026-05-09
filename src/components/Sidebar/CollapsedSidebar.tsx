import { useSidebar } from '../../context/SidebarContext'

export const CollapsedSidebar = ({
  onDragHandleMouseDown,
}: {
  onDragHandleMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
}) => {
  const { restoreSidebarView } = useSidebar()

  const handleClick = () => {
    restoreSidebarView()
  }

  return (
    <div
      className='flex h-full w-full items-center justify-center'
      onMouseDown={onDragHandleMouseDown}
      style={{ cursor: onDragHandleMouseDown ? 'grab' : 'auto' }}
    >
      <button
        type='button'
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label='Expand sidebar'
        className='flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-transparent transition-colors duration-200 ease-out hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300'
      >
        <img src='/logo-color.svg' alt='Ledger' className='block h-8 w-8' />
      </button>
    </div>
  )
}
