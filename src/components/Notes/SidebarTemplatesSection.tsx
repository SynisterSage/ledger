import { useEffect, useState } from 'react'
import { useApi } from '../../hooks/useApi'
import { useWorkspaceContext } from '../../context/WorkspaceContext'

interface Template {
  id: string
  name: string
  category: string
  usage_count: number
  is_system: boolean
}

interface SidebarTemplatesSectionProps {
  onSelectTemplate?: (templateId: string) => void
  maxTemplates?: number
}

export const SidebarTemplatesSection = ({
  onSelectTemplate,
  maxTemplates = 5,
}: SidebarTemplatesSectionProps) => {
  const api = useApi()
  const { activeWorkspaceId } = useWorkspaceContext()
  const [templates, setTemplates] = useState<Template[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const loadTemplates = async () => {
      if (!activeWorkspaceId) return
      setIsLoading(true)
      try {
        const data = await api.getTemplates()
        const sorted = (Array.isArray(data) ? data : [])
          .sort((a: any, b: any) => b.usage_count - a.usage_count)
          .slice(0, maxTemplates)
        setTemplates(sorted)
      } catch (error) {
        console.error('Failed to load templates:', error)
        setTemplates([])
      } finally {
        setIsLoading(false)
      }
    }

    loadTemplates()
  }, [activeWorkspaceId, api, maxTemplates])

  if (!templates.length && !isLoading) {
    return null
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-600 uppercase px-3">Templates</p>
      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-3 py-1.5 rounded bg-gray-100 animate-pulse h-8" />
        ))
      ) : (
        templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelectTemplate?.(template.id)}
            className="w-full text-left px-3 py-1.5 text-sm rounded transition hover:bg-gray-100 active:bg-gray-50 text-gray-700 hover:text-gray-900"
            title={`Used ${template.usage_count} times`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate">{template.name}</span>
              {template.usage_count > 0 && (
                <span className="text-xs text-gray-500 shrink-0 ml-2">{template.usage_count}</span>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  )
}
