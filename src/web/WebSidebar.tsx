import { SidebarContainer } from '../components/Sidebar/SidebarContainer';

export const WebSidebar = () => (
  <aside className="web-ledger-sidebar shrink-0 border-r border-[color:var(--ledger-border-subtle)]">
    <SidebarContainer browserMode />
  </aside>
);
