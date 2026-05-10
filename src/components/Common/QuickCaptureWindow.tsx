import { Check, FileText, Calendar } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../hooks/useApi'
import { useAuthContext } from '../../context/AuthContext'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { ModuleWindowHeader } from './ModuleWindowHeader'

export const QuickCaptureWindow = ({ kind }: { kind: 'quick-task' | 'quick-note' | 'quick-event' }) => {
  const { user } = useAuthContext()
  const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()

  const [taskTitle, setTaskTitle] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState(() => {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })
  const [eventTime, setEventTime] = useState('09:00')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const taskInputRef = useRef<HTMLInputElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const eventInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (kind === 'quick-task') {
        taskInputRef.current?.focus()
      } else if (kind === 'quick-note') {
        noteInputRef.current?.focus()
      } else if (kind === 'quick-event') {
        eventInputRef.current?.focus()
      }
    }, 100)

    return () => window.clearTimeout(timer)
  }, [kind])

  const closeWindow = () => {
    void window.desktopWindow?.closeModule(kind as any)
  }

  const minimizeWindow = () => {
    void window.desktopWindow?.minimizeModule(kind as any)
  }

  const toggleFullscreen = () => {
    void window.desktopWindow?.toggleModuleFullscreen(kind as any)
  }

  const saveQuickTask = async () => {
    if (!user || !activeWorkspaceId || !taskTitle.trim()) {
      setError('Task title cannot be empty')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      await api.createTask({
        title: taskTitle.trim(),
        description: '',
        status: 'not_started',
        priority: 'none',
        due_date: (() => {
          const today = new Date()
          const year = today.getFullYear()
          const month = String(today.getMonth() + 1).padStart(2, '0')
          const day = String(today.getDate()).padStart(2, '0')
          return `${year}-${month}-${day}`
        })(),
      })
      closeWindow()
    } catch (error) {
      console.error('Failed to create task:', error)
      setError('Failed to create task. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveQuickNote = async () => {
    if (!user || !activeWorkspaceId || !noteTitle.trim()) {
      setError('Note title cannot be empty')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      await api.createNote(noteTitle.trim(), noteContent.trim(), {
        source: 'quick_capture',
      })
      closeWindow()
    } catch (error) {
      console.error('Failed to create note:', error)
      setError('Failed to create note. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveQuickEvent = async () => {
    if (!user || !activeWorkspaceId || !eventTitle.trim()) {
      setError('Event title cannot be empty')
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      const startDateTime = new Date(`${eventDate}T${eventTime}:00`)
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000) // 1 hour later

      await api.createEvent({
        title: eventTitle.trim(),
        start_at: startDateTime.toISOString(),
        end_at: endDateTime.toISOString(),
      })
      closeWindow()
    } catch (error) {
      console.error('Failed to create event:', error)
      setError('Failed to create event. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  if (kind === 'quick-task') {
    return (
      <div className='flex h-screen flex-col bg-[#f5f5f7]'>
        <ModuleWindowHeader title='Quick Task' icon={<Check size={16} />} onClose={closeWindow} onMinimize={minimizeWindow} onToggleFullscreen={toggleFullscreen} />
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            <div>
              <label className='block text-xs font-medium text-gray-600 mb-1'>Task Title</label>
              <input
                ref={taskInputRef}
                type='text'
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder='What needs to be done?'
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void saveQuickTask()
                  }
                }}
                className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none'
              />
            </div>

            {error && (
              <div className='rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
                {error}
              </div>
            )}

            <div className='flex gap-2 pt-2'>
              <button
                type='button'
                onClick={closeWindow}
                className='flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void saveQuickTask()}
                disabled={isSaving || !taskTitle.trim()}
                className='flex-1 rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white hover:bg-[#E54E30] disabled:opacity-50'
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'quick-note') {
    return (
      <div className='flex h-screen flex-col bg-[#f5f5f7]'>
        <ModuleWindowHeader title='Quick Note' icon={<FileText size={16} />} onClose={closeWindow} onMinimize={minimizeWindow} onToggleFullscreen={toggleFullscreen} />
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            <div>
              <label className='block text-xs font-medium text-gray-600 mb-1'>Note Title</label>
              <input
                type='text'
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder='Note title...'
                className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none'
              />
            </div>

            <div>
              <label className='block text-xs font-medium text-gray-600 mb-1'>Content</label>
              <textarea
                ref={noteInputRef}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder='Add your notes here...'
                rows={4}
                className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none'
              />
            </div>

            {error && (
              <div className='rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
                {error}
              </div>
            )}

            <div className='flex gap-2 pt-2'>
              <button
                type='button'
                onClick={closeWindow}
                className='flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void saveQuickNote()}
                disabled={isSaving || !noteTitle.trim()}
                className='flex-1 rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white hover:bg-[#E54E30] disabled:opacity-50'
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'quick-event') {
    return (
      <div className='flex h-screen flex-col bg-[#f5f5f7]'>
        <ModuleWindowHeader title='Quick Event' icon={<Calendar size={16} />} onClose={closeWindow} onMinimize={minimizeWindow} onToggleFullscreen={toggleFullscreen} />
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            <div>
              <label className='block text-xs font-medium text-gray-600 mb-1'>Event Title</label>
              <input
                ref={eventInputRef}
                type='text'
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder='Event name...'
                className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none'
              />
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='block text-xs font-medium text-gray-600 mb-1'>Date</label>
                <input
                  type='date'
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-gray-600 mb-1'>Time</label>
                <input
                  type='time'
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className='w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none'
                />
              </div>
            </div>

            {error && (
              <div className='rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
                {error}
              </div>
            )}

            <div className='flex gap-2 pt-2'>
              <button
                type='button'
                onClick={closeWindow}
                className='flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void saveQuickEvent()}
                disabled={isSaving || !eventTitle.trim()}
                className='flex-1 rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white hover:bg-[#E54E30] disabled:opacity-50'
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
