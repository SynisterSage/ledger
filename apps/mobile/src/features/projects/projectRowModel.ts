import type { MobileProjectsProject } from '@/api/projects';
import type { ProjectRowVariant, MobileProjectRowModel } from './ProjectRow';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

export function projectRowVariant(project: MobileProjectsProject, section: 'attention' | 'active' | 'upcoming' | 'hold' | 'completed'): ProjectRowVariant {
  if (section === 'attention') return 'attention';
  if (section === 'upcoming') return 'upcoming';
  if (section === 'hold') return 'paused';
  if (section === 'completed') return 'completed';
  return 'default';
}

export function toProjectRowModel(project: MobileProjectsProject, section: 'attention' | 'active' | 'upcoming' | 'hold' | 'completed'): MobileProjectRowModel {
  const variant = projectRowVariant(project, section);
  const due = formatDate(project.end_date);
  const start = formatDate(project.start_date);
  const context = variant === 'attention'
    ? project.attention?.label ?? project.attention_reason ?? 'Needs attention'
    : variant === 'paused'
      ? 'On hold'
      : variant === 'completed'
        ? 'Completed'
        : project.next_action
          ? `Next: ${project.next_action}`
          : variant === 'upcoming' && start
            ? `Planned ${start}`
            : 'No next action';
  const metadata = [due ? `Due ${due}` : variant === 'upcoming' && start ? `Starts ${start}` : null].filter(Boolean).join(' · ') || null;
  const progress = typeof project.completeness === 'number' && Number.isFinite(project.completeness) && variant !== 'completed'
    ? Math.max(0, Math.min(100, project.completeness))
    : undefined;
  return { id: project.id, title: project.name, context, metadata, progress, color: project.color, projectType: project.project_type, variant, attentionSeverity: project.attention?.severity };
}
