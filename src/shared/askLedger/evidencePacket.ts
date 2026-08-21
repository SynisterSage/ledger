import type { AskLedgerContextItem } from '../../types/askLedgerContext.ts';
import type { AskLedgerEvidencePackage } from '../../types/askLedgerResourceContract.ts';
import type { AskLedgerEvidencePacket } from './contracts.ts';

const sourceKeyFor = (resource: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${resource.resourceType}:${resource.resourceId}`;

export const createAskLedgerEvidencePacket = (input: {
  query: string;
  resources: AskLedgerContextItem[];
  evidence: AskLedgerEvidencePackage;
  workspaceId?: string;
  conversationContext?: AskLedgerEvidencePacket['conversationContext'];
  activeSkill?: AskLedgerEvidencePacket['activeSkill'];
  temporalContext?: AskLedgerEvidencePacket['temporalContext'];
}): AskLedgerEvidencePacket => ({
  workspaceId: input.workspaceId,
  query: input.query,
  conversationContext: input.conversationContext,
  activeSkill: input.activeSkill,
  resources: input.resources,
  excerpts: input.evidence.sections.flatMap((section) => section.items.map(({ resource }) => ({ resourceType: resource.resourceType, resourceId: resource.resourceId, text: resource.content, sourceKey: sourceKeyFor(resource) }))),
  entities: [...new Set(input.evidence.sections.flatMap((section) => section.items.flatMap(({ resource }) => [resource.title, resource.projectName]).filter((value): value is string => Boolean(value))))],
  temporalContext: input.temporalContext,
  estimatedTokens: input.evidence.stats.estimatedTokens,
});
