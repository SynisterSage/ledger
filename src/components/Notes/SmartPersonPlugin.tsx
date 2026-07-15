import { createPortal } from 'react-dom';
import { ArrowRight, CircleX, Folder, Link2, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalTextEntity } from '@lexical/react/useLexicalTextEntity';
import { $createTextNode, $getNodeByKey, $getRoot, type Klass, type NodeKey, TextNode } from 'lexical';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { $createSmartPersonNode, $isSmartPersonNode, SmartPersonNode, type SmartPersonNodeState } from './nodes/SmartPersonNode';
import { SmartDateNode } from './nodes/SmartDateNode';

type PersonIndexEntry = {
  id: string;
  name: string;
  role?: string | null;
  teams?: Array<{ name?: string | null }>;
  shared_project_count?: number;
};

type PersonLinkRow = {
  person_user_id: string;
  source_key: string;
  source_text: string;
};

type PersonTarget = PersonIndexEntry & {
  sourceKey: string;
  sourceText: string;
  state: SmartPersonNodeState;
};

const SCAN_TAG = 'smart-person-scan';
const LOAD_TAG = 'smart-person-load';
const commonWordNames = new Set(['may', 'will', 'mark', 'grant', 'rose', 'joy', 'art', 'bill', 'hope', 'faith', 'summer', 'winter']);

const sourceKeyFor = (sourceText: string) =>
  `person:${sourceText.trim().toLowerCase()}`;

const isEligibleTextNode = (node: TextNode) => {
  if (!node.isSimpleText() || node.hasFormat('code')) return false;
  if ($isSmartPersonNode(node) || node instanceof SmartDateNode) return false;
  let parent = node.getParent();
  while (parent) {
    if (parent instanceof LinkNode || parent instanceof CodeNode || $isSmartPersonNode(parent) || parent instanceof SmartDateNode) return false;
    parent = parent.getParent();
  }
  return true;
};

const getPersonElement = (event: Event) => {
  const target = event.target as Node | null;
  if (target instanceof Element) return target.closest('[data-ledger-smart-person-key]') as HTMLElement | null;
  return target?.parentElement?.closest('[data-ledger-smart-person-key]') as HTMLElement | null;
};

const findPersonMatch = (text: string, people: PersonIndexEntry[]) => {
  const candidates = new Map<string, PersonIndexEntry>();
  for (const person of people) {
    const fullName = person.name.trim();
    if (!fullName) continue;
    candidates.set(fullName.toLowerCase(), person);
    const firstName = fullName.split(/\s+/)[0] ?? '';
    if (firstName && !commonWordNames.has(firstName.toLowerCase())) {
      const existing = candidates.get(firstName.toLowerCase());
      if (!existing) candidates.set(firstName.toLowerCase(), person);
      else if (existing.id !== person.id) candidates.delete(firstName.toLowerCase());
    }
  }

  const sorted = [...candidates.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [name, person] of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'iu').exec(text);
    if (!match || match.index === undefined) continue;
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    const before = text.slice(Math.max(0, start - 2), start);
    if (before.includes('@')) continue;
    const prefix = text.slice(Math.max(0, start - 40), start).toLowerCase();
    if (/https?:\/\/\S*$/.test(prefix) || /www\.\S*$/.test(prefix)) continue;
    return { person, start, end, text: match[2] };
  }
  return null;
};

const PersonPopover = ({
  target,
  onClose,
  onOpenCircle,
  onAssignTask,
  onFollowUp,
  onSharedProjects,
  onLink,
  onDismiss,
}: {
  target: PersonTarget;
  onClose: () => void;
  onOpenCircle: () => void;
  onAssignTask: () => void;
  onFollowUp: () => void;
  onSharedProjects: () => void;
  onLink: () => void;
  onDismiss: () => void;
}) => {
  const [position, setPosition] = useState({ top: 12, left: 12 });
  useEffect(() => {
    const update = () => {
      const element = document.querySelector<HTMLElement>(`[data-ledger-smart-person-key="${target.sourceKey}"]`);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const width = 248;
      const height = 260;
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8);
      setPosition({ top, left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target.sourceKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-label={`Person detected: ${target.sourceText}`}
      data-ledger-smart-person-popover="true"
      className="fixed z-[9999] w-[248px] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
      style={{ top: position.top, left: position.left }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{target.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
            {[target.role, target.teams?.[0]?.name].filter(Boolean).join(' · ') || 'Workspace member'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]">
          <CircleX size={13} />
        </button>
      </div>
      <div className="space-y-0.5 border-y border-[color:var(--ledger-border-subtle)] py-1">
        <button type="button" onClick={onOpenCircle} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><UserRound size={13} className="text-[var(--ledger-accent)]" />Open in Circle</button>
        <button type="button" onClick={onAssignTask} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><ArrowRight size={13} />Assign task</button>
        <button type="button" onClick={onFollowUp} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><ArrowRight size={13} />Create follow-up</button>
        <button type="button" onClick={onSharedProjects} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><Folder size={13} />View shared projects</button>
        <button type="button" onClick={onLink} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"><Link2 size={13} />Link person to note</button>
      </div>
      <button type="button" onClick={onDismiss} className="mt-1 flex min-h-7 w-full items-center rounded-md px-2 text-left text-[11px] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]">Dismiss suggestion</button>
    </div>,
    document.body
  );
};

export function SmartPersonPlugin({ noteId, noteTitle, noteProjectId }: { noteId?: string | null; noteTitle?: string | null; noteProjectId?: string | null }) {
  const [editor] = useLexicalComposerContext();
  const api = useApi();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [people, setPeople] = useState<PersonIndexEntry[]>([]);
  const [links, setLinks] = useState<PersonLinkRow[]>([]);
  const [target, setTarget] = useState<PersonTarget | null>(null);
  const dismissedKeysRef = useRef(new Set<string>());
  const scanRequestedRef = useRef(false);
  const pendingKeysRef = useRef(new Set<NodeKey>());
  const scanTimerRef = useRef<number | null>(null);
  const peopleLoadedRef = useRef(false);

  const linksByKey = useMemo(() => new Map(links.map((link) => [link.source_key, link])), [links]);
  const refreshLinks = useCallback(async () => {
    if (!noteId) return setLinks([]);
    try {
      const payload = (await api.getNotePersonLinks(noteId)) as { links?: PersonLinkRow[] };
      setLinks(Array.isArray(payload?.links) ? payload.links : []);
    } catch (error) {
      console.error('[smart-person] failed to load note person links', error);
      setLinks([]);
    }
  }, [api, noteId]);

  useEffect(() => {
    let cancelled = false;
    const loadPeople = async () => {
      peopleLoadedRef.current = false;
      if (!activeWorkspaceId) {
        peopleLoadedRef.current = true;
        return setPeople([]);
      }
      try {
        const payload = (await api.getPeople()) as { people?: PersonIndexEntry[] };
        if (!cancelled) {
          setPeople(Array.isArray(payload?.people) ? payload.people : []);
          peopleLoadedRef.current = true;
        }
      } catch (error) {
        console.error('[smart-person] failed to load workspace people', error);
        if (!cancelled) {
          setPeople([]);
          peopleLoadedRef.current = true;
        }
      }
    };
    void loadPeople();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, api]);

  useEffect(() => { void refreshLinks(); }, [activeWorkspaceId, noteId, refreshLinks]);

  useEffect(() => {
    editor.update(() => {
      const visit = (node: any) => {
        if ($isSmartPersonNode(node)) {
          const resolvedPerson =
            people.find((person) => person.id === node.getPersonUserId()) ??
            findPersonMatch(node.getTextContent(), people)?.person;
          if (resolvedPerson && !node.getPersonUserId()) node.setPersonUserId(resolvedPerson.id);
          if (peopleLoadedRef.current && !resolvedPerson) {
            const replacement = $createTextNode(node.getTextContent());
            replacement.setFormat(node.getFormat());
            replacement.setStyle(node.getStyle());
            node.replace(replacement);
            return;
          }
          const nextState: SmartPersonNodeState = linksByKey.has(node.getSourceKey()) ? 'linked' : 'detected';
          if (node.getSmartPersonState() !== nextState) node.setSmartPersonState(nextState);
          return;
        }
        node?.getChildren?.().forEach(visit);
      };
      visit($getRoot());
    }, { tag: 'smart-person-sync' });
  }, [editor, linksByKey, people]);

  const getTargetFromElement = useCallback((element: HTMLElement | null): PersonTarget | null => {
    if (!element) return null;
    const sourceKey = element.getAttribute('data-ledger-smart-person-key') ?? '';
    const personId = element.getAttribute('data-ledger-smart-person-user-id') ?? '';
    const sourceText = element.textContent?.trim() ?? '';
    const person =
      people.find((entry) => entry.id === personId) ??
      findPersonMatch(sourceText, people)?.person;
    if (!sourceKey || !person || dismissedKeysRef.current.has(sourceKey)) return null;
    return { ...person, sourceKey, sourceText, state: linksByKey.has(sourceKey) ? 'linked' : 'detected' };
  }, [linksByKey, people]);

  const openCircle = useCallback((person: PersonTarget, tab?: 'projects') => {
    void window.desktopWindow?.toggleModule('circle' as any, {
      kind: 'circle' as any,
      focusContext: `ledger-person|${person.id}|${encodeURIComponent(person.name)}${tab ? '|projects' : ''}`,
    } as any);
    setTarget(null);
  }, []);

  const openQuickCapture = useCallback((person: PersonTarget, kind: 'quick-task' | 'quick-follow-up') => {
    const title = encodeURIComponent(noteTitle?.trim() ? `${noteTitle.trim()} · ${person.name}` : person.name);
    const project = encodeURIComponent(noteProjectId ?? '');
    void window.desktopWindow?.toggleModule(kind as any, {
      kind: kind as any,
      focusContext: `ledger-person|${person.id}|${encodeURIComponent(person.name)}|${encodeURIComponent(noteId ?? '')}|${project}|${title}`,
    } as any);
    setTarget(null);
  }, [noteId, noteProjectId, noteTitle]);

  const linkPerson = useCallback(async () => {
    if (!target || !noteId) return;
    try {
      await api.upsertNotePersonLink(noteId, { person_user_id: target.id, source_key: target.sourceKey, source_text: target.sourceText });
      await refreshLinks();
      setTarget(null);
    } catch (error) {
      console.error('[smart-person] failed to link person', error);
      toast.show('Could not create person link.', { variant: 'error' });
    }
  }, [api, noteId, refreshLinks, target, toast]);

  const getMatch = useCallback((text: string) => {
    if (!scanRequestedRef.current || !noteId) return null;
    const match = findPersonMatch(text, people);
    return match ? { start: match.start, end: match.end } : null;
  }, [noteId, people]);

  const createNode = useCallback((textNode: TextNode) => {
    const match = findPersonMatch(textNode.getTextContent(), people);
    if (!match) return textNode;
    const sourceKey = sourceKeyFor(match.text);
    const node = $createSmartPersonNode(textNode.getTextContent(), match.person.id, sourceKey, linksByKey.has(sourceKey) ? 'linked' : 'detected');
    node.setFormat(textNode.getFormat());
    node.setStyle(textNode.getStyle());
    node.setDetail(textNode.getDetail());
    node.setMode(textNode.getMode());
    return node;
  }, [linksByKey, people]);

  useLexicalTextEntity(getMatch, SmartPersonNode as unknown as Klass<TextNode>, createNode as unknown as (node: TextNode) => TextNode);

  const queueScan = useCallback((keys: Set<NodeKey>) => {
    keys.forEach((key) => pendingKeysRef.current.add(key));
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = window.setTimeout(() => {
      const keysToScan = new Set(pendingKeysRef.current);
      pendingKeysRef.current.clear();
      editor.update(() => {
        scanRequestedRef.current = true;
        keysToScan.forEach((key) => {
          const node = $getNodeByKey(key);
          const visit = (current: any) => {
            if (!current) return;
            if (current instanceof TextNode) {
              if (isEligibleTextNode(current)) current.markDirty();
              return;
            }
            current.getChildren?.().forEach(visit);
          };
          visit(node);
        });
      }, { tag: SCAN_TAG });
      scanRequestedRef.current = false;
    }, 220);
  }, [editor]);

  useEffect(() => editor.registerUpdateListener(({ editorState, dirtyLeaves, dirtyElements, tags }) => {
    if (!noteId || editor.isComposing()) return;
    if (tags.has(SCAN_TAG) || tags.has('smart-person-sync')) return;
    const keys = new Set<NodeKey>();
    editorState.read(() => {
      if (tags.has(LOAD_TAG)) {
        const visit = (node: any) => {
          if (node instanceof TextNode && isEligibleTextNode(node)) keys.add(node.getKey());
          node.getChildren?.().forEach(visit);
        };
        visit($getRoot());
        return;
      }
      [...dirtyLeaves, ...dirtyElements.keys()].forEach((key) => {
        const node = $getNodeByKey(key);
        if (node instanceof TextNode && isEligibleTextNode(node)) keys.add(node.getKey());
        else if ((node as any)?.getChildren && node) keys.add(node.getKey());
      });
    });
    if (keys.size) queueScan(keys);
  }), [editor, noteId, queueScan]);

  useEffect(() => {
    if (!noteId) return;
    const timer = window.setTimeout(() => queueScan(new Set([editor.getEditorState().read(() => $getRoot().getKey())])), 100);
    return () => window.clearTimeout(timer);
  }, [editor, noteId, people, queueScan]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = getPersonElement(event);
      if (!element) return;
      const next = getTargetFromElement(element);
      if (!next) return;
      event.preventDefault();
      setTarget(next);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const element = getPersonElement(event);
      const next = getTargetFromElement(element);
      if (!next) return;
      event.preventDefault();
      setTarget(next);
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      const element = event.target as HTMLElement | null;
      if (element?.closest('[data-ledger-smart-person-key], [data-ledger-smart-person-popover]')) return;
      setTarget(null);
    };
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [editor, getTargetFromElement]);

  if (!target) return null;
  return (
    <PersonPopover
      target={target}
      onClose={() => setTarget(null)}
      onOpenCircle={() => openCircle(target)}
      onAssignTask={() => openQuickCapture(target, 'quick-task')}
      onFollowUp={() => openQuickCapture(target, 'quick-follow-up')}
      onSharedProjects={() => openCircle(target, 'projects')}
      onLink={() => void linkPerson()}
      onDismiss={() => { dismissedKeysRef.current.add(target.sourceKey); setTarget(null); }}
    />
  );
}
