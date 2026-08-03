import { mobileRequest } from './client';

import type { MobileSearchResult } from '@/types/ledger';

export async function searchMobileLedger(workspaceId: string, query: string) {
  const params = new URLSearchParams({
    q: query,
    workspace_id: workspaceId,
  });

  return mobileRequest<MobileSearchResult[]>(`/api/mobile/search?${params.toString()}`);
}

export async function searchMobileNotes(workspaceId: string, query: string) {
  const results = await searchMobileLedger(workspaceId, query);
  return results.filter((result) => ['note', 'transcript', 'meeting_metadata'].includes(String((result as { type?: string }).type)));
}
