import {
  BriefcaseBusiness,
  Code2,
  FileText,
  Palette,
  Sparkles,
  UserRound,
} from 'lucide-react';

export type ProjectTypeKind = 'code' | 'design' | 'personal' | 'ops' | 'writing' | 'other';

export type ProjectTypeOption = {
  id: ProjectTypeKind;
  label: string;
  description: string;
  color: string;
  icon: typeof Code2;
};

export const projectTypeOptions: ProjectTypeOption[] = [
  {
    id: 'code',
    label: 'Code',
    description: 'Engineering and product work',
    color: '#3B82F6',
    icon: Code2,
  },
  {
    id: 'design',
    label: 'Design',
    description: 'Graphic and visual work',
    color: '#FF5F40',
    icon: Palette,
  },
  {
    id: 'personal',
    label: 'Personal',
    description: 'Life admin and personal goals',
    color: '#22C55E',
    icon: UserRound,
  },
  {
    id: 'ops',
    label: 'Ops',
    description: 'Execution and coordination',
    color: '#F59E0B',
    icon: BriefcaseBusiness,
  },
  {
    id: 'writing',
    label: 'Writing',
    description: 'Docs, copy, and content',
    color: '#14B8A6',
    icon: FileText,
  },
  {
    id: 'other',
    label: 'Other',
    description: 'General project work',
    color: '#6B7280',
    icon: Sparkles,
  },
];

export const getProjectTypeOption = (value: string | null | undefined) =>
  projectTypeOptions.find((option) => option.id === value) ?? projectTypeOptions[5];