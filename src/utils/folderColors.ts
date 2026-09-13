export const folderColorOptions = [
  'gray',
  'blue',
  'green',
  'purple',
  'pink',
  'red',
  'amber',
  'teal',
  'indigo',
  'emerald',
  'slate',
  'orange',
] as const;

export type FolderColor = (typeof folderColorOptions)[number];

export const normalizeFolderColor = (color: string | null | undefined): FolderColor =>
  (folderColorOptions as readonly string[]).includes(String(color))
    ? (color as FolderColor)
    : 'gray';

export const folderColorDotClass: Record<FolderColor, string> = {
  gray: 'bg-[var(--ledger-text-muted)]',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  teal: 'bg-teal-500',
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  slate: 'bg-slate-500',
  orange: 'bg-orange-500',
};
