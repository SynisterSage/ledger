import {
  Bell,
  CalendarDays,
  CheckSquare,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  Link2,
  Loader2,
  Milestone,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import {
  routeForCalendarEvent,
  routeForCalendarReminder,
  routeForInboxItem,
  routeForNote,
  routeForProject,
  routeForTask,
  usePlatform,
} from '../../platform';
import type {
  RelatedContextItem,
  RelatedContextResourceType,
  RelatedContextResponse,
} from '../../types/relatedContext';

type RelatedContextListProps = {
  workspaceId: string | null | undefined;
  resourceType: RelatedContextResourceType;
  resourceId: string | null | undefined;
  title?: string;
  emptyMessage?: string;
  maxItems?: number;
  targetTypes?: RelatedContextResourceType[];
  showEmpty?: boolean;
  className?: string;
  refreshKey?: string | number;
};

const typeLabels: Record<string, string> = {
  note: 'Note',
  project: 'Project',
  task: 'Task',
  event: 'Event',
  reminder: 'Reminder',
  intake: 'Intake',
  milestone: 'Milestone',
  external_reference: 'Linked resource',
};

const relationshipLabels: Record<string, string> = {
  belongs_to: 'Project',
  contains: 'Project',
  related_to: 'Related',
  created_from: 'Created from',
  converted_from: 'Converted from',
  captured_from: 'Captured from',
  references: 'Linked resource',
  supports: 'Supports',
};

const iconForType = (type: string) => {
  switch (type) {
    case 'project': return FolderKanban;
    case 'task': return CheckSquare;
    case 'event': return CalendarDays;
    case 'reminder': return Bell;
    case 'intake': return Inbox;
    case 'milestone': return Milestone;
    case 'external_reference': return ExternalLink;
    default: return FileText;
  }
};

const routeForRelatedTarget = (workspaceId: string, item: RelatedContextItem) => {
    const target = item.target;
    switch (target.type) {
    case 'note': return routeForNote(workspaceId, target.id);
    case 'project': return routeForProject(workspaceId, target.id);
    case 'task': return routeForTask(workspaceId, target.id);
    case 'event': return routeForCalendarEvent(workspaceId, target.id);
    case 'reminder': return routeForCalendarReminder(workspaceId, target.id);
    case 'intake': return routeForInboxItem(workspaceId, target.id);
    default: return null;
  }
};

const formatProvider = (provider: unknown) => {
  const value = String(provider ?? '').trim();
  if (!value) return '';
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
};

export function RelatedContextList({
  workspaceId,
  resourceType,
  resourceId,
  title = 'Related context',
  emptyMessage = 'Nothing related yet.',
  maxItems = 8,
  targetTypes,
  showEmpty = true,
  className = '',
  refreshKey = 0,
}: RelatedContextListProps) {
  const api = useApi();
  const platform = usePlatform();
  const [response, setResponse] = useState<RelatedContextResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !resourceId) {
      setResponse(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = (await api.getRelatedContext(resourceType, resourceId)) as RelatedContextResponse;
      setResponse(payload);
    } catch (loadError) {
      setResponse(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load related context.');
    } finally {
      setIsLoading(false);
    }
  }, [api, refreshKey, resourceId, resourceType, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    const allowedTypes = targetTypes?.length ? new Set(targetTypes) : null;
    const uniqueItems = new Map<string, RelatedContextItem>();
    for (const item of response?.items ?? []) {
      if (allowedTypes && !allowedTypes.has(item.target.type)) continue;
      if (item.target.type === 'external_reference') {
        const title = String(item.target.title ?? '').trim().toLowerCase();
        if (!title || ['unknown', 'untitled', 'external resource', 'file', 'node'].includes(title)) continue;
      }
      const key = `${item.target.type}:${item.target.id}`;
      if (!uniqueItems.has(key)) uniqueItems.set(key, item);
    }
    return Array.from(uniqueItems.values()).slice(0, maxItems);
  }, [maxItems, response?.items, targetTypes]);

  const openItem = (item: RelatedContextItem) => {
    if (item.target.type === 'external_reference') {
      if (item.target.url) void platform.externalLinks.open(item.target.url, { newTab: true });
      return;
    }
    if (!workspaceId) return;
    const route = routeForRelatedTarget(workspaceId, item);
    if (route) platform.navigation.openRoute(route);
  };

  if (!resourceId || (!showEmpty && !isLoading && !error && items.length === 0)) return null;

  return (
    <section className={`space-y-2 ${className}`} aria-label={title}>
      <div className="flex items-center gap-2">
        <Link2 size={13} className="text-[var(--ledger-text-muted)]" />
        <p className="text-xs font-semibold text-[var(--ledger-text-primary)]">{title}</p>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-[var(--ledger-text-muted)]">
          <Loader2 size={12} className="animate-spin" /> Loading context…
        </div>
      ) : error ? (
        <p className="rounded-md bg-[color:rgba(217,45,32,0.06)] px-2.5 py-2 text-xs text-[var(--ledger-danger)]">{error}</p>
      ) : items.length === 0 ? (
        <p className="py-1 text-xs text-[var(--ledger-text-muted)]">{emptyMessage}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => {
            const Icon = iconForType(item.target.type);
            const provider = formatProvider(item.target.provider ?? item.provenance?.source_type);
            const label = relationshipLabels[item.relationship] ?? typeLabels[item.target.type] ?? 'Related';
            return (
              <button
                key={`${item.relationship}:${item.direction}:${item.target.type}:${item.target.id}`}
                type="button"
                onClick={() => openItem(item)}
                disabled={item.target.type === 'external_reference' && !item.target.url}
                className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-default disabled:opacity-70"
                title={item.provenance?.source_label ?? item.target.title}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)]">
                  <Icon size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">{item.target.title}</span>
                  <span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">
                    {label}{provider ? ` · ${provider}` : ''}
                  </span>
                </span>
                {item.target.type === 'external_reference' ? <ExternalLink size={12} className="shrink-0 text-[var(--ledger-text-muted)]" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
