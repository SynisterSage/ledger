import { CalendarDays, Check, ChevronDown, FolderKanban, Plus, StickyNote } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useState } from 'react';
import { WebShellLayout } from './WebSidebar';
import { SearchProvider } from '../context/SearchContext';
import { useSidebar } from '../context/SidebarContext';
import { ToastProvider } from '../components/Common/ToastProvider';
import { NotificationCenterProvider } from '../components/Notifications/NotificationCenterContext';
import { WebReliabilityProvider } from './WebReliabilityProvider';
import ProjectsWindow from '../components/Projects/ProjectsWindow';
import CalendarWindow from '../components/Calendar/CalendarWindow';

const previewItems = [
  { title: 'Homepage direction', detail: 'Note · Updated today', icon: StickyNote, color: 'var(--ledger-accent)' },
  { title: 'Product review', detail: 'Today · 10:00 – 10:30', icon: CalendarDays, color: '#6b7280' },
  { title: 'Ledger public beta', detail: 'Project · In progress', icon: FolderKanban, color: '#8b5cf6' },
];

const ProjectsPreview = () => <ProjectsWindow previewMode />;
const CalendarPreview = () => <CalendarWindow previewMode />;

/*
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject = projectRows.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <section className="product-preview-content flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ledger-background)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--ledger-text-primary)]">
          {selectedProject ? <button type="button" className="text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]" onClick={() => setSelectedProjectId(null)}>Projects</button> : 'Projects'}
          <ChevronDown size={13} className="text-[var(--ledger-text-muted)]" />
        </div>
        <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]"><Plus size={13} /> New</button>
      </div>

      {selectedProject ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-7 sm:px-8 sm:py-9">
          <div className="mx-auto max-w-3xl">
            <button type="button" onClick={() => setSelectedProjectId(null)} className="mb-7 text-[11px] text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]">← Roadmap</button>
            <div className="flex items-start gap-3"><span className="mt-1 h-3 w-3 rounded-[3px]" style={{ background: selectedProject.color }} /><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Project</p><h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[var(--ledger-text-primary)]">{selectedProject.name}</h1><p className="mt-2 text-[12px] text-[var(--ledger-text-secondary)]">A focused outcome with the next actions and context kept together.</p></div></div>
            <div className="mt-8 grid gap-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(170px,0.7fr)]">
              <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]"><div className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3 text-[12px] font-medium">Next actions</div><div className="divide-y divide-[color:var(--ledger-border-subtle)]">{['Confirm scope for the public beta','Review the onboarding flow','Write the next release note'].map((task, index) => <div key={task} className="flex items-center gap-3 px-4 py-3"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)]">{index === 0 && <Check size={11} />}</span><span className={`text-[12px] ${index === 0 ? 'text-[var(--ledger-text-muted)] line-through' : 'text-[var(--ledger-text-primary)]'}`}>{task}</span></div>)}</div></div>
              <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-4"><div className="text-[12px] font-medium">Details</div><dl className="mt-4 space-y-3 text-[11px]"><div className="flex justify-between gap-3"><dt className="text-[var(--ledger-text-muted)]">Status</dt><dd>{selectedProject.status}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--ledger-text-muted)]">Timeline</dt><dd>{selectedProject.start} – {selectedProject.end}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--ledger-text-muted)]">Progress</dt><dd>{selectedProject.progress}%</dd></div></dl></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8 sm:py-8"><div className="mx-auto max-w-4xl"><div className="flex items-end justify-between gap-4"><div><p className="text-[11px] text-[var(--ledger-text-muted)]">Workspace projects</p><h1 className="mt-1 text-[25px] font-semibold tracking-tight text-[var(--ledger-text-primary)]">Roadmap</h1></div><div className="flex items-center gap-1 text-[11px] text-[var(--ledger-text-secondary)]"><button type="button" className="rounded-md bg-[var(--ledger-surface-hover)] px-2 py-1">All</button><button type="button" className="rounded-md px-2 py-1 hover:bg-[var(--ledger-surface-hover)]">Quarter</button></div></div><div className="mt-7 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]"><div className="grid grid-cols-[minmax(150px,1.2fr)_minmax(180px,2fr)] border-b border-[color:var(--ledger-border-subtle)] text-[10px] text-[var(--ledger-text-muted)]"><div className="px-4 py-3">Projects</div><div className="border-l border-[color:var(--ledger-border-subtle)] px-4 py-3">Timeline · 2026</div></div>{projectRows.map((project) => <button key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)} className="grid w-full grid-cols-[minmax(150px,1.2fr)_minmax(180px,2fr)] border-b border-[color:var(--ledger-border-subtle)] text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"><div className="flex min-w-0 items-center gap-2 px-4 py-4"><span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: project.color }} /><span className="min-w-0 truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">{project.name}</span></div><div className="relative flex items-center border-l border-[color:var(--ledger-border-subtle)] px-4"><div className="absolute inset-x-4 h-px bg-[var(--ledger-border-subtle)]" /><div className="relative h-6 rounded-md" style={{ width: `${project.progress + 22}%`, background: project.color, opacity: 0.82 }} /><span className="relative ml-2 text-[10px] text-[var(--ledger-text-muted)]">{project.start} – {project.end}</span></div></button>)}</div><div className="mt-4 flex items-center gap-2 text-[10px] text-[var(--ledger-text-muted)]"><Circle size={8} className="text-[var(--ledger-accent)]" fill="currentColor" /> Click a project to open its workspace.</div></div></div>
      )}
    </section>
  );
}; */

/**
 * Public, read-only visual entry point for the marketing product preview.
 * The shell and sidebar are the same browser components used by /app; only
 * the content is fixture-driven until the demo data adapter is connected.
 */
const PreviewShell = () => {
  const [previewPage, setPreviewPage] = useState<'overview' | 'projects' | 'calendar'>('overview');
  const { setState, setPosition, setIsVisible } = useSidebar();
  const didConfigurePreviewRef = useRef(false);

  useEffect(() => {
    if (didConfigurePreviewRef.current) return;
    didConfigurePreviewRef.current = true;
    setState('expanded');
    setPosition('left');
    setIsVisible(true);
  }, [setIsVisible, setPosition, setState]);

  useEffect(() => {
    const handlePreviewRouteIntent = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === 'projects') setPreviewPage('projects');
      if (kind === 'calendar') setPreviewPage('calendar');
      if (kind === 'dashboard' || kind === 'new-tab') setPreviewPage('overview');
    };
    window.addEventListener('ledger:preview-route-intent', handlePreviewRouteIntent);
    return () => window.removeEventListener('ledger:preview-route-intent', handlePreviewRouteIntent);
  }, []);

  return (
    <WebShellLayout previewMode>
    {previewPage === 'projects' ? <ProjectsPreview /> : previewPage === 'calendar' ? <CalendarPreview /> : <section className="product-preview-content flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ledger-background)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--ledger-text-primary)]">Workspace overview</span>
          <ChevronDown size={13} className="text-[var(--ledger-text-muted)]" />
        </div>
        <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)]">
          <Plus size={13} /> Capture
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">Wednesday, August 27</p>
          <h1 className="mt-1 text-[25px] font-semibold tracking-tight text-[var(--ledger-text-primary)]">What needs your attention today?</h1>
          <div className="mt-7 grid gap-5 sm:grid-cols-[minmax(0,1.25fr)_minmax(180px,0.75fr)]">
            <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)]">
              <div className="flex items-center justify-between border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
                <span className="text-[12px] font-medium text-[var(--ledger-text-primary)]">Today’s focus</span>
                <span className="text-[10px] text-[var(--ledger-text-muted)]">2 of 4 complete</span>
              </div>
              <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
                {previewItems.map(({ title, detail, icon: Icon, color }) => (
                  <div key={title} className="flex items-center gap-3 px-4 py-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]" style={{ color }}><Icon size={13} /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">{title}</div><div className="mt-0.5 truncate text-[10px] text-[var(--ledger-text-muted)]">{detail}</div></div>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-muted)]"><Check size={11} /></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] p-4"><div className="text-[12px] font-medium text-[var(--ledger-text-primary)]">Coming up</div><div className="mt-4 border-l-2 border-[var(--ledger-accent)] pl-3"><div className="text-[12px] font-medium text-[var(--ledger-text-primary)]">Product review</div><div className="mt-1 text-[10px] text-[var(--ledger-text-muted)]">Today · 10:00 – 10:30</div></div><div className="mt-5 border-l-2 border-[var(--ledger-border-strong)] pl-3"><div className="text-[12px] font-medium text-[var(--ledger-text-primary)]">Team sync</div><div className="mt-1 text-[10px] text-[var(--ledger-text-muted)]">Today · 14:30 – 15:00</div></div></div>
          </div>
        </div>
      </div>
    </section>}
    </WebShellLayout>
  );
};

export const ProductPreviewPage = () => (
  <WebReliabilityProvider>
    <SearchProvider>
      <ToastProvider>
        <NotificationCenterProvider>
          <PreviewShell />
        </NotificationCenterProvider>
      </ToastProvider>
    </SearchProvider>
  </WebReliabilityProvider>
);

export default ProductPreviewPage;
