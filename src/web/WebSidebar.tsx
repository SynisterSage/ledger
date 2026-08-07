import { type ReactNode } from 'react';
import { SidebarContainer } from '../components/Sidebar/SidebarContainer';
import { useSidebar } from '../context/SidebarContext';
import { WebModuleLayout } from './WebResponsiveLayout';

export const WebSidebar = () => {
  const { state, isVisible, position } = useSidebar();
  const isExpanded = state === 'expanded';
  const effectivePosition = position === 'floating' ? 'left' : position;
  const isHorizontal = effectivePosition === 'top' || effectivePosition === 'bottom';
  const borderClass =
    effectivePosition === 'right'
      ? 'border-l'
      : effectivePosition === 'bottom'
        ? 'border-t'
        : effectivePosition === 'top'
          ? 'border-b'
          : 'border-r';

  if (!isVisible || state === 'fullscreen') return null;

  return (
    <aside
      className={`web-ledger-sidebar shrink-0 border-[color:var(--ledger-border-subtle)] transition-[width,height] duration-150 ease-out ${
        isHorizontal ? 'flex justify-center' : ''
      } ${borderClass}`}
      data-sidebar-state={isExpanded ? 'expanded' : 'rail'}
      data-sidebar-position={effectivePosition}
      data-sidebar-orientation={isHorizontal ? 'horizontal' : 'vertical'}
    >
      <SidebarContainer browserMode />
    </aside>
  );
};

export const WebShellLayout = ({ children }: { children: ReactNode }) => {
  const { position } = useSidebar();
  const effectivePosition = position === 'floating' ? 'left' : position;
  const isHorizontal = effectivePosition === 'top' || effectivePosition === 'bottom';
  const sidebarFirst = effectivePosition === 'left' || effectivePosition === 'top';

  const sidebar = <WebSidebar />;
  const content = (
    <main className="web-ledger-content relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <WebModuleLayout>{children}</WebModuleLayout>
    </main>
  );

  return (
    <div
      className={`web-ledger-shell flex h-screen min-h-0 overflow-hidden bg-[var(--ledger-background)] ${
        isHorizontal ? 'flex-col' : 'flex-row'
      }`}
      data-sidebar-position={effectivePosition}
    >
      {sidebarFirst ? sidebar : content}
      {sidebarFirst ? content : sidebar}
    </div>
  );
};
