import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ModalOverlay } from '../Common/ModalOverlay';

export type DriveTemplateFolder = { name: string; children?: DriveTemplateFolder[]; __id?: string };
export type DriveFolderTemplate = {
  id: string;
  name: string;
  description?: string | null;
  structure?: { folders?: DriveTemplateFolder[] };
  updated_at?: string | null;
};

type StarterTemplate = {
  name: string;
  description: string;
  category: string;
  folders: DriveTemplateFolder[];
};
const makeStarter = (category: string, name: string, folders: string): StarterTemplate => ({
  category,
  name,
  description: `${name} folder structure.`,
  folders: folders.split('|').map((folder) => ({ name: folder })),
});

export const starterTemplates: StarterTemplate[] = [
  makeStarter(
    'Featured',
    'Graphic design project',
    '01 Brief|02 Research & references|03 Concepts|04 Working files|05 Client review|06 Final artwork|07 Exports'
  ),
  makeStarter(
    'Featured',
    'UI/UX project',
    '01 Product requirements|02 Research|03 User flows|04 Wireframes|05 Visual design|06 Prototype|07 Handoff|08 Archive'
  ),
  makeStarter(
    'Featured',
    'Software project',
    '01 Planning|02 Product requirements|03 Design|04 Documentation|05 Releases|06 Testing|07 Assets|08 Archive'
  ),
  makeStarter(
    'Featured',
    'Publication',
    '01 Editorial planning|02 Writing|03 Images & artwork|04 Layout|05 Proofs|06 Final publication|07 Promotion|08 Archive'
  ),
  makeStarter(
    'Featured',
    'Internship',
    '01 Onboarding|02 Schedule & requirements|03 Assignments|04 Active projects|05 Meeting notes|06 Feedback & evaluations|07 Final deliverables|08 Portfolio materials'
  ),
  makeStarter(
    'Featured',
    'Team workspace',
    '01 Team information|02 Goals & planning|03 Meeting notes|04 Active projects|05 Shared resources|06 Reports|07 Processes|08 Archive'
  ),
  makeStarter(
    'Featured',
    'Personal organization',
    '01 Important documents|02 Finances|03 Health|04 Home|05 Travel|06 Personal projects|07 Learning|08 Archive'
  ),
  makeStarter(
    'Featured',
    'Client project',
    '01 Client information|02 Brief & scope|03 Research|04 Working files|05 Review & feedback|06 Final deliverables|07 Invoices & agreements|08 Archive'
  ),
  makeStarter(
    'Creative & design',
    'Branding project',
    '01 Discovery|02 Brand strategy|03 Visual research|04 Logo concepts|05 Brand system|06 Guidelines|07 Applications|08 Final files'
  ),
  makeStarter(
    'Creative & design',
    'Social media campaign',
    '01 Strategy|02 Content calendar|03 Copy|04 Creative assets|05 Approvals|06 Scheduled content|07 Published content|08 Performance'
  ),
  makeStarter(
    'Creative & design',
    'Photography project',
    '01 Brief|02 Shot list|03 Locations|04 Raw photos|05 Selects|06 Edited photos|07 Client review|08 Final delivery'
  ),
  makeStarter(
    'Creative & design',
    'Video production',
    '01 Creative brief|02 Scripts|03 Storyboards|04 Production|05 Raw footage|06 Editing|07 Review|08 Final exports'
  ),
  makeStarter(
    'Creative & design',
    'Exhibition project',
    '01 Exhibition concept|02 Artists|03 Artwork|04 Curatorial writing|05 Floor plans|06 Marketing|07 Installation|08 Reception & events|09 Archive'
  ),
  makeStarter(
    'Creative & design',
    'Portfolio project',
    '01 Project selection|02 Case study writing|03 Images & mockups|04 Website assets|05 Resume & biography|06 Applications|07 Published portfolio'
  ),
  makeStarter(
    'Creative & design',
    'Illustration project',
    '01 Brief|02 References|03 Sketches|04 Concepts|05 Working artwork|06 Revisions|07 Final artwork|08 Exports'
  ),
  makeStarter(
    'Creative & design',
    'Packaging design',
    '01 Product information|02 Requirements|03 Dielines|04 Concepts|05 Working files|06 Proofs|07 Production files|08 Product photography'
  ),
  makeStarter(
    'Publishing',
    'Product catalog',
    '01 Catalog plan|02 Product information|03 Product photography|04 Writing & descriptions|05 Page layouts|06 Proofreading|07 Approvals|08 Print-ready files|09 Digital edition'
  ),
  makeStarter(
    'Publishing',
    'Art catalog',
    '01 Artists|02 Artwork images|03 Artist biographies|04 Curatorial writing|05 Catalog layout|06 Proofs|07 Print production|08 Distribution|09 Archive'
  ),
  makeStarter(
    'Publishing',
    'Magazine issue',
    '01 Issue planning|02 Editorial calendar|03 Articles|04 Photography|05 Illustrations|06 Layout|07 Proofs|08 Final issue|09 Promotion'
  ),
  makeStarter(
    'Publishing',
    'Newsletter',
    '01 Issue planning|02 Stories|03 Images|04 Draft|05 Review|06 Final|07 Distribution|08 Performance'
  ),
  makeStarter(
    'Publishing',
    'Book project',
    '01 Outline|02 Manuscript|03 Research|04 Images|05 Editing|06 Page design|07 Proofs|08 Publishing|09 Promotion'
  ),
  makeStarter(
    'Publishing',
    'Print production',
    '01 Specifications|02 Vendor quotes|03 Source files|04 Proofs|05 Corrections|06 Approved artwork|07 Print-ready files|08 Shipping & delivery'
  ),
  makeStarter(
    'Product & UI',
    'Product feature',
    '01 Problem|02 Requirements|03 Research|04 User flows|05 Design|06 Development|07 QA|08 Launch|09 Follow-up'
  ),
  makeStarter(
    'Product & UI',
    'Website redesign',
    '01 Discovery|02 Content audit|03 Sitemap|04 Wireframes|05 Visual design|06 Development|07 QA|08 Launch|09 Maintenance'
  ),
  makeStarter(
    'Product & UI',
    'Design system',
    '01 Foundations|02 Tokens|03 Components|04 Patterns|05 Documentation|06 Accessibility|07 Contributions|08 Releases'
  ),
  makeStarter(
    'Product & UI',
    'User research',
    '01 Research plan|02 Participants|03 Interview materials|04 Session recordings|05 Notes|06 Findings|07 Recommendations|08 Research report'
  ),
  makeStarter(
    'Product & UI',
    'App launch',
    '01 Product planning|02 Design|03 Development|04 Testing|05 Store assets|06 Marketing|07 Launch|08 Feedback|09 Updates'
  ),
  makeStarter(
    'Development',
    'Web application',
    '01 Requirements|02 Architecture|03 Frontend|04 Backend|05 Database|06 Integrations|07 Testing|08 Deployment|09 Documentation'
  ),
  makeStarter(
    'Development',
    'API integration',
    '01 Provider documentation|02 Authentication|03 Data models|04 Endpoints|05 Webhooks|06 Testing|07 Error handling|08 Deployment|09 Support'
  ),
  makeStarter(
    'Development',
    'Release cycle',
    '01 Release plan|02 Features|03 Bug fixes|04 QA|05 Release notes|06 Deployment|07 Monitoring|08 Post-release review'
  ),
  makeStarter(
    'Development',
    'Open-source project',
    '01 Roadmap|02 Documentation|03 Issues|04 Contributions|05 Releases|06 Community|07 Brand assets|08 Archive'
  ),
  makeStarter(
    'Development',
    'Bug investigation',
    '01 Reports|02 Reproduction|03 Logs|04 Investigation|05 Proposed fixes|06 Testing|07 Resolution|08 Follow-up'
  ),
  makeStarter(
    'Team & operations',
    'Team onboarding',
    '01 Welcome|02 Team information|03 Policies|04 Accounts & access|05 Training|06 First assignments|07 Check-ins|08 Feedback'
  ),
  makeStarter(
    'Team & operations',
    'Weekly team management',
    '01 Weekly priorities|02 Team meetings|03 Individual check-ins|04 Active work|05 Blockers|06 Decisions|07 Reports|08 Completed weeks'
  ),
  makeStarter(
    'Team & operations',
    'Department workspace',
    '01 Strategy|02 Team|03 Projects|04 Meetings|05 Processes|06 Reports|07 Resources|08 Archive'
  ),
  makeStarter(
    'Team & operations',
    'Standard operating procedures',
    '01 Company policies|02 Team procedures|03 How-to guides|04 Templates|05 Training materials|06 Compliance|07 Retired procedures'
  ),
  makeStarter(
    'Team & operations',
    'Vendor management',
    '01 Vendor information|02 Agreements|03 Quotes|04 Orders|05 Invoices|06 Deliveries|07 Performance|08 Archive'
  ),
  makeStarter(
    'Internship & education',
    'Creative internship',
    '01 Internship requirements|02 Onboarding|03 Gallery or company information|04 Weekly assignments|05 Design projects|06 Meetings & notes|07 Time tracking|08 Evaluation|09 Portfolio work'
  ),
  makeStarter(
    'Internship & education',
    'Academic course',
    '01 Syllabus|02 Readings|03 Lecture notes|04 Assignments|05 Research|06 Projects|07 Exams|08 Final submission'
  ),
  makeStarter(
    'Internship & education',
    'Capstone project',
    '01 Proposal|02 Research|03 Planning|04 Development|05 Documentation|06 Feedback|07 Final presentation|08 Final submission'
  ),
  makeStarter(
    'Internship & education',
    'Job or internship applications',
    '01 Opportunities|02 Resumes|03 Cover letters|04 Portfolio materials|05 Submitted applications|06 Interviews|07 Follow-ups|08 Offers'
  ),
  makeStarter(
    'Events & marketing',
    'Event planning',
    '01 Event brief|02 Budget|03 Venue|04 Vendors|05 Guest list|06 Promotion|07 Schedule|08 Event day|09 Follow-up'
  ),
  makeStarter(
    'Events & marketing',
    'Conference or trade show',
    '01 Event information|02 Travel|03 Booth design|04 Marketing materials|05 Lead lists|06 Meetings|07 Shipping|08 Event photos|09 Follow-up'
  ),
  makeStarter(
    'Events & marketing',
    'Gallery reception',
    '01 Event plan|02 Artists & guests|03 Invitations|04 Promotion|05 Catering|06 Installation|07 Event photography|08 Follow-up'
  ),
  makeStarter(
    'Events & marketing',
    'Marketing campaign',
    '01 Campaign brief|02 Audience|03 Strategy|04 Copy|05 Creative|06 Approvals|07 Launch|08 Performance|09 Reporting'
  ),
  makeStarter(
    'Personal',
    'Freelance business',
    '01 Business documents|02 Leads|03 Clients|04 Proposals|05 Active projects|06 Invoices|07 Marketing|08 Portfolio|09 Archive'
  ),
  makeStarter(
    'Personal',
    'Home management',
    '01 Home documents|02 Maintenance|03 Renovations|04 Contractors|05 Receipts & warranties|06 Inspiration|07 Garden|08 Archive'
  ),
  makeStarter(
    'Personal',
    'Travel planning',
    '01 Destination research|02 Reservations|03 Transportation|04 Itinerary|05 Activities|06 Documents|07 Photos|08 Expenses'
  ),
  makeStarter(
    'Personal',
    'Personal creative work',
    '01 Ideas|02 Inspiration|03 Active projects|04 Drafts|05 Feedback|06 Finished work|07 Portfolio|08 Archive'
  ),
  makeStarter(
    'Personal',
    'Career management',
    '01 Resume|02 Portfolio|03 Applications|04 Interviews|05 Networking|06 Professional development|07 Achievements|08 Reviews'
  ),
];

const clone = (folders: DriveTemplateFolder[]): DriveTemplateFolder[] =>
  folders.map((folder) => ({
    name: folder.name,
    children: folder.children ? clone(folder.children) : [],
  }));
const countFolders = (folders: DriveTemplateFolder[]): number =>
  folders.reduce((count, folder) => count + 1 + countFolders(folder.children || []), 0);
const normalizeFolders = (folders: unknown, depth = 0): DriveTemplateFolder[] =>
  Array.isArray(folders)
    ? folders.slice(0, 50).flatMap((folder) => {
        const name = String((folder as any)?.name || '')
          .trim()
          .slice(0, 160);
        if (!name || depth > 8) return [];
        return [{ name, children: normalizeFolders((folder as any)?.children, depth + 1) }];
      })
    : [];
const removeNode = (
  folders: DriveTemplateFolder[],
  id: string
): { folders: DriveTemplateFolder[]; removed?: DriveTemplateFolder } => {
  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index];
    if (id === folder.__id) {
      return {
        folders: [...folders.slice(0, index), ...folders.slice(index + 1)],
        removed: folder,
      };
    }
    const next = removeNode(folder.children || [], id);
    if (next.removed) return { folders, removed: next.removed };
  }
  return { folders };
};
const contains = (folder: DriveTemplateFolder | undefined, id: string): boolean =>
  Boolean(
    folder && (folder.__id === id || (folder.children || []).some((child) => contains(child, id)))
  );
const addChild = (
  folders: DriveTemplateFolder[],
  parentId: string,
  child: DriveTemplateFolder
): DriveTemplateFolder[] =>
  folders.map((folder) =>
    folder.__id === parentId
      ? { ...folder, children: [...(folder.children || []), child] }
      : { ...folder, children: addChild(folder.children || [], parentId, child) }
  );
const assignIds = (folders: DriveTemplateFolder[], prefix = 'folder'): DriveTemplateFolder[] =>
  folders.map((folder, index) => ({
    ...folder,
    __id: `${prefix}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    children: assignIds(folder.children || [], `${prefix}-${index}`),
  }));
const stripIds = (folders: DriveTemplateFolder[]): DriveTemplateFolder[] =>
  folders.map(({ __id, ...folder }) => ({
    name: folder.name.trim(),
    children: stripIds(folder.children || []),
  }));

type InternalFolder = DriveTemplateFolder & { __id: string };
const foldersWithIds = (folders: DriveTemplateFolder[]) => assignIds(folders) as InternalFolder[];

function FolderTree({
  folders,
  level = 0,
  onRename,
  onDelete,
  onAddChild,
  onMove,
}: {
  folders: InternalFolder[];
  level?: number;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (id: string) => void;
  onMove: (dragged: string, target?: string) => void;
}) {
  return (
    <div className={level ? 'ml-5 border-l border-[var(--ledger-border-subtle)] pl-2' : ''}>
      {folders.map((folder) => (
        <FolderRow
          key={folder.__id}
          folder={folder}
          onRename={onRename}
          onDelete={onDelete}
          onAddChild={onAddChild}
          onMove={onMove}
        >
          <FolderTree
            folders={(folder.children || []) as InternalFolder[]}
            onRename={onRename}
            onDelete={onDelete}
            onAddChild={onAddChild}
            onMove={onMove}
            level={level + 1}
          />
        </FolderRow>
      ))}
    </div>
  );
}

function FolderRow({
  folder,
  children,
  onRename,
  onDelete,
  onAddChild,
  onMove,
}: {
  folder: InternalFolder;
  children?: React.ReactNode;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (id: string) => void;
  onMove: (dragged: string, target?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);
  const commit = () => {
    const next = name.trim();
    if (next) onRename(folder.__id, next);
    else setName(folder.name);
    setEditing(false);
  };
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        if (id && id !== folder.__id) onMove(id, folder.__id);
      }}
    >
      <div
        draggable={!editing}
        onDragStart={(event) => event.dataTransfer.setData('text/plain', folder.__id)}
        className="group flex min-h-9 items-center gap-1.5 border-b border-[var(--ledger-border-subtle)] px-1.5 text-sm hover:bg-[var(--ledger-surface-hover)]"
      >
        <button
          type="button"
          className="shrink-0 p-1 text-[var(--ledger-text-muted)]"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
        >
          {folder.children?.length ? (
            open ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : (
            <span className="block w-[13px]" />
          )}
        </button>
        <GripVertical size={14} className="shrink-0 cursor-grab text-[var(--ledger-text-muted)]" />
        <Folder size={14} className="shrink-0 text-[var(--ledger-accent)]" />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setName(folder.name);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent py-1 outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate py-1 text-left text-[var(--ledger-text-primary)]"
          >
            {folder.name}
          </button>
        )}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={`Actions for ${folder.name}`}
            onClick={() => setMenu(!menu)}
            className="rounded p-1 text-[var(--ledger-text-muted)] opacity-0 hover:bg-[var(--ledger-surface-muted)] group-hover:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <div className="absolute bottom-7 right-0 z-30 max-h-[min(220px,calc(100vh-96px))] w-40 overflow-y-auto border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                onClick={() => {
                  onAddChild(folder.__id);
                  setMenu(false);
                }}
              >
                <Plus size={13} />
                Add subfolder
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                onClick={() => {
                  setEditing(true);
                  setMenu(false);
                }}
              >
                <Pencil size={13} />
                Rename
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--ledger-danger)] hover:bg-[var(--ledger-surface-hover)]"
                onClick={() => {
                  onDelete(folder.__id);
                  setMenu(false);
                }}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {open && children}
    </div>
  );
}

export function FolderTemplateBuilderModal({
  template,
  onClose,
  onSave,
  busy = false,
}: {
  template: DriveFolderTemplate | 'new';
  onClose: () => void;
  onSave: (payload: {
    name: string;
    description: string;
    structure: { folders: DriveTemplateFolder[] };
  }) => Promise<void>;
  busy?: boolean;
}) {
  const initial = template === 'new' ? [] : normalizeFolders(template.structure?.folders);
  const [step, setStep] = useState<'start' | 'build'>('build');
  const [selectedStarter, setSelectedStarter] = useState(
    template === 'new' ? 'blank' : template.name
  );
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(template === 'new' ? '' : template.name);
  const [description, setDescription] = useState(
    template === 'new' ? '' : template.description || ''
  );
  const [folders, setFolders] = useState<InternalFolder[]>(foldersWithIds(initial));
  const valid = name.trim().length > 0 && folders.length > 0;
  const setTree = (next: InternalFolder[]) => setFolders(next);
  const updateName = (id: string, nextName: string) => {
    const walk = (nodes: InternalFolder[]): InternalFolder[] =>
      nodes.map((node) =>
        node.__id === id
          ? { ...node, name: nextName }
          : { ...node, children: walk((node.children || []) as InternalFolder[]) }
      );
    setTree(walk(folders));
  };
  const deleteNode = (id: string) => {
    const found = (() => {
      const walk = (nodes: InternalFolder[]): InternalFolder | undefined =>
        nodes.find((node) => node.__id === id) ||
        nodes.flatMap((node) => walk((node.children || []) as InternalFolder[]) || []).at(0);
      return walk(folders);
    })();
    const nested = countFolders((found?.children || []) as DriveTemplateFolder[]);
    if (
      nested &&
      !window.confirm(
        `Delete “${found?.name}”?\n\nIts ${nested} nested folder${
          nested === 1 ? '' : 's'
        } will also be removed from this template.\n\nThis only edits the template. It will not delete anything from Google Drive.`
      )
    )
      return;
    setTree(removeNode(folders, id).folders as InternalFolder[]);
  };
  const addFolder = (parentId?: string) => {
    const next = {
      __id: `folder-${Date.now()}`,
      name: 'New folder',
      children: [],
    } as InternalFolder;
    if (!parentId) setTree([...folders, next]);
    else setTree(addChild(folders, parentId, next) as InternalFolder[]);
  };
  const moveNode = (dragged: string, target?: string) => {
    const source = removeNode(folders, dragged);
    if (!source.removed || source.removed.__id === target || contains(source.removed, target || ''))
      return;
    setTree(
      target
        ? (addChild(source.folders, target, source.removed) as InternalFolder[])
        : ([...source.folders, source.removed] as InternalFolder[])
    );
  };
  const chooseStarter = (starter?: (typeof starterTemplates)[number]) => {
    setSelectedStarter(starter?.name || 'blank');
    if (starter) {
      setName(starter.name);
      setDescription(starter.description);
      setFolders(foldersWithIds(clone(starter.folders)));
    } else {
      setName('');
      setDescription('');
      setFolders([]);
    }
    setStep('build');
  };
  const save = async () => {
    if (!valid) return;
    await onSave({
      name: name.trim(),
      description: description.trim(),
      structure: { folders: stripIds(folders) },
    });
  };
  return (
    <ModalOverlay
      isOpen
      onClose={onClose}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContent="max-h-none overflow-hidden"
      classNameContainer="w-full max-w-4xl overflow-hidden rounded-[var(--ledger-surface-radius)] border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)]"
    >
      <div className="flex h-[min(760px,calc(100vh-48px))] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <p className="text-[11px] font-medium text-[var(--ledger-text-muted)]">
              {step === 'start'
                ? 'Folder templates'
                : template === 'new'
                ? 'Create template'
                : 'Edit template'}
            </p>
            <h2 className="mt-1 text-base font-semibold text-[var(--ledger-text-primary)]">
              {step === 'start'
                ? 'Choose a starting point'
                : template === 'new'
                ? 'Create template'
                : 'Edit template'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-3 sm:block">
            <p className="px-2 pb-2 text-xs font-semibold text-[var(--ledger-text-muted)]">
              Create template
            </p>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => chooseStarter()}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium ${
                  selectedStarter === 'blank'
                    ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm'
                    : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                }`}
              >
                <Plus size={14} className="text-[var(--ledger-accent)]" />
                Start blank
              </button>
              {Array.from(new Set(starterTemplates.map((starter) => starter.category))).map(
                (category) => (
                  <div key={category} className="mt-4 first:mt-0">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedCategories((current) => ({
                          ...current,
                          [category]: !current[category],
                        }))
                      }
                      className="flex w-full items-center gap-1.5 px-2 pb-1.5 text-left text-[11px] font-semibold text-[var(--ledger-text-muted)] hover:text-[var(--ledger-text-primary)]"
                    >
                      {collapsedCategories[category] ?? category !== 'Featured' ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                      {category}
                    </button>
                    <div
                      className={`overflow-hidden transition-all duration-200 ${
                        collapsedCategories[category] ?? category !== 'Featured'
                          ? 'max-h-0 opacity-0'
                          : 'max-h-[1200px] opacity-100'
                      }`}
                    >
                      {starterTemplates
                        .filter((starter) => starter.category === category)
                        .map((starter) => (
                          <button
                            key={starter.name}
                            type="button"
                            onClick={() => chooseStarter(starter)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium ${
                              selectedStarter === starter.name
                                ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm'
                                : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                            }`}
                          >
                            <Folder size={13} className="shrink-0 text-[var(--ledger-accent)]" />
                            <span className="truncate">{starter.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {step === 'start' ? (
              <p className="p-8 text-center text-xs text-[var(--ledger-text-muted)]">
                Choose a starting point from the left.
              </p>
            ) : (
              <>
                <label className="block text-xs font-medium text-[var(--ledger-text-secondary)]">
                  Template name
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Design project"
                    className="mt-1 h-10 w-full border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none focus:border-[var(--ledger-border-strong)]"
                  />
                </label>
                <label className="mt-3 block text-xs font-medium text-[var(--ledger-text-secondary)]">
                  Description{' '}
                  <span className="font-normal text-[var(--ledger-text-muted)]">(optional)</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-1 h-9 w-full border border-[var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none focus:border-[var(--ledger-border-strong)]"
                  />
                </label>
                <div className="mt-5 border border-[var(--ledger-border-subtle)]">
                  <div className="flex items-center justify-between border-b border-[var(--ledger-border-subtle)] px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">Folder structure</p>
                      <p className="mt-0.5 text-[11px] text-[var(--ledger-text-muted)]">
                        Drag onto a folder to nest it. Double-click a name to rename.
                      </p>
                    </div>
                    <span className="text-[11px] text-[var(--ledger-text-muted)]">
                      {countFolders(folders)} folders
                    </span>
                  </div>
                  <div className="p-2">
                    {folders.length ? (
                      <FolderTree
                        folders={folders}
                        onRename={updateName}
                        onDelete={deleteNode}
                        onAddChild={addFolder}
                        onMove={moveNode}
                      />
                    ) : (
                      <p className="px-2 py-8 text-center text-xs text-[var(--ledger-text-muted)]">
                        No folders yet.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => addFolder()}
                      className="mt-2 inline-flex items-center gap-1.5 px-2 py-2 text-xs font-medium text-[var(--ledger-accent)] hover:bg-[var(--ledger-surface-hover)]"
                    >
                      <Plus size={14} />
                      Add folder
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ledger-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
          >
            Cancel
          </button>
          {step === 'build' && (
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void save()}
              className="rounded bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save template'}
            </button>
          )}
        </footer>
      </div>
    </ModalOverlay>
  );
}

export function TemplateCard({
  template,
  onEdit,
  onDuplicate,
  onApply,
  onDelete,
}: {
  template: DriveFolderTemplate;
  onEdit: () => void;
  onDuplicate: () => void;
  onApply: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const folders = normalizeFolders(template.structure?.folders);
  return (
    <article className="relative flex min-h-52 flex-col border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 transition hover:border-[var(--ledger-border-strong)]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{template.name}</h3>
          {template.description && (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--ledger-text-muted)]">
              {template.description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Actions for ${template.name}`}
          onClick={() => setMenu(!menu)}
          className="rounded p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
        >
          <MoreHorizontal size={15} />
        </button>
        {menu && (
          <div className="absolute right-3 top-10 z-20 w-40 border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
            <button
              type="button"
              onClick={() => {
                onEdit();
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
            >
              <Pencil size={13} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                onDuplicate();
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
            >
              <Copy size={13} />
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => {
                onApply();
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
            >
              <Folder size={13} />
              Apply to project
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete();
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--ledger-danger)] hover:bg-[var(--ledger-surface-hover)]"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 min-h-24 space-y-1 border-t border-[var(--ledger-border-subtle)] pt-3 text-xs text-[var(--ledger-text-secondary)]">
        {folders.slice(0, 6).map((folder) => (
          <p key={folder.name} className="truncate">
            <Folder size={12} className="mr-1.5 inline text-[var(--ledger-accent)]" />
            {folder.name}
          </p>
        ))}
        {folders.length > 6 && (
          <p className="text-[11px] text-[var(--ledger-text-muted)]">+ {folders.length - 6} more</p>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-[var(--ledger-text-muted)]">
        <span>{countFolders(folders)} folders</span>
        <button
          type="button"
          onClick={onApply}
          className="font-medium text-[var(--ledger-accent)] hover:underline"
        >
          Use template
        </button>
      </div>
    </article>
  );
}

export function StarterTemplateCard({
  starter,
  onUse,
}: {
  starter: StarterTemplate;
  onUse: () => void;
}) {
  const visibleFolders = starter.folders.slice(0, 4);
  return (
    <button
      type="button"
      onClick={onUse}
      className="flex min-h-36 flex-col border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3 text-left transition hover:border-[var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)]"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Folder size={14} className="text-[var(--ledger-accent)]" />
        {starter.name}
      </span>
      <span className="mt-3 space-y-1 text-xs text-[var(--ledger-text-secondary)]">
        {visibleFolders.map((folder) => (
          <span key={folder.name} className="block truncate">
            {folder.name}
          </span>
        ))}
        {starter.folders.length > 4 && (
          <span className="block text-[11px] text-[var(--ledger-text-muted)]">
            + {starter.folders.length - 4} more
          </span>
        )}
      </span>
      <span className="mt-auto pt-3 text-[11px] font-medium text-[var(--ledger-accent)]">
        Use template
      </span>
    </button>
  );
}
