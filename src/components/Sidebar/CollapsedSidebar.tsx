import { useSidebar } from '../../context/SidebarContext'

export const CollapsedSidebar = () => {
  const { toggleExpand } = useSidebar()

  return (
    <div className='flex h-full w-full items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm'>
      <button
        type='button'
        onClick={toggleExpand}
        aria-label='Expand sidebar'
        className='flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white transition-colors duration-200 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white'
      >
        <img src='/logo-color.svg' alt='Ledger' className='block h-8 w-8' />
      </button>
    </div>
  )
}