import type { AskLedgerResourceType } from './askLedgerContext.ts';

export type AIContextResourceRef = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  revision?: string | null;
};

export type AIContextEnvelope = {
  workspaceId: string;
  surface: 'ask_ledger' | 'notes_ask' | 'projects_ask' | 'project_lens' | 'overview_lens';
  selectedResource?: AIContextResourceRef;
  resources: AIContextResourceRef[];
  corpusVersion?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  fingerprint: string;
};

const stableResources = (resources: AIContextResourceRef[]) => [...resources]
  .filter((resource) => resource.resourceId)
  .map((resource) => ({ resourceType: resource.resourceType, resourceId: resource.resourceId, revision: resource.revision ?? null }))
  .sort((left, right) => `${left.resourceType}:${left.resourceId}`.localeCompare(`${right.resourceType}:${right.resourceId}`));

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
};

export const buildAIContextEnvelope = (input: Omit<AIContextEnvelope, 'fingerprint'>): AIContextEnvelope => {
  const resources = stableResources(input.resources);
  const selectedResource = input.selectedResource
    ? stableResources([input.selectedResource])[0]
    : undefined;
  const identity = JSON.stringify({
    workspaceId: input.workspaceId,
    surface: input.surface,
    selectedResource: selectedResource ?? null,
    resources,
    corpusVersion: input.corpusVersion ?? null,
    embeddingModel: input.embeddingModel ?? null,
    embeddingVersion: input.embeddingVersion ?? null,
  });
  return { ...input, resources, ...(selectedResource ? { selectedResource } : {}), fingerprint: `ctx-${hash(identity)}` };
};

export const buildAIContextFingerprint = (input: Omit<AIContextEnvelope, 'fingerprint'>) => buildAIContextEnvelope(input).fingerprint;
