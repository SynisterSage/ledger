import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspaceContext } from '../../context/WorkspaceContext'
import { useApi } from '../../hooks/useApi'
import { useToast } from '../Common/ToastProvider'

interface Template {
  id: string
  name: string
  description: string | null
  category: string
  is_default: boolean
  is_system: boolean
  usage_count: number
}

interface TemplateGalleryProps {
  onSelectTemplate: (templateId: string) => void
  onCreateCustom?: () => void
}

export const TemplateGallery = ({ onSelectTemplate, onCreateCustom }: TemplateGalleryProps) => {
  const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const toast = useToast()

  const [templates, setTemplates] = useState<Template[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFilter, setSelectedFilter] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [rowMenuTemplateId, setRowMenuTemplateId] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    if (!activeWorkspaceId) return
    setIsLoading(true)
    try {
      const data = await api.getTemplates()
      setTemplates((Array.isArray(data) ? data : []) as Template[])
    } catch (error) {
      console.error('Failed to load templates:', error)
      setTemplates([])
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspaceId, api])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    const handler = () => {
      if (!activeWorkspaceId) return
      void loadTemplates()
    }
    window.addEventListener('templates:updated', handler as EventListener)
    return () => window.removeEventListener('templates:updated', handler as EventListener)
  }, [activeWorkspaceId, loadTemplates])

  useEffect(() => {
    if (!rowMenuTemplateId) return
    const close = () => setRowMenuTemplateId(null)
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onEscape)
    }
  }, [rowMenuTemplateId])

  const categories = useMemo(() => {
    const set = new Set<string>(['meeting', 'personal', 'project', 'reading'])
    templates.forEach((t) => set.add((t.category || 'personal').toLowerCase()))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [templates])

  const filters = useMemo(
    () => [
      { key: 'all', label: 'All' },
      { key: 'presets', label: 'Presets' },
      { key: 'custom', label: 'Custom' },
      ...categories.map((category) => ({
        key: `cat:${category}`,
        label: category.charAt(0).toUpperCase() + category.slice(1),
      })),
    ],
    [categories]
  )

  const filteredTemplates = useMemo(() => {
    let result = [...templates]

    if (selectedFilter === 'presets') {
      result = result.filter((t) => t.is_system)
    } else if (selectedFilter === 'custom') {
      result = result.filter((t) => !t.is_system)
    } else if (selectedFilter.startsWith('cat:')) {
      const category = selectedFilter.slice(4)
      result = result.filter((t) => (t.category || 'personal').toLowerCase() === category)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.description?.toLowerCase() || '').includes(query)
      )
    }
    return result.sort((a, b) => {
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count
      return a.name.localeCompare(b.name)
    })
  }, [templates, searchQuery, selectedFilter])

  const dispatchTemplatesUpdated = useCallback(() => {
    window.dispatchEvent(new CustomEvent('templates:updated'))
  }, [])

  const handleDeleteTemplate = useCallback(
    async (template: Template) => {
      const ok = window.confirm(`Delete template “${template.name}”? This cannot be undone.`)
      if (!ok) return

      try {
        await api.deleteTemplate(template.id)
        await loadTemplates()
        dispatchTemplatesUpdated()
        toast.show('Template deleted', { variant: 'success' })
      } catch (error) {
        console.error('Failed to delete template:', error)
        toast.show(error instanceof Error ? error.message : 'Could not delete template', {
          variant: 'error',
        })
      }
    },
    [api, dispatchTemplatesUpdated, loadTemplates, toast]
  )

  return (
    <div className="flex max-h-[66vh] min-h-0 flex-col gap-2 bg-white">
      <div className="space-y-2 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-700 outline-none transition focus:border-gray-300"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {filters.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setSelectedFilter(filter.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                selectedFilter === filter.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-[#f3f4f6] text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {isLoading ? (
          <div className="space-y-1.5 pb-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-36 rounded bg-gray-200" />
                  <div className="ml-auto h-4 w-14 rounded-full bg-gray-100" />
                </div>
                <div className="mt-1.5 h-3 w-2/3 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <p className="text-sm">No templates found</p>
            {onCreateCustom && (
              <button
                onClick={onCreateCustom}
                className="mt-3 text-sm font-medium text-[#FF5F40] hover:underline"
              >
                Create custom template
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 pb-1">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="group relative rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-gray-300 hover:bg-gray-50/50 hover:shadow-[0_1px_4px_rgba(15,23,42,0.04)]"
              >
                <button
                  type="button"
                  onClick={() => onSelectTemplate(template.id)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start gap-2 pr-10">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold leading-5 text-gray-900">
                        {template.name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs leading-4 text-gray-600">
                        {template.description?.trim() || 'No description'}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        <span className="capitalize">{template.category || 'personal'}</span>
                        <span className="mx-1.5">·</span>
                        <span>{template.is_system ? 'Preset' : 'Custom'}</span>
                      </p>
                    </div>
                  </div>
                </button>

                {!template.is_system && (
                  <div className="absolute right-2 top-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setRowMenuTemplateId((current) =>
                          current === template.id ? null : template.id
                        )
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                      aria-label={`Template actions for ${template.name}`}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    {rowMenuTemplateId === template.id && (
                      <div
                        className="absolute right-0 top-7 z-30 min-w-34 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setRowMenuTemplateId(null)
                            void handleDeleteTemplate(template)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={12} className="text-red-500" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {onCreateCustom && (
        <button
          type="button"
          onClick={onCreateCustom}
          className="mt-1 flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:bg-gray-50"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#ffd8cc] text-[#FF5F40]">
            <Plus size={12} />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-800">Create custom template</p>
            <p className="text-[11px] text-gray-500">Save your own reusable note format.</p>
          </div>
        </button>
      )}
    </div>
  )
}
