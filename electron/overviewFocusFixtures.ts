import type { OverviewFocusSnapshot } from '../src/types/overviewFocus.ts';
import type { OverviewFocusSignal } from './overviewFocus.ts';

export const OVERVIEW_FOCUS_FIXTURE_NOW = new Date('2026-08-18T12:00:00.000Z');

export type OverviewFocusFixture = {
  id: string;
  description: string;
  snapshot: OverviewFocusSnapshot;
  acceptableSignalKinds: OverviewFocusSignal['kind'][];
  forbiddenSignalKinds: OverviewFocusSignal['kind'][];
  modelOutput: unknown;
  expectedAcceptedCount: number;
};

const base = (patch: Partial<OverviewFocusSnapshot>): OverviewFocusSnapshot => ({
  generatedAt: OVERVIEW_FOCUS_FIXTURE_NOW.toISOString(),
  workspaceId: 'workspace-fixture',
  tasks: [],
  projects: [],
  events: [],
  recentNotes: [],
  ...patch,
});

const insight = (title: string, summary: string, resourceRefs: Array<{ type: 'task' | 'project' | 'event' | 'note'; id: string }>, importance: 'normal' | 'attention' = 'attention') => ({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, summary, importance, resourceRefs });

export const OVERVIEW_FOCUS_FIXTURES: OverviewFocusFixture[] = [
  {
    id: 'quiet-healthy-day', description: 'Open work has no deadline or relationship risk.', snapshot: base({ tasks: [{ id: 'task-quiet', title: 'Read draft', status: 'open', section: 'today' }], projects: [{ id: 'project-quiet', title: 'Healthy project', status: 'in_progress', progress: 65 }], events: [{ id: 'event-quiet', title: 'Routine check-in', startsAt: '2026-08-18T15:00:00.000Z' }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['overdue_task', 'deadline_cluster', 'project_concentration', 'project_deadline_progress'], modelOutput: { insights: [] }, expectedAcceptedCount: 0,
  },
  {
    id: 'several-overdue-tasks', description: 'Several important unfinished tasks are past due.', snapshot: base({ tasks: [{ id: 'task-overdue-a', title: 'Finish Journals', status: 'open', dueAt: '2026-08-16T12:00:00.000Z', priority: 'high', section: 'today' }, { id: 'task-overdue-b', title: 'Send catalog proof', status: 'open', dueAt: '2026-08-17T12:00:00.000Z', priority: 'medium', section: 'today' }] }), acceptableSignalKinds: ['overdue_task'], forbiddenSignalKinds: [], modelOutput: { insights: [insight('Overdue work needs attention', 'Two unfinished tasks are past their due dates.', [{ type: 'task', id: 'task-overdue-a' }, { type: 'task', id: 'task-overdue-b' }])] }, expectedAcceptedCount: 1,
  },
  {
    id: 'one-low-importance-overdue', description: 'An isolated low-importance overdue item should not create urgency.', snapshot: base({ tasks: [{ id: 'task-low', title: 'Clean old archive', status: 'open', dueAt: '2026-08-10T12:00:00.000Z', priority: 'low', section: 'long_term' }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['overdue_task'], modelOutput: { insights: [insight('Critical task', 'You must act immediately on this overdue item.', [{ type: 'task', id: 'task-low' }])] }, expectedAcceptedCount: 0,
  },
  {
    id: 'multiple-tasks-one-project', description: 'Unfinished work is concentrated in one project.', snapshot: base({ tasks: [{ id: 'task-cluster-a', title: 'Design cover', status: 'open', projectId: 'project-cluster', section: 'today' }, { id: 'task-cluster-b', title: 'Review copy', status: 'open', projectId: 'project-cluster', section: 'today' }], projects: [{ id: 'project-cluster', title: 'Catalog project', status: 'in_progress', progress: 40 }] }), acceptableSignalKinds: ['project_concentration'], forbiddenSignalKinds: [], modelOutput: { insights: [insight('Catalog project has concentrated work', 'Two unfinished Today tasks belong to the same project.', [{ type: 'project', id: 'project-cluster' }, { type: 'task', id: 'task-cluster-a' }, { type: 'task', id: 'task-cluster-b' }])] }, expectedAcceptedCount: 1,
  },
  {
    id: 'near-deadline-low-progress', description: 'A project is close to its deadline with low progress.', snapshot: base({ projects: [{ id: 'project-low', title: 'Alfa 2026 Catalog', status: 'in_progress', dueAt: '2026-08-21T12:00:00.000Z', progress: 29 }] }), acceptableSignalKinds: ['project_deadline_progress'], forbiddenSignalKinds: [], modelOutput: { insights: [insight('Alfa 2026 Catalog needs attention', 'Its deadline is three days away and progress is 29%.', [{ type: 'project', id: 'project-low' }])] }, expectedAcceptedCount: 1,
  },
  {
    id: 'near-deadline-high-progress', description: 'A nearly complete project should not be treated as a risk.', snapshot: base({ projects: [{ id: 'project-high', title: 'Launch checklist', status: 'in_progress', dueAt: '2026-08-21T12:00:00.000Z', progress: 92 }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['project_deadline_progress'], modelOutput: { insights: [] }, expectedAcceptedCount: 0,
  },
  {
    id: 'several-deadlines-tomorrow', description: 'Multiple unfinished tasks share a near deadline.', snapshot: base({ tasks: [{ id: 'task-tomorrow-a', title: 'Finish Journals', status: 'open', dueAt: '2026-08-19T10:00:00.000Z', section: 'today' }, { id: 'task-tomorrow-b', title: 'Write exit essay', status: 'open', dueAt: '2026-08-19T12:00:00.000Z', section: 'today' }, { id: 'task-tomorrow-c', title: 'Review submission', status: 'open', dueAt: '2026-08-19T16:00:00.000Z', section: 'today' }] }), acceptableSignalKinds: ['approaching_deadline', 'deadline_cluster'], forbiddenSignalKinds: [], modelOutput: { insights: [insight('Three deliverables are due tomorrow', 'Finish Journals, the exit essay, and the submission review are all due tomorrow.', [{ type: 'task', id: 'task-tomorrow-a' }, { type: 'task', id: 'task-tomorrow-b' }, { type: 'task', id: 'task-tomorrow-c' }])] }, expectedAcceptedCount: 1,
  },
  {
    id: 'busy-calendar-no-concern', description: 'A busy calendar alone should not produce Focus.', snapshot: base({ events: Array.from({ length: 6 }, (_, index) => ({ id: `event-busy-${index}`, title: `Routine meeting ${index + 1}`, startsAt: `2026-08-18T${String(9 + index).padStart(2, '0')}:00:00.000Z` })) }), acceptableSignalKinds: [], forbiddenSignalKinds: ['event_workload'], modelOutput: { insights: [] }, expectedAcceptedCount: 0,
  },
  {
    id: 'completed-today', description: 'Completed Today work should not be surfaced as unfinished.', snapshot: base({ tasks: [{ id: 'task-completed', title: 'Finished report', status: 'completed', dueAt: '2026-08-16T12:00:00.000Z', section: 'today' }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['overdue_task'], modelOutput: { insights: [insight('Report is overdue', 'The completed report is still overdue and needs attention.', [{ type: 'task', id: 'task-completed' }])] }, expectedAcceptedCount: 0,
  },
  {
    id: 'empty-workspace', description: 'No Overview records should produce no insight.', snapshot: base({}), acceptableSignalKinds: [], forbiddenSignalKinds: ['overdue_task', 'deadline_cluster', 'project_concentration'], modelOutput: { insights: [] }, expectedAcceptedCount: 0,
  },
  {
    id: 'stale-completed-project', description: 'Completed projects should not be flagged.', snapshot: base({ projects: [{ id: 'project-done', title: 'Old project', status: 'completed', dueAt: '2026-08-10T12:00:00.000Z', progress: 100 }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['project_deadline_progress'], modelOutput: { insights: [insight('Old project is behind', 'The completed project is overdue.', [{ type: 'project', id: 'project-done' }])] }, expectedAcceptedCount: 0,
  },
  {
    id: 'mixed-context', description: 'A mixed workspace should favor a real project/task relationship over routine context.', snapshot: base({ tasks: [{ id: 'task-mixed-a', title: 'Prepare launch assets', status: 'open', dueAt: '2026-08-17T12:00:00.000Z', projectId: 'project-mixed', section: 'today' }, { id: 'task-mixed-b', title: 'Review launch assets', status: 'open', projectId: 'project-mixed', section: 'today' }], projects: [{ id: 'project-mixed', title: 'Launch project', status: 'in_progress', dueAt: '2026-08-22T12:00:00.000Z', progress: 35 }], events: [{ id: 'event-mixed', title: 'Routine sync', startsAt: '2026-08-18T14:00:00.000Z' }], recentNotes: [{ id: 'note-mixed', title: 'Launch notes', updatedAt: '2026-08-18T10:00:00.000Z' }] }), acceptableSignalKinds: ['overdue_task', 'project_concentration', 'project_deadline_progress'], forbiddenSignalKinds: ['event_workload'], modelOutput: { insights: [insight('Launch project needs attention', 'Two unfinished tasks are connected to the project, including one overdue item.', [{ type: 'project', id: 'project-mixed' }, { type: 'task', id: 'task-mixed-a' }, { type: 'task', id: 'task-mixed-b' }])] }, expectedAcceptedCount: 1,
  },
  {
    id: 'busy-but-no-insight', description: 'Several undated tasks and notes are activity, not an attention signal.', snapshot: base({ tasks: [{ id: 'task-busy-a', title: 'Organize references', status: 'open', section: 'today' }, { id: 'task-busy-b', title: 'Review ideas', status: 'open', section: 'long_term' }], recentNotes: [{ id: 'note-busy-a', title: 'Ideas', updatedAt: '2026-08-18T11:00:00.000Z' }, { id: 'note-busy-b', title: 'Scratchpad', updatedAt: '2026-08-18T09:00:00.000Z' }] }), acceptableSignalKinds: [], forbiddenSignalKinds: ['overdue_task', 'deadline_cluster', 'project_concentration'], modelOutput: { insights: [insight('You have 2 tasks today', 'You have 2 tasks today.', [{ type: 'task', id: 'task-busy-a' }], 'normal')] }, expectedAcceptedCount: 0,
  },
];
