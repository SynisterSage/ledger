import { mobileRequest } from './client';

import type { MobileTodayResponse } from '@/types/ledger';

export async function getMobileToday(params: { workspaceId?: string; date?: string } = {}) {
  const searchParams = new URLSearchParams();

  if (params.workspaceId) {
    searchParams.set('workspace_id', params.workspaceId);
  }

  if (params.date) {
    searchParams.set('date', params.date);
  }

  const query = searchParams.toString();
  return mobileRequest<MobileTodayResponse>(`/api/mobile/today${query ? `?${query}` : ''}`);
}
