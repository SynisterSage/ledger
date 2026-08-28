import { CalendarDays, Check, ChevronDown, FolderKanban, Plus, StickyNote } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { WebShellLayout } from './WebSidebar';
import { SearchProvider } from '../context/SearchContext';
import { useSidebar } from '../context/SidebarContext';
import { ToastProvider } from '../components/Common/ToastProvider';
import { NotificationCenterProvider } from '../components/Notifications/NotificationCenterContext';
import { WebReliabilityProvider } from './WebReliabilityProvider';

const previewItems = [
  { title: 'Homepage direction', detail: 'Note · Updated today', icon: StickyNote, color: 'var(--ledger-accent)' },
  { title: 'Product review', detail: 'Today · 10:00 – 10:30', icon: CalendarDays, color: '#6b7280' },
  { title: 'Ledger public beta', detail: 'Project · In progress', icon: FolderKanban, color: '#8b5cf6' },
];

/**
 * Public, read-only visual entry point for the marketing product preview.
 * The shell and sidebar are the same browser components used by /app; only
 * the content is fixture-driven until the demo data adapter is connected.
 */
const PreviewShell = () => {
  const { setState, setPosition, setIsVisible } = useSidebar();
  const didConfigurePreviewRef = useRef(false);

  useEffect(() => {
    if (didConfigurePreviewRef.current) return;
    didConfigurePreviewRef.current = true;
    setState('expanded');
    setPosition('left');
    setIsVisible(true);
  }, [setIsVisible, setPosition, setState]);

  return (
    <WebShellLayout previewMode>
    <section className="product-preview-content flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ledger-background)]">
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
    </section>
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
