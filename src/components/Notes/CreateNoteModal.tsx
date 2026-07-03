import { ChevronRight, FileText, Lightbulb, User, BookOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { TemplateGallery } from './TemplateGallery';

interface CreateNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSectionId?: string | null;
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

type WorkspaceTemplateSummary = {
  id: string;
  name: string;
};

type Step = 'main' | 'gallery' | 'custom-form';

const QUICK_TEMPLATES = [
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    icon: User,
    description: 'Date, attendees, agenda, discussion, action items',
  },
  {
    id: 'project-brief',
    name: 'Project Brief',
    icon: Lightbulb,
    description: 'Project, owner, due, objective, success criteria',
  },
  {
    id: 'daily-reflection',
    name: 'Daily Reflection',
    icon: FileText,
    description: "Wins, lessons, blockers, tomorrow's focus, mood",
  },
  {
    id: 'book-notes',
    name: 'Book Notes',
    icon: BookOpen,
    description: 'Title, author, summary, key takeaways, quotes',
  },
];

const QUICK_TEMPLATE_FALLBACKS: Record<string, { content: string; content_html: string }> = {
  'meeting notes': {
    content: 'Date\nAttendees\nAgenda\nDiscussion\nAction items',
    content_html:
      '<p>Date</p><p>Attendees</p><p>Agenda</p><p>Discussion</p><p>Action items</p>',
  },
  'project brief': {
    content: 'Project\nOwner\nDue\nObjective\nSuccess criteria',
    content_html:
      '<p>Project</p><p>Owner</p><p>Due</p><p>Objective</p><p>Success criteria</p>',
  },
  'daily reflection': {
    content: 'Wins\nLessons\nBlockers\nTomorrow\'s focus\nMood',
    content_html:
      "<p>Wins</p><p>Lessons</p><p>Blockers</p><p>Tomorrow's focus</p><p>Mood</p>",
  },
  'book notes': {
    content: 'Title\nAuthor\nSummary\nKey takeaways\nQuotes',
    content_html:
      '<p>Title</p><p>Author</p><p>Summary</p><p>Key takeaways</p><p>Quotes</p>',
  },
};

export const CreateNoteModal = ({
  isOpen,
  onClose,
  defaultSectionId = null,
  compactShell = false,
  onNoteCreated,
}: CreateNoteModalProps) => {
  const api = useApi();
  const [step, setStep] = useState<Step>('main');
  const [isCreating, setIsCreating] = useState(false);
  const [workspaceTemplates, setWorkspaceTemplates] = useState<WorkspaceTemplateSummary[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep('main');
    }
  }, [isOpen]);

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
              ? data.map((template: { id: string; name: string }) => ({ id: template.id, name: template.name }))
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

  const handleCreateQuickTemplate = async (name: string, templateId: string | null) => {
    setIsCreating(true);
    try {
      if (templateId) {
        await handleCreateFromTemplate(templateId);
        return;
      }

      const fallback = QUICK_TEMPLATE_FALLBACKS[name.toLowerCase()];
      if (!fallback) {
        throw new Error('Template not found');
      }

      const note = await api.createNote(name, fallback.content, {
        content_html: fallback.content_html,
        section_id: defaultSectionId ?? undefined,
        source: 'template',
        mode: 'text',
      });
      onNoteCreated?.(note);
      onClose();
    } catch (error) {
      console.error('Failed to create note from quick template:', error);
    } finally {
      setIsCreating(false);
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
                    {QUICK_TEMPLATES.map(({ id, name, icon: Icon, description }) => {
                      const templateId = resolveQuickTemplateId(name);
                      return (
                        <button
                          key={id}
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
                onCreateCustom={() => setStep('custom-form')}
              />
            </div>
          )}

          {step === 'custom-form' && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">Create custom template form coming soon</p>
              <button
                type="button"
                onClick={() => setStep('gallery')}
                className="mt-3 text-sm font-medium text-[#FF5F40] hover:underline"
              >
                Back to gallery
              </button>
            </div>
          )}
          </div>
      </div>
    </ModalOverlay>
  );
};
