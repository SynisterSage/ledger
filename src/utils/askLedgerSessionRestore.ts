export type AskLedgerSessionRestoreRecord = {
  id: string;
  updatedAt: string;
  initialContext?: {
    resourceType?: string;
    resourceId?: string;
  };
  messages?: unknown[];
};

export type AskLedgerResourceIdentity = {
  resourceType: string;
  resourceId: string;
};

const hasLocalFileAttachment = (message: unknown, resourceId: string) => {
  if (!message || typeof message !== 'object') return false;
  const attachments = (message as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return false;
  return attachments.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const attachment = entry as { kind?: unknown; attachment?: { localFileId?: unknown } };
    return attachment.kind === 'file' && attachment.attachment?.localFileId === resourceId;
  });
};

export const mergeAskLedgerSessions = <T extends AskLedgerSessionRestoreRecord>(
  sessions: T[]
) => {
  const merged = new Map<string, T>();
  for (const session of sessions) {
    const existing = merged.get(session.id);
    if (!existing || Date.parse(session.updatedAt) > Date.parse(existing.updatedAt)) {
      merged.set(session.id, session);
    }
  }
  return [...merged.values()];
};

export const sessionMatchesAskLedgerResource = (
  session: AskLedgerSessionRestoreRecord,
  resource: AskLedgerResourceIdentity
) =>
  (session.initialContext?.resourceType === resource.resourceType &&
    session.initialContext?.resourceId === resource.resourceId) ||
  (resource.resourceType === 'attachment' &&
    (session.messages ?? []).some((message) => hasLocalFileAttachment(message, resource.resourceId)));

export const newestAskLedgerSessionForResource = <T extends AskLedgerSessionRestoreRecord>(
  sessions: T[],
  resource: AskLedgerResourceIdentity
) =>
  mergeAskLedgerSessions(sessions)
    .filter((session) => sessionMatchesAskLedgerResource(session, resource))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
