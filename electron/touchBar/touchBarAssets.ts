import type { LedgerActionIcon } from '../actions/ledgerActionTypes.ts';

const iconPaths: Record<LedgerActionIcon, string> = {
  task: '<path d="M4 5h16v14H4z"/><path d="m8 12 2 2 5-5"/>',
  note: '<path d="M5 3h14v18l-7-4-7 4z"/><path d="M8 8h8M8 11h8"/>',
  event: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  project: '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/>',
  previous: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m10 5 7 7-7 7"/>',
  today: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  lens: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M10 7v6M7 10h6"/>',
};

export function getTouchBarIconAsset(icon: LedgerActionIcon): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[icon]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function hasTouchBarIcon(icon: string): icon is LedgerActionIcon {
  return icon in iconPaths;
}
