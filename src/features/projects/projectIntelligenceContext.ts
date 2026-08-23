import type { AskLedgerContextItem } from '../../types/askLedgerContext';
import {
  deriveProjectSignals,
  type ProjectSignal,
  type ProjectSignalActivity,
  type ProjectSignalCalendarItem,
  type ProjectSignalInput,
  type ProjectSignalMilestone,
  type ProjectSignalProject,
  type ProjectSignalTask,
} from './projectSignals.ts';

export type ProjectIntelligenceContext = {
  workspaceId: string;
  projectId: string;
  project: ProjectSignalProject;
  signals: ProjectSignal[];
  tasks: ProjectSignalTask[];
  milestones: ProjectSignalMilestone[];
  events: ProjectSignalCalendarItem[];
  reminders: ProjectSignalCalendarItem[];
  linkedNotes: AskLedgerContextItem[];
  recentActivity: ProjectSignalActivity[];
  linkedResources: AskLedgerContextItem[];
  semanticContext: AskLedgerContextItem[];
};

export type BuildProjectIntelligenceContextInput = Omit<ProjectSignalInput, 'project'> & {
  project: ProjectSignalProject;
  linkedNotes?: AskLedgerContextItem[];
  linkedResources?: AskLedgerContextItem[];
  semanticContext?: AskLedgerContextItem[];
  maxTasks?: number;
  maxMilestones?: number;
  maxEvents?: number;
  maxReminders?: number;
  maxActivity?: number;
  maxSemanticContext?: number;
};

const byRecent = <T extends { updated_at?: string | null; created_at?: string | null }>(left: T, right: T) =>
  String(right.updated_at ?? right.created_at ?? '').localeCompare(String(left.updated_at ?? left.created_at ?? ''));

const projectRows = <T extends { workspace_id?: string | null; project_id?: string | null }>(rows: T[] | undefined, workspaceId: string, projectId: string) =>
  (rows ?? []).filter((row) => (!row.workspace_id || row.workspace_id === workspaceId) && (!row.project_id || row.project_id === projectId));

const semanticRows = (rows: AskLedgerContextItem[] | undefined, workspaceId: string, projectId: string, limit: number, allowExplicitlyLinked = false) =>
  (rows ?? []).filter((row) => {
    if (row.workspaceId && row.workspaceId !== workspaceId) return false;
    if (row.projectId && row.projectId !== projectId) return false;
    return allowExplicitlyLinked || row.metadata?.context_scope === 'workspace_related_context' || (row.resourceType === 'project' ? row.resourceId === projectId : Boolean(row.projectId === projectId || row.relationships?.some((relationship) => relationship.resourceType === 'project' && relationship.resourceId === projectId)));
  }).slice(0, limit);

export const buildProjectIntelligenceContext = (input: BuildProjectIntelligenceContextInput): ProjectIntelligenceContext => {
  const limits = {
    tasks: input.maxTasks ?? 40,
    milestones: input.maxMilestones ?? 20,
    events: input.maxEvents ?? 20,
    reminders: input.maxReminders ?? 20,
    activity: input.maxActivity ?? 20,
    semanticContext: input.maxSemanticContext ?? 8,
  };
  const tasks = projectRows(input.tasks, input.workspaceId, input.project.id).sort(byRecent).slice(0, limits.tasks);
  const milestones = projectRows(input.milestones, input.workspaceId, input.project.id).sort(byRecent).slice(0, limits.milestones);
  const events = projectRows(input.events, input.workspaceId, input.project.id).sort(byRecent).slice(0, limits.events);
  const reminders = projectRows(input.reminders, input.workspaceId, input.project.id).sort(byRecent).slice(0, limits.reminders);
  const recentActivity = projectRows(input.activity, input.workspaceId, input.project.id).sort(byRecent).slice(0, limits.activity);
  const linkedNotes = semanticRows(input.linkedNotes, input.workspaceId, input.project.id, limits.semanticContext, true);
  const linkedResources = semanticRows(input.linkedResources, input.workspaceId, input.project.id, limits.semanticContext, true);
  const semanticContext = semanticRows(input.semanticContext, input.workspaceId, input.project.id, limits.semanticContext);
  const signals = deriveProjectSignals({ ...input, tasks, milestones, events, reminders, activity: recentActivity });

  return {
    workspaceId: input.workspaceId,
    projectId: input.project.id,
    project: input.project,
    signals,
    tasks,
    milestones,
    events,
    reminders,
    linkedNotes,
    recentActivity,
    linkedResources,
    semanticContext,
  };
};
