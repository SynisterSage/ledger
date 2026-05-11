import { Search, Plus, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '../../hooks/useApi'
import { useWorkspaceContext } from '../../context/WorkspaceContext'

interface Template {
  id: string
  name: string
  description: string | null
  category: string
  is_default: boolean
  is_system: boolean
  usage_count: number
  created_at: string
}

interface TemplateGalleryProps {
  onSelectTemplate: (templateId: string) => void
  onCreateCustom?: () => void
}

export const TemplateGallery = ({
  onSelectTemplate,
  onCreateCustom,
}: TemplateGalleryProps) => {
  const { activeWorkspaceId } = useWorkspaceContext()
  const api = useApi()
  const [templates, setTemplates] = useState<Template[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading_Internal, setIsLoading_Internal] = useState(true)

  const categories = useMemo(() => {
    const cats = new Set<string>()
    templates.forEach((t) => cats.add(t.category || 'personal'))
    return Array.from(cats).sort()
  }, [templates])

  useEffect(() => {
    const loadTemplates = async () => {
      if (!activeWorkspaceId) return
      setIsLoading_Internal(true)
      try {
        const data = await api.getTemplates()
        setTemplates((Array.isArray(data) ? data : []) as Template[])
      } catch (error) {
        console.error('Failed to load templates:', error)
        setTemplates([])
      } finally {
        setIsLoading_Internal(false)
      }
    }

    loadTemplates()
  }, [activeWorkspaceId, api])

  const filteredTemplates = useMemo(() => {
    let result = [...templates]

    if (selectedCategory) {
      result = result.filter((t) => t.category === selectedCategory)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (t) => t.name.toLowerCase().includes(query) || (t.description?.toLowerCase() || '').includes(query)
      )
    }

    return result.sort((a, b) => {
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count
      return a.name.localeCompare(b.name)
    })
  }, [templates, searchQuery, selectedCategory])

  const handleSelectTemplate = useCallback(
    async (templateId: string) => {
      onSelectTemplate(templateId)
    },
    [onSelectTemplate]
  )

  return (
    <div className="space-y-4">
      {/* Search and Filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition ${
              selectedCategory === null
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                selectedCategory === cat
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {isLoading_Internal ? (
          // Loading skeletons
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 p-4 bg-gray-50 animate-pulse space-y-2"
            >
              <div className="h-4 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))
        ) : filteredTemplates.length === 0 ? (
          <div className="col-span-full text-center py-8 text-gray-500">
            <p className="text-sm">No templates found</p>
            {onCreateCustom && (
              <button
                onClick={onCreateCustom}
                className="mt-3 text-sm font-medium text-[#FF5F40] hover:underline"
              >
                Create your first template
              </button>
            )}
          </div>
        ) : (
          <>
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleSelectTemplate(template.id)}
                className="rounded-lg border border-gray-200 p-4 bg-white text-left transition hover:shadow-md hover:border-gray-300 active:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm text-gray-900">{template.name}</h3>
                    {template.description && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{template.description}</p>
                    )}
                  </div>
                  {template.is_system && <Zap size={14} className="text-yellow-500 shrink-0" />}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="capitalize">{template.category}</span>
                  {template.usage_count > 0 && <span>Used {template.usage_count}x</span>}
                </div>
              </button>
            ))}

            {/* Create Custom Template Button */}
            {onCreateCustom && (
              <button
                onClick={onCreateCustom}
                className="rounded-lg border-2 border-dashed border-gray-200 p-4 text-center transition hover:border-gray-400 hover:bg-gray-50 active:bg-white"
              >
                <Plus size={20} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium text-sm text-gray-700">Create Custom</p>
                <p className="text-xs text-gray-500 mt-0.5">Save your own template</p>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
