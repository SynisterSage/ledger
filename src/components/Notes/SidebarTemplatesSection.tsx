import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';

interface Template {
  id: string;
  name: string;
  category: string;
  usage_count: number;
  is_system: boolean;
}

interface SidebarTemplatesSectionProps {
  onSelectTemplate?: (templateId: string) => void;
  maxTemplates?: number;
}

export const SidebarTemplatesSection = ({
  onSelectTemplate,
  maxTemplates = 5,
}: SidebarTemplatesSectionProps) => {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadTemplates = async () => {
      if (!activeWorkspaceId) return;
      setIsLoading(true);
      try {
        const data = await api.getTemplates();
        const sorted = (Array.isArray(data) ? data : [])
          .filter((template: any) => template.pinned || template.last_used_at || template.is_system)
          .sort((a: any, b: any) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            if (Boolean(a.last_used_at) !== Boolean(b.last_used_at)) return a.last_used_at ? -1 : 1;
            return String(b.last_used_at ?? '').localeCompare(String(a.last_used_at ?? ''));
          })
          .slice(0, maxTemplates);
        setTemplates(sorted);
      } catch (error) {
        console.error('Failed to load templates:', error);
        setTemplates([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplates();
  }, [activeWorkspaceId, api, maxTemplates]);

  if (!templates.length && !isLoading) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="px-3 text-xs font-medium text-gray-600">Templates</p>
      {isLoading
        ? Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded px-3 py-1.5 bg-[#FFF3E7]"
            />
          ))
        : templates.map((template) => (
            <button
              key={template.id}
              onClick={() => onSelectTemplate?.(template.id)}
              className="w-full rounded px-3 py-1.5 text-left text-sm text-gray-700 transition hover:bg-[#FFF1E3] active:bg-[#FFF0EA] hover:text-gray-900"
              title={`Used ${template.usage_count} times`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{template.name}</span>
                {template.usage_count > 0 && (
                  <span className="text-xs text-gray-500 shrink-0 ml-2">
                    {template.usage_count}
                  </span>
                )}
              </div>
            </button>
          ))}
    </div>
  );
};
