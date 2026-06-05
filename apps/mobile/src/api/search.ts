import { mobileRequest } from './client';

import type { MobileSearchResult } from '@/types/ledger';

export async function searchMobileLedger(workspaceId: string, query: string) {
  const params = new URLSearchParams({
    q: query,
    workspace_id: workspaceId,
  });

  return mobileRequest<MobileSearchResult[]>(`/api/mobile/search?${params.toString()}`);
}
