import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCategory, setEditCategory] = useState('personal')
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)

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
    if (!editingTemplate) return
    setEditName(editingTemplate.name)
    setEditDescription(editingTemplate.description ?? '')
    setEditCategory(editingTemplate.category || 'personal')
  }, [editingTemplate])

  const categories = useMemo(() => {
    const set = new Set<string>()
    templates.forEach((t) => set.add(t.category || 'personal'))
    return Array.from(set).sort()
  }, [templates])

  const filteredTemplates = useMemo(() => {
    let result = [...templates]
    if (selectedCategory) result = result.filter((t) => t.category === selectedCategory)
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
  }, [templates, searchQuery, selectedCategory])

  const dispatchTemplatesUpdated = useCallback(() => {
    window.dispatchEvent(new CustomEvent('templates:updated'))
  }, [])

  const handleSaveTemplate = useCallback(async () => {
    if (!editingTemplate) return
    const name = editName.trim()
    if (!name) {
      toast.show('Template name is required', { variant: 'error' })
      return
    }

    setIsSavingTemplate(true)
    try {
      await api.updateTemplate(editingTemplate.id, {
        name,
        description: editDescription.trim() ? editDescription.trim() : null,
        category: editCategory.trim() || 'personal',
      })
      setEditingTemplate(null)
      await loadTemplates()
      dispatchTemplatesUpdated()
      toast.show('Template updated', { variant: 'success' })
    } catch (error) {
      console.error('Failed to update template:', error)
      toast.show(error instanceof Error ? error.message : 'Could not update template', {
        variant: 'error',
      })
    } finally {
      setIsSavingTemplate(false)
    }
  }, [
    api,
    dispatchTemplatesUpdated,
    editCategory,
    editDescription,
    editName,
    editingTemplate,
    loadTemplates,
    toast,
  ])

  const handleDeleteTemplate = useCallback(
    async (template: Template) => {
      const ok = window.confirm(`Delete template “${template.name}”? This cannot be undone.`)
      if (!ok) return

      setIsDeletingTemplate(true)
      try {
        await api.deleteTemplate(template.id)
        if (editingTemplate?.id === template.id) setEditingTemplate(null)
        await loadTemplates()
        dispatchTemplatesUpdated()
        toast.show('Template deleted', { variant: 'success' })
      } catch (error) {
        console.error('Failed to delete template:', error)
        toast.show(error instanceof Error ? error.message : 'Could not delete template', {
          variant: 'error',
        })
      } finally {
        setIsDeletingTemplate(false)
      }
    },
    [api, dispatchTemplatesUpdated, editingTemplate, loadTemplates, toast]
  )

  return (
    <div className="flex max-h-[66vh] min-h-0 flex-col gap-3 bg-white">
      {editingTemplate && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                Edit custom template
              </p>
              <p className="mt-1 text-xs text-gray-600">Update name, description, or category.</p>
            </div>
            <button
              type="button"
              onClick={() => setEditingTemplate(null)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            >
              <X size={13} />
            </button>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-600">Name</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-600">Category</span>
              <input
                value={editCategory}
                onChange={(event) => setEditCategory(event.target.value)}
                placeholder="personal"
                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-gray-300"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-300"
              placeholder="Optional description"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={isSavingTemplate}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={() => editingTemplate && handleDeleteTemplate(editingTemplate)}
              disabled={isDeletingTemplate}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>
      )}

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
          <button
            onClick={() => setSelectedCategory(null)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              selectedCategory === null
                ? 'bg-gray-900 text-white'
                : 'bg-[#f3f4f6] text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                selectedCategory === cat
                  ? 'bg-gray-900 text-white'
                  : 'bg-[#f3f4f6] text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
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
            {onCreateCustom && templates.length === 0 && (
              <button
                onClick={onCreateCustom}
                className="mt-3 text-sm font-medium text-[#FF5F40] hover:underline"
              >
                Create your first template
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 pb-1">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="group relative rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-left transition hover:border-[#f3d7be] hover:shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
              >
                <button
                  type="button"
                  onClick={() => onSelectTemplate(template.id)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start gap-2 pr-14">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-sm font-semibold leading-5 text-gray-900">
                          {template.name}
                        </h3>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] leading-none ${
                            template.is_system
                              ? 'border-gray-200 bg-gray-100 text-gray-600'
                              : 'border-[#ffd8cc] bg-[#fff3ee] text-[#e85a3d]'
                          }`}
                        >
                          {template.is_system ? 'Built-in' : 'Custom'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs leading-4 text-gray-500">
                        {template.description?.trim() || 'No description'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
                    <span className="capitalize">{template.category}</span>
                    {template.usage_count > 0 ? (
                      <span>Used {template.usage_count}x</span>
                    ) : (
                      <span className="text-gray-400">Unused</span>
                    )}
                  </div>
                </button>

                {!template.is_system && (
                  <div className="absolute right-2 top-2 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(template)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                      aria-label={`Edit template ${template.name}`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(template)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 transition hover:border-red-300 hover:bg-red-50"
                      aria-label={`Delete template ${template.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}

            {onCreateCustom && (
              <button
                onClick={onCreateCustom}
                className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-left transition hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#ffd8cc] text-[#FF5F40]">
                      <Plus size={13} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Create custom template</p>
                      <p className="text-[11px] leading-4 text-gray-500">
                        Save your own reusable format
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-400">New</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
