import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  FileImage,
  Link2,
  Loader2,
  MoreHorizontal,
  Search,
  X,
  LockKeyhole,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import type { ExternalEmbedTargetType } from './ExternalEmbedNode';
import { GithubResourcePicker, type GithubResourcePickerResult } from './GithubResourcePicker';

export type LinkedDesignTarget = {
  workspaceId: string;
  targetType: ExternalEmbedTargetType;
  targetId: string;
};
type Reference = {
  id: string;
  provider?: string;
  external_url?: string;
  normalized_url?: string;
  external_type?: string;
  metadata?: Record<string, unknown>;
  access_status?: string;
};
type Link = {
  id: string;
  external_reference_id: string;
  sources?: string[];
  link_metadata?: Record<string, unknown>;
  external_references?: Reference | Reference[];
};
type Preview = { url?: string | null; capturedAt?: string | null };

const openExternal = (url: string) =>
  window.desktopWindow?.openExternal
    ? void window.desktopWindow.openExternal(url)
    : window.open(url, '_blank', 'noopener,noreferrer');
const formatDate = (value?: string | null) =>
  value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null;
const resourceLabel = (reference: Reference) => {
  const value = String(reference.metadata?.pageName ?? '').trim();
  return value;
};
const referenceTitle = (reference: Reference, fallbackTitle?: string | null) =>
  String(
    reference.metadata?.nodeName ?? reference.metadata?.fileName ?? fallbackTitle ?? 'Figma design'
  );
const referenceFileName = (reference: Reference, fallbackFileName?: string | null) =>
  String(reference.metadata?.fileName ?? fallbackFileName ?? '').trim();
const isGithub = (reference?: Reference) => reference?.provider === 'github';
const githubTitle = (reference: Reference) =>
  String(
    reference.metadata?.title ??
      (reference.external_type === 'repository'
        ? reference.metadata?.fullName
        : reference.external_type === 'pullRequest'
        ? `PR #${reference.metadata?.number ?? ''}`
        : `Issue #${reference.metadata?.number ?? ''}`)
  );

export function LinkedDesignsSection({
  target,
  canEdit = true,
  canInsert = false,
  onInsert,
  fallbackNodeName,
  fallbackFileName,
}: {
  target: LinkedDesignTarget;
  canEdit?: boolean;
  canInsert?: boolean;
  onInsert?: (reference: { id: string; url: string }) => void;
  fallbackNodeName?: string | null;
  fallbackFileName?: string | null;
}) {
  const api = useApi();
  const toast = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview | null>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'paste' | 'existing'>('paste');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [existing, setExisting] = useState<Reference[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<
    { target_type: string; target_id: string; title: string }[] | null
  >(null);
  const [menuLink, setMenuLink] = useState<Link | null>(null);
  const [consentReference, setConsentReference] = useState<Reference | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerId, setProjectPickerId] = useState('');
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [provider, setProvider] = useState<'figma' | 'github'>('figma');
  const [githubRepositories, setGithubRepositories] = useState<
    Array<{ github_repository_id: string; full_name: string; owner_login: string; name: string }>
  >([]);
  const [githubRepositoryId, setGithubRepositoryId] = useState('');
  const [githubType, setGithubType] = useState<'issue' | 'pull_request'>('issue');

  const load = async () => {
    setLoading(true);
    try {
      const rows = (await api.getExternalReferencesForTarget(
        target.targetType,
        target.targetId
      )) as Link[];
      const hydrated = await Promise.all(
        rows.map(async (link) => {
          let current = link;
          let reference = (
            Array.isArray(link.external_references)
              ? link.external_references[0]
              : link.external_references
          ) as Reference | undefined;
          if (
            (reference?.provider === 'figma' &&
              !reference.metadata?.nodeName &&
              !reference.metadata?.fileName) ||
            (reference?.provider === 'github' && reference.access_status === 'unresolved')
          ) {
            try {
              const resolved = (await api.resolveExternalReference(
                link.external_reference_id
              )) as Reference;
              current = { ...link, external_references: resolved };
              reference = resolved;
            } catch {
              /* Keep metadata-limited references visible. */
            }
          }
          let preview: Preview | null = null;
          try {
            preview =
              (
                (await api.getExternalReferencePreview(
                  link.external_reference_id,
                  target.targetType,
                  target.targetId
                )) as { preview?: Preview | null }
              ).preview ?? null;
          } catch {
            /* Preview may be unavailable. */
          }
          if (!preview?.url && reference?.provider === 'figma') {
            try {
              const capture = (await api.createExternalReferencePreview(
                link.external_reference_id,
                target.targetType,
                target.targetId
              )) as { preview?: Preview | null; consentRequired?: boolean };
              preview = capture.preview ?? null;
              if (capture.consentRequired && canEdit) setConsentReference(reference);
            } catch {
              /* Consent or connection may still be required. */
            }
          }
          return { link: current, preview };
        })
      );
      setLinks(hydrated.map((entry) => entry.link));
      setPreviews(
        Object.fromEntries(
          hydrated.map((entry) => [entry.link.external_reference_id, entry.preview])
        )
      );
    } catch {
      toast.show('Could not load linked references.', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [target.targetId, target.targetType]);
  useEffect(() => {
    if (mode !== 'existing' || provider !== 'figma') return;
    const timer = window.setTimeout(() => {
      void api
        .searchExternalReferences(query)
        .then((rows) => setExisting(Array.isArray(rows) ? (rows as Reference[]) : []))
        .catch(() => setExisting([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, mode, query]);
  useEffect(() => {
    if (!dialogOpen || provider !== 'github') return;
    void api
      .getGithubRepositories()
      .then((rows) =>
        setGithubRepositories(Array.isArray(rows) ? (rows as typeof githubRepositories) : [])
      )
      .catch(() => setGithubRepositories([]));
  }, [api, dialogOpen, provider]);
  useEffect(() => {
    if (
      !dialogOpen ||
      provider !== 'github' ||
      mode !== 'existing' ||
      !githubRepositoryId ||
      query.trim().length < 2
    ) {
      if (provider === 'github') setExisting([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .searchGithubWork({
          repositoryId: githubRepositoryId,
          type: githubType,
          query: query.trim(),
          limit: 20,
        })
        .then((items) =>
          setExisting(
            (Array.isArray(items) ? items : []).map((item: any) => ({
              id: `github-search-${item.githubId}`,
              provider: 'github',
              external_type: item.resourceKind,
              normalized_url: item.canonicalUrl,
              external_url: item.canonicalUrl,
              metadata: {
                ...item,
                githubRepositoryId: item.githubRepositoryId,
                title: item.title,
                number: item.number,
                repositoryFullName: item.repositoryFullName,
                state: item.state,
              },
              access_status: 'accessible',
            }))
          )
        )
        .catch(() => setExisting([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, dialogOpen, githubRepositoryId, githubType, mode, provider, query]);
  useEffect(() => {
    if (!menuLink) return;
    const close = () => setMenuLink(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuLink]);

  const linkReference = async (reference: Reference) => {
    if (!canEdit) return;
    let referenceToLink = reference;
    setBusyId(reference.id);
    try {
      if (reference.provider === 'github' && reference.id.startsWith('github-search-'))
        referenceToLink = (await api.createExternalReference(
          'github',
          reference.normalized_url || reference.external_url || ''
        )) as Reference;
      if (links.some((link) => link.external_reference_id === referenceToLink.id)) {
        toast.show('Already linked', { variant: 'info' });
        setDialogOpen(false);
        return;
      }
      if (referenceToLink.provider === 'github') {
        await api.resolveExternalReference(referenceToLink.id);
      }
      await api.linkExternalReferenceWithMetadata(
        referenceToLink.id,
        target.targetType,
        target.targetId,
        referenceToLink.provider === 'github' && referenceToLink.external_type === 'repository'
          ? { role: 'primary' }
          : undefined,
        'manual'
      );
      if (referenceToLink.provider === 'figma') {
        const privacy = (await api.getFigmaPrivacySettings()) as {
          preview_sharing_accepted?: boolean;
        };
        if (!privacy.preview_sharing_accepted) setConsentReference(referenceToLink);
        else {
          try {
            await api.createExternalReferencePreview(
              referenceToLink.id,
              target.targetType,
              target.targetId
            );
          } catch {
            /* connection-required links remain visible */
          }
        }
      }
      setDialogOpen(false);
      setUrl('');
      setQuery('');
      await load();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not link this reference.', {
        variant: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };
  const pasteLink = async () => {
    if (!url.trim()) return;
    setBusyId('paste');
    try {
      const reference = (await api.createExternalReference(provider, url.trim())) as Reference;
      await linkReference(reference);
    } catch (error) {
      toast.show(
        error instanceof Error
          ? error.message
          : `That is not a supported ${provider === 'github' ? 'GitHub' : 'Figma'} link.`,
        { variant: 'error' }
      );
    } finally {
      setBusyId(null);
    }
  };
  const linkApprovedRepository = async (repository: (typeof githubRepositories)[number]) => {
    if (target.targetType !== 'project') return;
    setBusyId(repository.github_repository_id);
    try {
      const existingRepositoryLinks = links.filter((link) => {
        const reference = (Array.isArray(link.external_references) ? link.external_references[0] : link.external_references) as Reference | undefined;
        return isGithub(reference) && reference?.external_type === 'repository';
      });
      await api.linkProjectGithubRepository(target.targetId, repository.github_repository_id, existingRepositoryLinks.length ? 'supporting' : 'primary');
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not link this repository.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const createGithubTask = async (link: Link, reference: Reference) => {
    if (!canEdit || target.targetType === 'task') return;
    setBusyId(link.id);
    try {
      const existingTasks = (await api.getGithubReferenceTasks(reference.id)) as Array<{ id: string; title?: string }>;
      let allowDuplicate = false;
      if (existingTasks.length) {
        allowDuplicate = window.confirm(`A Ledger task already tracks this GitHub item${existingTasks[0]?.title ? `: ${existingTasks[0].title}` : ''}. Create another task?`);
        if (!allowDuplicate) return;
      }
      await api.createTaskFromGithubReference(reference.id, { project_id: target.targetType === 'project' ? target.targetId : null, allow_duplicate: allowDuplicate });
      toast.show('Ledger task created.', { variant: 'success' });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not create a Ledger task.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const openProjectPicker = async () => {
    setProjectPickerOpen(true);
    try {
      const projects = await api.getProjects({ includeCompleted: false });
      setProjectOptions(Array.isArray(projects) ? projects.map((project: any) => ({ id: String(project.id), name: String(project.name ?? 'Project') })) : []);
    } catch {
      setProjectOptions([]);
    }
  };
  const attachGithubToProject = async () => {
    if (!projectPickerId || target.targetType !== 'intake') return;
    setBusyId('attach-project');
    try {
      await api.attachGithubIntakeToProject(target.targetId, projectPickerId);
      toast.show('GitHub work attached to project.', { variant: 'success' });
      setProjectPickerOpen(false);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not attach GitHub work to project.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const selectGithubResource = async (resource: GithubResourcePickerResult) => {
    if (!canEdit || !resource.canonicalUrl) return;
    const existingGithubRepositories = links.filter((link) => {
      const reference = (Array.isArray(link.external_references) ? link.external_references[0] : link.external_references) as Reference | undefined;
      return isGithub(reference) && reference?.external_type === 'repository';
    });
    if (resource.resourceType === 'repository' && target.targetType === 'project' && resource.githubRepositoryId) {
      await api.linkProjectGithubRepository(target.targetId, String(resource.githubRepositoryId), existingGithubRepositories.length ? 'supporting' : 'primary');
      await load();
      return;
    }
    let reference = resource.referenceId ? ({ id: resource.referenceId, provider: 'github', external_type: resource.resourceType === 'pull_request' ? 'pullRequest' : resource.resourceType, normalized_url: resource.canonicalUrl, external_url: resource.canonicalUrl, metadata: resource } as Reference) : null;
    if (!reference) reference = await api.createExternalReference('github', resource.canonicalUrl) as Reference;
    if (reference.provider === 'github') reference = await api.resolveExternalReference(reference.id) as Reference;
    await api.linkExternalReferenceWithMetadata(reference.id, target.targetType, target.targetId, undefined, 'manual');
    await load();
  };
  const unlink = async (link: Link) => {
    if (!canEdit) return;
    const reference = (Array.isArray(link.external_references) ? link.external_references[0] : link.external_references) as Reference | undefined;
    if (!window.confirm(`Unlink this ${isGithub(reference) ? 'GitHub reference' : 'Figma design'} from this item?`)) return;
    setBusyId(link.id);
    try {
      await api.unlinkExternalReference(link.external_reference_id, link.id, 'manual');
      await load();
    } catch {
      toast.show('Could not unlink this reference.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const refresh = async (link: Link) => {
    if (!canEdit) return;
    setBusyId(link.id);
    try {
      const reference = (Array.isArray(link.external_references)
        ? link.external_references[0]
        : link.external_references) as Reference | undefined;
      if (isGithub(reference)) {
        await api.resolveExternalReference(link.external_reference_id);
        await load();
        return;
      }
      const result = (await api.refreshExternalReferencePreview(
        link.external_reference_id,
        target.targetType,
        target.targetId
      )) as { preview?: Preview | null; error?: string };
      if (result.preview)
        setPreviews((current) => ({
          ...current,
          [link.external_reference_id]: result.preview ?? null,
        }));
      if (result.error) toast.show(result.error, { variant: 'error' });
    } catch {
      toast.show('Ledger couldn’t refresh this Figma preview.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const showLocations = async (referenceId: string) => {
    try {
      setLocations(
        (await api.getExternalReferenceLinkedTargets(referenceId)) as {
          target_type: string;
          target_id: string;
          title: string;
        }[]
      );
    } catch {
      toast.show('Could not load linked locations.', { variant: 'error' });
    }
  };
  const acceptConsentAndPreview = async () => {
    if (!consentReference) return;
    setBusyId(consentReference.id);
    try {
      await api.acceptFigmaPrivacySettings();
      await api.createExternalReferencePreview(
        consentReference.id,
        target.targetType,
        target.targetId
      );
      setConsentReference(null);
      await load();
    } catch {
      toast.show('Preview sharing was not enabled. The Figma link remains linked.', {
        variant: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const rows = useMemo(
    () =>
      links
        .map((link) => ({
          link,
          reference: (Array.isArray(link.external_references)
            ? link.external_references[0]
            : link.external_references) as Reference | undefined,
        }))
        .filter((row) => row.reference),
    [links]
  );
  const sectionLabel = rows.some(({ reference }) => isGithub(reference)) ? 'Linked work' : 'Linked designs';
  const hasGithubWork = rows.some(({ reference }) => isGithub(reference) && ['issue', 'pullRequest'].includes(String(reference?.external_type ?? '')));
  const githubIssues = rows.filter(({ reference }) => isGithub(reference) && reference?.external_type === 'issue' && String(reference?.metadata?.state ?? '').toLowerCase() === 'open').length;
  const githubPullRequests = rows.filter(({ reference }) => isGithub(reference) && reference?.external_type === 'pullRequest' && !['closed', 'merged'].includes(String(reference?.metadata?.state ?? '').toLowerCase())).length;
  const githubAttention = rows.filter(({ reference }) => isGithub(reference) && (Number((reference?.metadata as any)?.reviewSummary?.reviewRequestedCount ?? 0) > 0 || Number((reference?.metadata as any)?.reviewSummary?.changesRequestedCount ?? 0) > 0 || String((reference?.metadata as any)?.checksSummary?.overallState ?? '') === 'failing')).length;
  return (
    <section
      className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-4"
      aria-labelledby={`linked-designs-${target.targetId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p
            id={`linked-designs-${target.targetId}`}
            className="text-xs font-semibold text-[var(--ledger-text-primary)]"
          >
            {sectionLabel}
          </p>
          {rows.length > 0 && (
            <span className="text-[11px] text-[var(--ledger-text-muted)]">{rows.length}</span>
          )}
          {target.targetType === 'project' && hasGithubWork && (
            <span className="text-[11px] text-[var(--ledger-text-muted)]">{githubIssues} open issues · {githubPullRequests} open PRs{githubAttention ? ` · ${githubAttention} needs attention` : ''}</span>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ledger-accent)] hover:text-[var(--ledger-accent-hover)]"
          >
            <Link2 size={12} />
            Add context
          </button>
        )}
        {canEdit && target.targetType === 'intake' && hasGithubWork && (
          <button type="button" onClick={() => void openProjectPicker()} className="text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Attach to project</button>
        )}
        {canEdit && <GithubResourcePicker onSelect={selectGithubResource} existingReferenceIds={links.map((link) => link.external_reference_id)} />}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-[var(--ledger-text-muted)]">
          <Loader2 size={13} className="animate-spin" />
          Loading linked work…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] px-3 py-3 text-xs text-[var(--ledger-text-muted)]">
          Keep related Figma designs and GitHub work connected to this item.
          {canEdit && (
            <button
              type="button"
              className="ml-1 font-medium text-[var(--ledger-accent)]"
              onClick={() => setDialogOpen(true)}
            >
              Add context
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map(({ link, reference }) => {
            const github = isGithub(reference);
            const githubMetadata = (reference?.metadata ?? {}) as Record<string, any>;
            const preview = previews[link.external_reference_id];
            const refUrl = reference?.normalized_url || reference?.external_url || '';
            const title = github
              ? githubTitle(reference!)
              : referenceTitle(reference!, fallbackNodeName);
            const fileName = referenceFileName(reference!, fallbackFileName);
            const context = github
              ? [
                  reference?.metadata?.state,
                  githubMetadata.reviewSummary?.reviewRequestedCount > 0 ? 'Review requested' : '',
                  githubMetadata.reviewSummary?.changesRequestedCount > 0 ? 'Changes requested' : '',
                  githubMetadata.checksSummary?.overallState && githubMetadata.checksSummary?.overallState !== 'none'
                    ? `${githubMetadata.checksSummary.overallState} checks`
                    : '',
                  reference?.metadata?.repositoryFullName,
                  reference?.metadata?.isArchived ? 'Archived' : '',
                  reference?.access_status && reference.access_status !== 'accessible' ? 'Access unavailable' : '',
                  link.link_metadata?.role === 'primary' ? 'Primary repository' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : [
                  resourceLabel(reference!),
                  fileName,
                  preview?.capturedAt ? `Preview captured ${formatDate(preview.capturedAt)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
            return (
              <div
                key={link.id}
                className="relative flex items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] px-2.5 py-2"
              >
                <div className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--ledger-surface-muted)]">
                  {github ? (
                    <img src="/github-mark.svg" alt="" className="h-4 w-4" />
                  ) : preview?.url ? (
                    <img src={preview.url} alt={title} className="h-full w-full object-cover" />
                  ) : (
                    <FileImage size={15} className="text-[var(--ledger-text-muted)]" />
                  )}
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => refUrl && openExternal(refUrl)}
                >
                  <p className="truncate text-xs font-medium text-[var(--ledger-text-primary)]">
                    {title}
                  </p>
                  <p className="truncate text-[11px] text-[var(--ledger-text-muted)]">
                    {github ? (
                      <>
                        {reference?.external_type === 'pullRequest'
                          ? 'GitHub PR'
                          : reference?.external_type === 'issue'
                          ? 'GitHub issue'
                          : 'GitHub repository'}
                        {reference?.metadata?.isPrivate && (
                          <>
                            <LockKeyhole size={10} className="ml-1 inline" />
                          </>
                        )}
                      </>
                    ) : (
                      'Figma'
                    )}
                    {context ? ` · ${context}` : ''}
                  </p>
                </button>
                {canInsert && onInsert && (
                  <button
                    type="button"
                    title="Insert into description"
                    aria-label="Insert into description"
                    onClick={() => onInsert({ id: reference!.id, url: refUrl })}
                    className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                  >
                    <Check size={13} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Reference actions"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setMenuLink(menuLink?.id === link.id ? null : link)}
                  className="rounded-md p-1 text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)]"
                >
                  <MoreHorizontal size={14} />
                </button>
                {busyId === link.id && (
                  <Loader2 size={13} className="animate-spin text-[var(--ledger-accent)]" />
                )}
                <div className="sr-only">{link.sources?.join(', ')}</div>
                {menuLink?.id === link.id && (
                  <div
                    className="absolute right-2 top-10 z-20 w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                      onClick={() => {
                        openExternal(refUrl);
                        setMenuLink(null);
                      }}
                    >
                      Open in {github ? 'GitHub' : 'Figma'}
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"
                      onClick={() => {
                        void refresh(link);
                        setMenuLink(null);
                      }}
                    >
                      Refresh
                    </button>
                    {canInsert && onInsert && (
                      <button
                        type="button"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                        onClick={() => {
                          onInsert({ id: reference!.id, url: refUrl });
                          setMenuLink(null);
                        }}
                      >
                        Insert into description
                      </button>
                    )}
                    {target.targetType === 'project' && github && reference?.external_type === 'repository' && link.link_metadata?.role !== 'primary' && (
                      <button type="button" disabled={!canEdit} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50" onClick={() => { void api.linkExternalReferenceWithMetadata(reference!.id, target.targetType, target.targetId, { role: 'primary' }, 'manual').then(load).catch(() => toast.show('Could not set the primary repository.', { variant: 'error' })); setMenuLink(null); }}>Set as primary repository</button>
                    )}
                    {canEdit && target.targetType !== 'task' && github && ['issue', 'pullRequest'].includes(String(reference?.external_type ?? '')) && (
                      <button type="button" disabled={Boolean(busyId)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50" onClick={() => { void createGithubTask(link, reference!); setMenuLink(null); }}>Create Ledger task</button>
                    )}
                    <button
                      type="button"
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--ledger-surface-hover)]"
                      onClick={() => {
                        void showLocations(reference!.id);
                        setMenuLink(null);
                      }}
                    >
                      View linked locations
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)]"
                        onClick={() => {
                          void unlink(link);
                          setMenuLink(null);
                        }}
                      >
                        Unlink from this item
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add linked context"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                Add linked context
              </h3>
              <button type="button" aria-label="Close" onClick={() => setDialogOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="mt-3 flex gap-1 rounded-lg bg-[var(--ledger-surface-muted)] p-1">
              <button
                type="button"
                onClick={() => {
                  setProvider('figma');
                  setMode('paste');
                }}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                  provider === 'figma'
                    ? 'bg-[var(--ledger-surface-card)] font-medium'
                    : 'text-[var(--ledger-text-muted)]'
                }`}
              >
                Figma
              </button>
              <button
                type="button"
                onClick={() => {
                  setProvider('github');
                  setMode('paste');
                }}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                  provider === 'github'
                    ? 'bg-[var(--ledger-surface-card)] font-medium'
                    : 'text-[var(--ledger-text-muted)]'
                }`}
              >
                GitHub
              </button>
            </div>
            <div className="mt-3 flex gap-1 rounded-lg bg-[var(--ledger-surface-muted)] p-1">
              <button
                type="button"
                onClick={() => setMode('paste')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                  mode === 'paste'
                    ? 'bg-[var(--ledger-surface-card)] font-medium'
                    : 'text-[var(--ledger-text-muted)]'
                }`}
              >
                Paste link
              </button>
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                  mode === 'existing'
                    ? 'bg-[var(--ledger-surface-card)] font-medium'
                    : 'text-[var(--ledger-text-muted)]'
                }`}
              >
                Search
              </button>
            </div>
            {mode === 'paste' ? (
              <>
                <label
                  className="mt-4 block text-xs text-[var(--ledger-text-muted)]"
                  htmlFor="external-link-input"
                >
                  Paste a {provider === 'github' ? 'GitHub' : 'Figma'} link
                </label>
                <input
                  id="external-link-input"
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setDialogOpen(false);
                    if (event.key === 'Enter') void pasteLink();
                  }}
                  placeholder={
                    provider === 'github'
                      ? 'https://github.com/owner/repository/issues/123'
                      : 'https://figma.com/design/...'
                  }
                  className="mt-1 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-xs outline-none focus:border-[color:var(--ledger-border-strong)]"
                />
              </>
            ) : (
              <div className="mt-3">
                {provider === 'github' ? (
                  <>
                    <select
                      value={githubRepositoryId}
                      onChange={(event) => setGithubRepositoryId(event.target.value)}
                      className="h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-xs"
                    >
                      <option value="">Choose approved repository</option>
                      {githubRepositories.map((repo) => (
                        <option key={repo.github_repository_id} value={repo.github_repository_id}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                    {target.targetType === 'project' && githubRepositories.length > 0 && (
                      <div className="mt-2 rounded-lg border border-[color:var(--ledger-border-subtle)] p-2">
                        <p className="text-[11px] text-[var(--ledger-text-muted)]">Link an approved repository</p>
                        <div className="mt-1 space-y-0.5">
                          {githubRepositories.map((repo) => (
                            <button key={repo.github_repository_id} type="button" onClick={() => void linkApprovedRepository(repo)} disabled={Boolean(busyId)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">
                              <span className="truncate">{repo.full_name}</span><span className="ml-2 text-[var(--ledger-accent)]">Link</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <select
                        value={githubType}
                        onChange={(event) =>
                          setGithubType(event.target.value as 'issue' | 'pull_request')
                        }
                        className="h-9 rounded-md border border-[color:var(--ledger-border-subtle)] bg-transparent px-2 text-xs"
                      >
                        <option value="issue">Issues</option>
                        <option value="pull_request">Pull requests</option>
                      </select>
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-2">
                        <Search size={13} className="text-[var(--ledger-text-muted)]" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search GitHub work"
                          className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-[color:var(--ledger-border-subtle)] px-2">
                    <Search size={13} className="text-[var(--ledger-text-muted)]" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search file or node name"
                      className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                    />
                  </div>
                )}
                <div className="mt-2 max-h-52 overflow-y-auto">
                  {existing.map((reference) => (
                    <button
                      type="button"
                      key={reference.id}
                      onClick={() => void linkReference(reference)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--ledger-surface-hover)]"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--ledger-surface-muted)]">
                        {reference.provider === 'github' ? (
                          <img src="/github-mark.svg" alt="" className="h-3.5 w-3.5" />
                        ) : (
                          <FileImage size={14} className="text-[var(--ledger-text-muted)]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {reference.provider === 'github'
                            ? githubTitle(reference)
                            : referenceTitle(reference)}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--ledger-text-muted)]">
                          {reference.provider === 'github'
                            ? String(reference.metadata?.repositoryFullName ?? '')
                            : `Figma · ${resourceLabel(reference)}`}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="h-8 rounded-md px-3 text-xs text-[var(--ledger-text-secondary)]"
              >
                Cancel
              </button>
              {mode === 'paste' && (
                <button
                  type="button"
                  onClick={() => void pasteLink()}
                  disabled={!url.trim() || Boolean(busyId)}
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white disabled:opacity-60"
                >
                  {busyId === 'paste' && <Loader2 size={12} className="animate-spin" />}Add link
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {locations && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-4"
          role="dialog"
          aria-label="Linked in Ledger"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLocations(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Linked in Ledger</h3>
              <button type="button" onClick={() => setLocations(null)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="mt-3 space-y-1">
              {locations.map((location) => (
                <div
                  key={`${location.target_type}:${location.target_id}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs"
                >
                  <span className="truncate">{location.title}</span>
                  <span className="ml-2 shrink-0 text-[var(--ledger-text-muted)]">
                    {location.target_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {projectPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Attach GitHub work to project" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectPickerOpen(false); }}>
          <div className="w-full max-w-sm rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--ledger-text-primary)]">Attach to project</h3><button type="button" onClick={() => setProjectPickerOpen(false)} aria-label="Close"><X size={15} /></button></div>
            <select value={projectPickerId} onChange={(event) => setProjectPickerId(event.target.value)} className="mt-3 h-9 w-full rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-xs text-[var(--ledger-text-secondary)]"><option value="">Choose a project</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setProjectPickerOpen(false)} className="h-8 rounded-md px-3 text-xs text-[var(--ledger-text-secondary)]">Cancel</button><button type="button" disabled={!projectPickerId || Boolean(busyId)} onClick={() => void attachGithubToProject()} className="h-8 rounded-md border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">{busyId === 'attach-project' ? 'Attaching…' : 'Attach'}</button></div>
          </div>
        </div>
      )}
      {consentReference && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Share Figma previews"
        >
          <div className="w-full max-w-sm rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-4 shadow-[var(--ledger-shadow)]">
            <h3 className="text-sm font-semibold">Share Figma previews in Ledger?</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--ledger-text-secondary)]">
              People who can access a Ledger item will be able to view its saved Figma preview, even
              if they cannot open the original Figma file.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-md px-3 text-xs"
                onClick={() => setConsentReference(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-8 rounded-md bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white disabled:opacity-60"
                onClick={() => void acceptConsentAndPreview()}
                disabled={Boolean(busyId)}
              >
                Allow previews
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
