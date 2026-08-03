import type { MobileNoteType } from './NoteRow';

export type NoteQuickFilter = 'all' | 'pinned' | 'meetings' | 'maps';
export type NoteBrowseSort = 'updated' | 'created' | 'title' | 'manual';
export type NoteUpdatedFilter = 'today' | 'this_week' | 'this_month' | null;

export type NoteBrowseFilters = {
  quick: NoteQuickFilter;
  types: MobileNoteType[];
  sectionId: string | null;
  organization: 'unsorted' | 'root' | null;
  updated: NoteUpdatedFilter;
  sort: NoteBrowseSort;
};

export const DEFAULT_NOTE_BROWSE_FILTERS: NoteBrowseFilters = {
  quick: 'all',
  types: [],
  sectionId: null,
  organization: null,
  updated: null,
  sort: 'updated',
};

export function countActiveNoteFilters(filters: NoteBrowseFilters) {
  return filters.types.length + Number(Boolean(filters.sectionId || filters.organization || filters.updated)) + Number(filters.sort !== 'updated');
}
