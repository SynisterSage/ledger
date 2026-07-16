import { ChevronRight, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { TemplateGallery } from './TemplateGallery';
import { RichTextEditor } from './RichTextEditor';
import { QUICK_TEMPLATE_DEFINITIONS } from './templateDefinitions';

interface CreateNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSectionId?: string | null;
  initialStep?: Step;
  initialTemplateId?: string | null;
  compactShell?: boolean;
  onNoteCreated?: (note: {
    id: string;
    title: string;
    content: string;
    date: string;
    mood: string | null;
    source: string;
    section_id?: string | null;
    parent_id?: string | null;
    sort_order?: number;
    depth?: number;
    created_at: string;
    updated_at: string;
  }) => void;
}

type Step = 'main' | 'gallery' | 'custom-form';

export const CreateNoteModal = ({
  isOpen,
  onClose,
  defaultSectionId = null,
  initialStep = 'main',
  initialTemplateId = null,
  compactShell = false,
  onNoteCreated,
}: CreateNoteModalProps) => {
  const api = useApi();
  const { activeWorkspace } = useWorkspaceContext();
  const [step, setStep] = useState<Step>('main');
  const [isCreating, setIsCreating] = useState(false);
  const [workspaceTemplates, setWorkspaceTemplates] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateCategory, setTemplateCategory] = useState('personal');
  const [templateVisibility, setTemplateVisibility] = useState<'mine' | 'workspace'>('mine');
  const [templateContent, setTemplateContent] = useState('');
  const [templateTitlePattern, setTemplateTitlePattern] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(initialStep);
    }
  }, [initialStep, isOpen]);

  useEffect(() => {
    if (isOpen) setStep(initialStep);
  }, [initialStep, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;

    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const data = await api.getTemplates();
        if (!mounted) return;
        setWorkspaceTemplates(
          Array.isArray(data)
            ? data.map((template: { id: string; name: string }) => ({
                id: template.id,
                name: template.name,
              }))
            : []
        );
      } catch (error) {
        console.error('Failed to load templates for quick create:', error);
        if (mounted) setWorkspaceTemplates([]);
      } finally {
        if (mounted) setIsLoadingTemplates(false);
      }
    };

    loadTemplates();

    return () => {
      mounted = false;
    };
  }, [api, isOpen]);

  useEffect(() => {
    const handler = () => {
      if (!isOpen) return;
      void (async () => {
        setIsLoadingTemplates(true);
        try {
          const data = await api.getTemplates();
          setWorkspaceTemplates(
            Array.isArray(data)
              ? data.map((template: { id: string; name: string }) => ({
                  id: template.id,
                  name: template.name,
                }))
              : []
          );
        } catch (e) {
          console.error('Failed to refresh templates on update event', e);
        } finally {
          setIsLoadingTemplates(false);
        }
      })();
    };

    window.addEventListener('templates:updated', handler as EventListener);
    return () => window.removeEventListener('templates:updated', handler as EventListener);
  }, [api, isOpen]);

  const quickTemplateMap = useMemo(() => {
    const map = new Map<string, string>();
    workspaceTemplates.forEach((template) => {
      map.set(template.name.toLowerCase(), template.id);
    });
    return map;
  }, [workspaceTemplates]);

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isCreating) return;
      onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isCreating, isOpen, onClose]);

  const handleCreateBlank = async () => {
    setIsCreating(true);
    try {
      const note = await api.createNote('Untitled Note', '', {
        content_html: '<p></p>',
        section_id: defaultSectionId ?? undefined,
      });
      onNoteCreated?.(note);
      onClose();
    } catch (error) {
      console.error('Failed to create note:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    setIsCreating(true);
    try {
      const note = await api.createNoteFromTemplate(templateId, {
        section_id: defaultSectionId ?? undefined,
      });
      onNoteCreated?.(note);
      onClose();
    } catch (error) {
      console.error('Failed to create note from template:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateQuickTemplate = async (_name: string, templateId: string | null) => {
    setIsCreating(true);
    try {
      if (templateId) {
        await handleCreateFromTemplate(templateId);
        return;
      }

      throw new Error('Template not available');
    } catch (error) {
      console.error('Failed to create note from quick template:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!templateName.trim()) return;
    setIsCreating(true);
    try {
      const payload = {
        name: templateName.trim(),
        description: templateDescription.trim() || null,
        category: templateCategory,
        visibility: templateVisibility,
        content_html: templateContent,
        title_pattern: templateTitlePattern.trim() || null,
      };
      if (editingTemplateId) await api.updateTemplate(editingTemplateId, payload);
      else await api.createTemplate(payload);
      window.dispatchEvent(new CustomEvent('templates:updated'));
      setStep('gallery');
      setTemplateName('');
      setTemplateDescription('');
      setTemplateContent('');
      setTemplateTitlePattern('');
      setEditingTemplateId(null);
    } catch (error) {
      console.error('Failed to create template:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditTemplate = async (template: {
    id: string;
    name: string;
    description: string | null;
    category: string;
    visibility?: 'mine' | 'workspace';
  }) => {
    try {
      const full = (await api.getTemplate(template.id)) as {
        content_html?: string;
        title_pattern?: string | null;
      };
      setTemplateName(template.name);
      setTemplateDescription(template.description || '');
      setTemplateCategory(template.category || 'personal');
      setTemplateVisibility(template.visibility === 'workspace' ? 'workspace' : 'mine');
      setTemplateContent(full.content_html || '');
      setTemplateTitlePattern(full.title_pattern || '');
      setEditingTemplateId(template.id);
      setStep('custom-form');
    } catch (error) {
      console.error('Failed to open template:', error);
    }
  };

  const resolveQuickTemplateId = (name: string) => quickTemplateMap.get(name.toLowerCase()) ?? null;

  if (!isOpen) return null;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={() => {
        if (!isCreating) onClose();
      }}
      closeOnBackdropClick={!isCreating}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer={`w-full overflow-hidden rounded-2xl border shadow-lg ${
        compactShell
          ? 'max-w-[420px] border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]'
          : 'max-w-[760px] border-gray-200 bg-white'
      }`}
    >
      <div className="flex max-h-[88vh] flex-col">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white/95 px-5 py-3 backdrop-blur">
          <h2 className="font-semibold text-gray-900">
            {step === 'main' && 'Create Note'}
            {step === 'gallery' && 'Browse Templates'}
            {step === 'custom-form' && 'Create Custom Template'}
          </h2>
          <ModalCloseButton
            onClick={onClose}
            ariaLabel="Close create note modal"
            disabled={isCreating}
          />
        </div>

        {/* Body */}
        <div className="p-5">
          {step === 'main' && (
            <div className="space-y-4">
              {/* Blank note */}
              <button
                type="button"
                onClick={handleCreateBlank}
                disabled={isCreating}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 text-left transition hover:bg-gray-50 active:bg-white disabled:opacity-50"
              >
                <FileText size={20} className="text-gray-400" />
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Blank Note</p>
                  <p className="text-sm text-gray-500">Start with an empty canvas</p>
                </div>
                <ChevronRight size={18} className="text-gray-400" />
              </button>

              {/* Quick templates */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase">Quick Templates</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_TEMPLATE_DEFINITIONS.map(({ name, icon: Icon, description }) => {
                    const templateId = resolveQuickTemplateId(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => void handleCreateQuickTemplate(name, templateId)}
                        disabled={isCreating || isLoadingTemplates}
                        className="p-3 rounded-lg border border-gray-200 text-left transition hover:bg-gray-50 active:bg-white disabled:opacity-50"
                      >
                        <Icon size={16} className="text-gray-600 mb-2" />
                        <p className="font-medium text-sm text-gray-900">{name}</p>
                        <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Browse all templates */}
              <button
                type="button"
                onClick={() => setStep('gallery')}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 text-left transition hover:bg-gray-50 active:bg-white"
              >
                <div className="w-5 h-5 rounded border-2 border-gray-400 flex items-center justify-center">
                  <div className="w-2 h-2 bg-gray-400 rounded-full" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Browse All Templates</p>
                  <p className="text-sm text-gray-500">View the complete gallery</p>
                </div>
                <ChevronRight size={18} className="text-gray-400" />
              </button>
            </div>
          )}

          {step === 'gallery' && (
            <div className="min-h-0 overflow-hidden">
              <TemplateGallery
                onSelectTemplate={handleCreateFromTemplate}
                initialTemplateId={initialTemplateId}
                onCreateCustom={() => setStep('custom-form')}
                onEditTemplate={handleEditTemplate}
              />
            </div>
          )}

          {step === 'custom-form' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-gray-600">
                  Name
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm"
                    placeholder="Weekly team check-in"
                  />
                </label>
                <label className="text-xs font-medium text-gray-600">
                  Category
                  <select
                    value={templateCategory}
                    onChange={(e) => setTemplateCategory(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm"
                  >
                    {['meeting', 'internship', 'project', 'personal', 'reading']
                      .concat(activeWorkspace?.is_personal ? [] : ['team'])
                      .map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-gray-600">
                Description
                <textarea
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  className="mt-1 min-h-16 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="When this template is useful"
                />
              </label>
              <div className="flex items-center gap-4 text-sm text-gray-700">
                <span className="text-xs font-medium text-gray-600">Visibility</span>
                {(['mine', 'workspace'] as const).map((visibility) => (
                  <label key={visibility} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={templateVisibility === visibility}
                      onChange={() => setTemplateVisibility(visibility)}
                    />
                    {visibility === 'mine' ? 'Mine' : 'Workspace'}
                  </label>
                ))}
              </div>
              <label className="block text-xs font-medium text-gray-600">
                Title pattern
                <input
                  value={templateTitlePattern}
                  onChange={(e) => setTemplateTitlePattern(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm"
                  placeholder="{{date}} Team Meeting"
                />
              </label>
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Content</p>
                <div className="max-h-[38vh] overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  <RichTextEditor
                    initialValue={templateContent}
                    editorKey="new-template"
                    onChange={setTemplateContent}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep('gallery')}
                  className="rounded-lg px-3 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!templateName.trim() || isCreating}
                  onClick={() => void handleCreateTemplate()}
                  className="rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save template
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};
