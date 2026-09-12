import { mobileRequest } from './client';

export type MobileConnectedLink = {
  id: string;
  provider?: string | null;
  external_url?: string | null;
  external_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function getMobileConnectedLinks(workspaceId: string) {
  const result = await mobileRequest<MobileConnectedLink[]>(
    `/api/external-references?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  return Array.isArray(result) ? result : [];
}
