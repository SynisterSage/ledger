import type { AskLedgerContextItem, AskLedgerResourceType } from '../../types/askLedgerContext.ts';
import type { AskLedgerSkillDefinition, AskLedgerSkillId } from '../../types/askLedgerSkills.ts';

export const ASK_LEDGER_NORMALIZATION_VERSION = '1';
export const ASK_LEDGER_CHUNKER_VERSION = '1';

export type AskLedgerResourceContract = Pick<AskLedgerContextItem, 'workspaceId' | 'resourceType' | 'resourceId' | 'title' | 'content' | 'projectId' | 'milestoneId' | 'taskId' | 'noteId' | 'teamId' | 'integrationProvider' | 'integrationResourceType' | 'externalId' | 'projectName' | 'timestamp' | 'dueAt' | 'endAt' | 'updatedAt' | 'provenance'> & {
  sourceMetadata?: Record<string, unknown>;
  attachmentId?: string;
  parentResourceId?: string;
};

export type AskLedgerChunk = {
  workspaceId?: string;
  resourceType: AskLedgerResourceType;
  resourceId: string;
  chunkId: string;
  title: string;
  text: string;
  contentHash?: string;
  normalizationVersion: string;
  chunkerVersion: string;
  metadata?: Record<string, unknown>;
};

export type AskLedgerVectorHit = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  chunkId?: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export interface AskLedgerVectorStore {
  upsert(chunks: AskLedgerChunk[]): Promise<void>;
  remove(resourceIds: string[]): Promise<void>;
  search(vector: number[], limit: number): Promise<AskLedgerVectorHit[]>;
}

export type AskLedgerBudget = {
  candidateLimit: number;
  rerankLimit: number;
  selectedResourceLimit: number;
  evidenceTokenBudget: number;
  contextTokenBudget: number;
  maxItemTokens: number;
  maxTranscriptSegmentsPerParent: number;
};

export const ASK_LEDGER_DESKTOP_BUDGET: AskLedgerBudget = {
  candidateLimit: 40,
  rerankLimit: 20,
  selectedResourceLimit: 12,
  evidenceTokenBudget: 2800,
  contextTokenBudget: 4096,
  maxItemTokens: 600,
  maxTranscriptSegmentsPerParent: 2,
};

export type AskLedgerSkillContract = Pick<AskLedgerSkillDefinition, 'id' | 'name' | 'description' | 'instructions' | 'supportedContextTypes' | 'allowedContextTypes' | 'allowedActions' | 'requiresContext' | 'requiresConfirmation' | 'reasoningPolicy' | 'outputSections' | 'executionContract'> & {
  version?: string;
  retrievalGuidance?: string;
  answerRequirements?: string[];
};

export type AskLedgerSkillSelection = {
  skillId?: AskLedgerSkillId | string;
  skill?: AskLedgerSkillContract;
  reason?: string;
};

export type AskLedgerEvidencePacket = {
  workspaceId?: string;
  query: string;
  conversationContext?: {
    conversationId?: string;
    previousQuestion?: string;
    previousAnswer?: string;
    sourceKeys?: string[];
  };
  activeSkill?: AskLedgerSkillSelection;
  resources: AskLedgerContextItem[];
  excerpts: Array<{ resourceType: AskLedgerResourceType; resourceId: string; text: string; sourceKey: string }>;
  entities: string[];
  temporalContext?: { start?: string; end?: string; timezone?: string };
  estimatedTokens: number;
  normalizationVersion?: string;
  chunkerVersion?: string;
};
