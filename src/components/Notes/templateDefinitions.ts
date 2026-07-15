import { BookOpen, FileText, Lightbulb, User, type LucideIcon } from 'lucide-react'

export type TemplateCategory = 'meeting' | 'internship' | 'team' | 'project' | 'personal' | 'reading'

export type TemplateSummary = {
  id: string
  name: string
  description: string | null
  category: string
  content_html?: string | null
  is_default: boolean
  is_system: boolean
  visibility?: 'mine' | 'workspace'
  usage_count: number
  last_used_at?: string | null
  pinned?: boolean
  created_by?: string | null
  title_pattern?: string | null
  suggested_section_id?: string | null
  icon?: string | null
  color?: string | null
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'meeting',
  'internship',
  'team',
  'project',
  'personal',
  'reading',
]

export const QUICK_TEMPLATE_DEFINITIONS: Array<{
  name: string
  icon: LucideIcon
  description: string
}> = [
  { name: 'Meeting Notes', icon: User, description: 'Decisions, owners, deadlines, and follow-ups' },
  { name: 'Project Brief', icon: Lightbulb, description: 'Goals, scope, risks, and next actions' },
  { name: 'Daily Reflection', icon: FileText, description: 'What moved, what blocked, and tomorrow' },
  { name: 'Book Notes', icon: BookOpen, description: 'Summary, takeaways, and application' },
]

export const TEMPLATE_SOURCE_LABELS = {
  ledger: 'Ledger',
  workspace: 'Workspace',
  mine: 'Mine',
} as const

export const resolveTemplateSource = (template: Pick<TemplateSummary, 'is_system' | 'visibility'>) =>
  template.is_system ? 'ledger' : template.visibility === 'workspace' ? 'workspace' : 'mine'

export const formatTemplateTitle = (
  pattern: string | null | undefined,
  context: Partial<Record<'date' | 'week_start' | 'project' | 'team' | 'person' | 'topic', string>> = {}
) => {
  const fallback = pattern?.trim() || 'Untitled Note'
  const resolved = fallback.replace(/\{\{(date|week_start|project|team|person|topic)\}\}/g, (_, key: keyof typeof context) => context[key] || '')
  return resolved.replace(/\s{2,}/g, ' ').replace(/\s+([—-])/g, ' $1').trim() || 'Untitled Note'
}
