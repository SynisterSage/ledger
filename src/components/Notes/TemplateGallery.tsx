import { Copy, Eye, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import type { TemplateSummary } from './templateDefinitions';

interface TemplateGalleryProps {
  onSelectTemplate: (templateId: string) => void;
  initialTemplateId?: string | null;
  onCreateCustom?: () => void;
  onEditTemplate?: (template: TemplateSummary) => void;
}

export const TemplateGallery = ({
  onSelectTemplate,
  initialTemplateId,
  onCreateCustom,
  onEditTemplate,
}: TemplateGalleryProps) => {
  const { activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();
  const toast = useToast();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [rowMenuTemplateId, setRowMenuTemplateId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateSummary | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const didOpenInitialTemplateRef = useRef<string | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsLoading(true);
    try {
      const data = await api.getTemplates();
      setTemplates((Array.isArray(data) ? data : []) as TemplateSummary[]);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const handler = () => {
      if (!activeWorkspaceId) return;
      void loadTemplates();
    };
    window.addEventListener('templates:updated', handler as EventListener);
    return () => window.removeEventListener('templates:updated', handler as EventListener);
  }, [activeWorkspaceId, loadTemplates]);

  useEffect(() => {
    if (!rowMenuTemplateId) return;
    const close = () => setRowMenuTemplateId(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-template-row-menu="true"]')) return;
      if (target?.closest('[data-template-row-actions="true"]')) return;
      close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onEscape);
    };
  }, [rowMenuTemplateId]);

  const categories = useMemo(() => {
    const set = new Set<string>(['meeting', 'personal', 'project', 'reading']);
    templates.forEach((t) => set.add((t.category || 'personal').toLowerCase()));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const filters = useMemo(
    () => [
      { key: 'all', label: 'All' },
      { key: 'ledger', label: 'Ledger' },
      { key: 'workspace', label: 'Workspace' },
      { key: 'mine', label: 'Mine' },
      { key: 'pinned', label: 'Pinned' },
      { key: 'recent', label: 'Recent' },
      ...categories.map((category) => ({
        key: `cat:${category}`,
        label: category.charAt(0).toUpperCase() + category.slice(1),
      })),
    ],
    [categories]
  );

  const filteredTemplates = useMemo(() => {
    let result = [...templates];

    if (selectedFilter === 'ledger') {
      result = result.filter((t) => t.is_system);
    } else if (selectedFilter === 'workspace') {
      result = result.filter((t) => !t.is_system && t.visibility === 'workspace');
    } else if (selectedFilter === 'mine') {
      result = result.filter((t) => !t.is_system && t.visibility !== 'workspace');
    } else if (selectedFilter === 'pinned') {
      result = result.filter((t) => t.pinned);
    } else if (selectedFilter === 'recent') {
      result = result.filter((t) => t.last_used_at || t.usage_count > 0);
    } else if (selectedFilter.startsWith('cat:')) {
      const category = selectedFilter.slice(4);
      result = result.filter((t) => (t.category || 'personal').toLowerCase() === category);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.description?.toLowerCase() || '').includes(query)
      );
    }
    return result.sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? -1 : 1;
      if (b.last_used_at !== a.last_used_at)
        return String(b.last_used_at ?? '').localeCompare(String(a.last_used_at ?? ''));
      return a.name.localeCompare(b.name);
    });
  }, [templates, searchQuery, selectedFilter]);

  const dispatchTemplatesUpdated = useCallback(() => {
    window.dispatchEvent(new CustomEvent('templates:updated'));
  }, []);

  const handleDeleteTemplate = useCallback(
    async (template: TemplateSummary) => {
      const ok = window.confirm(`Delete template “${template.name}”? This cannot be undone.`);
      if (!ok) return;

      try {
        await api.deleteTemplate(template.id);
        await loadTemplates();
        dispatchTemplatesUpdated();
        toast.show('Template deleted', { variant: 'success' });
      } catch (error) {
        console.error('Failed to delete template:', error);
        toast.show(error instanceof Error ? error.message : 'Could not delete template', {
          variant: 'error',
        });
      }
    },
    [api, dispatchTemplatesUpdated, loadTemplates, toast]
  );

  const handleDuplicate = async (template: TemplateSummary) => {
    try {
      await api.duplicateTemplate(template.id);
      dispatchTemplatesUpdated();
      toast.show('Template duplicated', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not duplicate template', {
        variant: 'error',
      });
    }
  };

  const handlePin = async (template: TemplateSummary) => {
    try {
      await api.pinTemplate(template.id, !template.pinned);
      await loadTemplates();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not update pin', {
        variant: 'error',
      });
    }
  };

  const handlePreview = async (template: TemplateSummary) => {
    setIsPreviewLoading(true);
    setPreviewTemplate({ ...template, content_html: null });
    try {
      const full = (await api.getTemplate(template.id)) as TemplateSummary;
      setPreviewTemplate({ ...template, ...full });
    } catch (error) {
      console.error('Failed to load template preview:', error);
      setPreviewTemplate({
        ...template,
        content_html: '<p>Could not load this template preview.</p>',
      });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!initialTemplateId || isLoading || didOpenInitialTemplateRef.current === initialTemplateId)
      return;
    const template = templates.find((item) => item.id === initialTemplateId);
    if (template) {
      didOpenInitialTemplateRef.current = initialTemplateId;
      void handlePreview(template);
    }
  }, [initialTemplateId, isLoading, templates]);

  if (previewTemplate) {
    return (
      <div className="flex max-h-[66vh] min-h-0 flex-col gap-3 bg-[var(--ledger-surface-card)]">
        <div className="flex items-start justify-between border-b border-[color:var(--ledger-border-subtle)] pb-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setPreviewTemplate(null)}
              className="mb-2 text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]"
            >
              Back to templates
            </button>
            <h2 className="truncate text-base font-semibold text-[var(--ledger-text-primary)]">
              {previewTemplate.name}
            </h2>
            <p className="mt-1 text-xs text-[var(--ledger-text-secondary)]">
              {previewTemplate.description || 'Ledger writing structure'}
            </p>
          </div>
          <span className="ml-4 shrink-0 rounded-md bg-[var(--ledger-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ledger-text-muted)]">
            {previewTemplate.is_system
              ? 'Ledger'
              : previewTemplate.visibility === 'workspace'
              ? 'Workspace'
              : 'Mine'}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {isPreviewLoading ? (
            <div className="space-y-3 py-4">
              <div className="h-5 w-40 animate-pulse rounded bg-[var(--ledger-surface-muted)]" />
              <div className="h-4 w-full animate-pulse rounded bg-[var(--ledger-surface-muted)]" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--ledger-surface-muted)]" />
            </div>
          ) : (
            <div
              className="prose prose-sm max-w-none text-[var(--ledger-text-primary)]"
              dangerouslySetInnerHTML={{
                __html: previewTemplate.content_html || '<p>Empty template</p>',
              }}
            />
          )}
        </div>
        <div className="flex justify-end border-t border-[color:var(--ledger-border-subtle)] pt-3">
          <button
            type="button"
            disabled={isPreviewLoading}
            onClick={() => onSelectTemplate(previewTemplate.id)}
            className="rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Use template
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-h-[66vh] min-h-0 flex-col gap-2 bg-[var(--ledger-surface-card)]">
      <div className="space-y-2 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] pl-8 pr-3 text-sm text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)]"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {filters.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setSelectedFilter(filter.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                selectedFilter === filter.key
                  ? 'bg-[var(--ledger-text-primary)] text-[var(--ledger-background)]'
                  : 'border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-selected)] hover:text-[var(--ledger-text-primary)]'
              }`}
            >
              {filter.label}
            </button>
          ))}
          {onCreateCustom && (
            <button
              type="button"
              onClick={onCreateCustom}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--ledger-accent)] px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
            >
              Create
              <Plus size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {isLoading ? (
          <div className="pb-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="mx-0.5 flex h-9 animate-pulse items-center gap-3 rounded-lg px-2.5"
              >
                <div className="h-3.5 w-36 rounded bg-[var(--ledger-surface-muted)]" />
                <div className="h-3 w-28 rounded bg-[var(--ledger-surface-muted)]" />
              </div>
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="py-8 text-center text-[var(--ledger-text-muted)]">
            <p className="text-sm">No templates found</p>
          </div>
        ) : (
          <div className="pb-1">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className={`group relative rounded-lg text-left transition hover:bg-[var(--ledger-surface-selected)] ${
                  rowMenuTemplateId === template.id ? 'z-40' : 'z-0'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handlePreview(template)}
                  className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 pr-12 text-left"
                >
                  <h3 className="min-w-0 shrink-0 max-w-[34%] truncate text-sm font-medium leading-5 text-[var(--ledger-text-primary)]">
                    {template.name}
                  </h3>
                  {template.description?.trim() && (
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--ledger-text-secondary)]">
                      {template.description.trim()}
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--ledger-text-muted)]">
                    <span className="rounded-md border border-[color:var(--ledger-border-subtle)] px-1.5 py-0.5 capitalize">
                      {template.category || 'personal'}
                    </span>
                    <span
                      className="rounded-md bg-[var(--ledger-surface-muted)] px-1.5 py-0.5 font-medium"
                      title="Template source"
                    >
                      {template.is_system
                        ? 'Ledger'
                        : template.visibility === 'workspace'
                        ? 'Workspace'
                        : 'Mine'}
                    </span>
                  </span>
                </button>

                <div className="absolute right-2 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1">
                  {template.pinned && <Pin size={12} className="text-[var(--ledger-accent)]" />}
                  <div className="relative">
                    <button
                      type="button"
                      data-template-row-actions="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRowMenuTemplateId((current) =>
                          current === template.id ? null : template.id
                        );
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-selected)]"
                      aria-label={`Template actions for ${template.name}`}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    {rowMenuTemplateId === template.id && (
                      <div
                        data-template-row-menu="true"
                        className="absolute right-0 top-full z-50 mt-1 min-w-34 overflow-hidden rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 shadow-[var(--ledger-shadow)]"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => void handlePreview(template)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-selected)]"
                        >
                          <Eye size={12} />
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePin(template)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-selected)]"
                        >
                          <Pin size={12} />
                          {template.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDuplicate(template)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-selected)]"
                        >
                          <Copy size={12} />
                          Duplicate
                        </button>
                        {!template.is_system && onEditTemplate && (
                          <button
                            type="button"
                            onClick={() => onEditTemplate(template)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-selected)]"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                        )}
                        {!template.is_system && (
                          <button
                            type="button"
                            onClick={() => {
                              setRowMenuTemplateId(null);
                              void handleDeleteTemplate(template);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={12} className="text-red-500" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
