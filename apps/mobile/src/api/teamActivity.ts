import { mobileRequest } from './client';

function workspaceHeaders(workspaceId: string) {
  return { 'x-workspace-id': workspaceId };
}

export function deleteMobileTeamActivity(workspaceId: string, auditLogId: string) {
  return mobileRequest<{ deleted: number }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/audit-log/${encodeURIComponent(auditLogId)}`,
    { method: 'DELETE', headers: workspaceHeaders(workspaceId) },
  );
}

export function deleteAllMobileTeamActivity(workspaceId: string) {
  return mobileRequest<{ deleted: number }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/audit-log`,
    { method: 'DELETE', headers: workspaceHeaders(workspaceId) },
  );
}
