import { getMobileCalendarRange, type MobileCalendarRangeResponse } from './calendar';
import { getMobileProjects, type MobileProjectsMilestone, type MobileProjectsProject } from './projects';
import { mobileRequest } from './client';
import { normalizeCalendarRange, type MobileCalendarItem } from '@/features/calendar/calendarItemNormalizer';

export type MobileProjectTask = {
  id: string;
  title: string;
  status?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  priority?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MobileProjectNote = { id: string; title: string; preview?: string | null; updated_at?: string | null };
export type MobileProjectResource = { id?: string; name?: string; provider?: string; type?: string; canonical_url?: string | null; external_metadata?: Record<string, unknown> | null };
export type MobileProjectContextItem = {
  id: string;
  type: string;
  title: string;
  source?: string | null;
  provider?: string | null;
  url?: string | null;
  relationship?: string | null;
  sourceLabel?: string | null;
};
export type MobileProjectActivity = { id: string; title: string; timestamp: string | null };

export type MobileProjectDetail = {
  project: MobileProjectsProject;
  tasks: MobileProjectTask[];
  milestones: MobileProjectsMilestone[];
  notes: MobileProjectNote[];
  calendar: MobileCalendarItem[];
  resources: MobileProjectResource[];
  relatedContext: MobileProjectContextItem[];
  activity: MobileProjectActivity[];
  sectionErrors: Partial<Record<'tasks' | 'notes' | 'calendar' | 'resources' | 'relatedContext', string>>;
};

type SectionResult<T> = { value: T; error?: string };

function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function addDays(dateKey: string, amount: number) { const date = new Date(`${dateKey}T12:00:00`); date.setDate(date.getDate() + amount); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export async function getMobileProjectDetail(projectId: string, workspaceId: string): Promise<MobileProjectDetail> {
  const projectResponse = await getMobileProjects(workspaceId, true);
  const project = projectResponse.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('Project not found.');
  const projectWorkspaceId = project.workspace_id;
  const headers = { 'x-workspace-id': projectWorkspaceId };
  const today = localDateKey();
  const [tasksResult, notesResult, calendarResult, resourcesResult, relatedContextResult] = await Promise.all([
    mobileRequest<MobileProjectTask[]>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`, { headers })
      .then((value): SectionResult<MobileProjectTask[]> => ({ value }))
      .catch((error): SectionResult<MobileProjectTask[]> => ({ value: [], error: error instanceof Error ? error.message : 'Could not load tasks.' })),
    mobileRequest<{ links?: Array<{ note?: MobileProjectNote }> }>(`/api/projects/${encodeURIComponent(projectId)}/note-links`, { headers })
      .then((value): SectionResult<{ links?: Array<{ note?: MobileProjectNote }> }> => ({ value }))
      .catch((error): SectionResult<{ links?: Array<{ note?: MobileProjectNote }> }> => ({ value: {}, error: error instanceof Error ? error.message : 'Could not load notes.' })),
    getMobileCalendarRange(projectWorkspaceId, addDays(today, -30), addDays(today, 90))
      .then((value): SectionResult<MobileCalendarRangeResponse> => ({ value }))
      .catch((error): SectionResult<MobileCalendarRangeResponse> => ({ value: { workspace_id: projectWorkspaceId, start_date: today, end_date: today, events: [], reminders: [], tasks: [], projects: [], milestones: [], calendars: [] }, error: error instanceof Error ? error.message : 'Could not load calendar items.' })),
    mobileRequest<MobileProjectResource[]>(`/api/projects/${encodeURIComponent(projectId)}/connected-sources`, { headers })
      .then((value): SectionResult<MobileProjectResource[]> => ({ value }))
      .catch((error): SectionResult<MobileProjectResource[]> => ({ value: [], error: error instanceof Error ? error.message : 'Could not load resources.' })),
    Promise.all([
      mobileRequest<Array<{ id?: string; resource?: { id?: string; type?: string; title?: string } }>>(`/api/context-links?resource_type=project&resource_id=${encodeURIComponent(projectId)}`, { headers }),
      mobileRequest<Array<{ id?: string; external_reference_id?: string; external_references?: { id?: string; provider?: string | null; external_url?: string | null; normalized_url?: string | null; external_type?: string | null; metadata?: Record<string, unknown> | null } | Array<{ id?: string; provider?: string | null; external_url?: string | null; normalized_url?: string | null; external_type?: string | null; metadata?: Record<string, unknown> | null }> }>>(`/api/external-references?targetType=project&targetId=${encodeURIComponent(projectId)}`, { headers }),
    ])
      .then(([contextLinks, externalReferences]) => ({
        value: {
          items: [
            ...contextLinks.map((link) => ({ source: 'context_link', target: link.resource, relationship: 'related_to', provenance: null })),
            ...externalReferences.map((link) => {
              const reference = Array.isArray(link.external_references) ? link.external_references[0] : link.external_references;
              const metadata = reference?.metadata ?? {};
              const title = [metadata.title, metadata.name, metadata.nodeName, metadata.fileName, metadata.pageName, metadata.documentName, metadata.repositoryFullName, reference?.external_type].find((value) => String(value ?? '').trim()) ?? 'Linked resource';
              return { source: 'external_reference', target: { id: reference?.id ?? link.external_reference_id, type: 'external_reference', title: String(title), provider: reference?.provider ?? null, url: reference?.normalized_url ?? reference?.external_url ?? null }, relationship: 'references', provenance: { source_label: String(title) } };
            }),
          ],
        },
      }))
      .then((value): SectionResult<{ items?: Array<{ source?: string | null; target?: { id?: string; type?: string; title?: string; provider?: string | null; url?: string | null }; relationship?: string | null; provenance?: { source_label?: string | null } | null }> }> => value)
      .catch((error): SectionResult<{ items?: Array<{ source?: string | null; target?: { id?: string; type?: string; title?: string; provider?: string | null; url?: string | null }; relationship?: string | null; provenance?: { source_label?: string | null } | null }> }> => ({ value: {}, error: error instanceof Error ? error.message : 'Could not load related context.' })),
  ]);
  const milestones = projectResponse.milestones.filter((item) => item.project_id === projectId);
  const calendar = normalizeCalendarRange(calendarResult.value).filter((item) => item.projectId === projectId || item.type === 'project_deadline' && item.projectId === projectId);
  const tasks = Array.isArray(tasksResult.value) ? tasksResult.value : [];
  const activity = [
    project.updated_at ? { id: `project:${project.id}`, title: 'Project updated', timestamp: project.updated_at } : null,
    ...tasks.filter((task) => task.updated_at || task.completed_at).map((task) => ({ id: `task:${task.id}`, title: task.completed_at ? `Completed “${task.title}”` : `Updated “${task.title}”`, timestamp: task.completed_at ?? task.updated_at ?? null })),
    ...milestones.filter((item) => item.updated_at).map((item) => ({ id: `milestone:${item.id}`, title: `${item.completed ? 'Completed' : 'Updated'} “${item.title}”`, timestamp: item.updated_at ?? null })),
  ].filter(Boolean).sort((left, right) => String(right!.timestamp ?? '').localeCompare(String(left!.timestamp ?? ''))).slice(0, 8) as MobileProjectActivity[];
  return {
    project,
    tasks,
    milestones,
    notes: (notesResult.value.links ?? []).map((link) => link.note).filter(Boolean) as MobileProjectNote[],
    calendar,
    resources: Array.isArray(resourcesResult.value) ? resourcesResult.value : [],
    relatedContext: (relatedContextResult.value.items ?? []).flatMap((item) => {
      const target = item.target;
      if (!target?.id || !target.type || !target.title) return [];
      return [{
        id: `${target.type}:${target.id}`,
        type: target.type,
        title: target.title,
        source: item.source ?? null,
        provider: target.provider ?? null,
        url: target.url ?? null,
        relationship: item.relationship ?? null,
        sourceLabel: item.provenance?.source_label ?? null,
      }];
    }),
    activity,
    sectionErrors: {
      ...(tasksResult.error ? { tasks: tasksResult.error } : {}),
      ...(notesResult.error ? { notes: notesResult.error } : {}),
      ...(calendarResult.error ? { calendar: calendarResult.error } : {}),
      ...(resourcesResult.error ? { resources: resourcesResult.error } : {}),
      ...(relatedContextResult.error ? { relatedContext: relatedContextResult.error } : {}),
    },
  };
}
