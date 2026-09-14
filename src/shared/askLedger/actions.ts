import type { AskLedgerInitialContext } from '../../types/askLedgerContext.ts';
import type { AskLedgerActionType } from '../../types/askLedgerSkills.ts';
import { toolNameForAskLedgerAction } from './tools.ts';

export type AskLedgerActionRisk = 'read' | 'write' | 'destructive' | 'external';
export type AskLedgerActionStatus = 'pending' | 'created' | 'failed' | 'rejected';

export type AskLedgerActionSourceRef = {
  resourceType: AskLedgerInitialContext['resourceType'];
  resourceId: string;
  title?: string;
};

export type AskLedgerActionProposal = {
  /** Stable UI identity for this proposal in the originating message. */
  id: string;
  /** Existing UI-compatible action identifier. This becomes the tool name later. */
  type: AskLedgerActionType;
  /** Canonical registry name used by native tool-calling adapters. */
  toolName: string;
  payload: Record<string, unknown>;
  sourceMessageId: string;
  risk: AskLedgerActionRisk;
  requiresConfirmation: boolean;
  idempotencyKey: string;
  sourceRefs: AskLedgerActionSourceRef[];
  workspaceId?: string;
  expectedRevisions?: Record<string, string>;
  status?: AskLedgerActionStatus;
  resultResourceId?: string;
  resultTitle?: string;
  error?: string;
};

const actionPolicy: Record<
  AskLedgerActionType,
  Pick<AskLedgerActionProposal, 'risk' | 'requiresConfirmation'>
> = {
  create_task: { risk: 'write', requiresConfirmation: true },
  create_note: { risk: 'write', requiresConfirmation: true },
  create_reminder: { risk: 'write', requiresConfirmation: true },
  update_task_status: { risk: 'write', requiresConfirmation: true },
};

export const getAskLedgerActionPolicy = (type: AskLedgerActionType) => actionPolicy[type];

export const createAskLedgerActionProposal = ({
  type,
  payload,
  sourceMessageId,
  index = 0,
  initialContext,
  sourceRefs = [],
}: {
  type: AskLedgerActionType;
  payload: Record<string, unknown>;
  sourceMessageId: string;
  index?: number;
  initialContext?: AskLedgerInitialContext | null;
  sourceRefs?: AskLedgerActionSourceRef[];
}): AskLedgerActionProposal => {
  const policy = getAskLedgerActionPolicy(type);
  const id = `${sourceMessageId}-action-${index}`;
  const contextRef = initialContext
    ? [
        {
          resourceType: initialContext.resourceType,
          resourceId: initialContext.resourceId,
          title: initialContext.title,
        },
      ]
    : [];
  return {
    id,
    type,
    toolName: toolNameForAskLedgerAction(type),
    payload,
    sourceMessageId,
    ...policy,
    idempotencyKey: `ask-ledger:${id}`,
    sourceRefs: [...contextRef, ...sourceRefs],
    workspaceId: initialContext?.workspaceId,
    status: 'pending',
  };
};

export const normalizeAskLedgerActionProposal = (
  value: unknown,
  options: {
    sourceMessageId: string;
    index?: number;
    initialContext?: AskLedgerInitialContext | null;
  }
): AskLedgerActionProposal | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const type = candidate.type;
  if (
    type !== 'create_task' &&
    type !== 'create_note' &&
    type !== 'create_reminder' &&
    type !== 'update_task_status'
  )
    return null;
  const payload = candidate.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const proposal = createAskLedgerActionProposal({
    type,
    payload: payload as Record<string, unknown>,
    sourceMessageId: options.sourceMessageId,
    index: options.index,
    initialContext: options.initialContext,
    sourceRefs: Array.isArray(candidate.sourceRefs)
      ? candidate.sourceRefs.flatMap((ref) => {
          if (!ref || typeof ref !== 'object') return [];
          const item = ref as Record<string, unknown>;
          return typeof item.resourceType === 'string' && typeof item.resourceId === 'string'
            ? [
                {
                  resourceType: item.resourceType as AskLedgerInitialContext['resourceType'],
                  resourceId: item.resourceId,
                  title: typeof item.title === 'string' ? item.title : undefined,
                },
              ]
            : [];
        })
      : [],
  });
  return {
    ...proposal,
    status:
      candidate.status === 'created' ||
      candidate.status === 'failed' ||
      candidate.status === 'rejected'
        ? candidate.status
        : 'pending',
    resultResourceId:
      typeof candidate.resultResourceId === 'string' ? candidate.resultResourceId : undefined,
    resultTitle: typeof candidate.resultTitle === 'string' ? candidate.resultTitle : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
  };
};

export const validateAskLedgerActionProposal = (
  proposal: AskLedgerActionProposal,
  workspaceId?: string | null
) => {
  const errors: string[] = [];
  const expectedToolName = toolNameForAskLedgerAction(proposal.type);
  if (!proposal.sourceMessageId.trim()) errors.push('The action is missing its source message.');
  if (proposal.toolName !== expectedToolName) errors.push('The action tool does not match its mutation type.');
  if (!proposal.requiresConfirmation) errors.push('A shared Ledger mutation must require confirmation.');
  if (!proposal.idempotencyKey.trim()) errors.push('The action is missing an idempotency key.');
  if (workspaceId && proposal.workspaceId && workspaceId !== proposal.workspaceId)
    errors.push('The action belongs to a different workspace.');
  if (
    proposal.type === 'create_task' ||
    proposal.type === 'create_note' ||
    proposal.type === 'create_reminder'
  ) {
    if (typeof proposal.payload.title !== 'string' || !proposal.payload.title.trim())
      errors.push('A title is required.');
    else if (proposal.payload.title.trim().length > 240) errors.push('The title is too long.');
  }
  if (proposal.type === 'create_reminder' && typeof proposal.payload.remind_at !== 'string')
    errors.push('A reminder date is required.');
  if (
    proposal.type === 'update_task_status' &&
    (typeof proposal.payload.task_id !== 'string' ||
      !['todo', 'in_progress', 'completed'].includes(String(proposal.payload.status)))
  )
    errors.push('The task status update is invalid.');
  return errors;
};
