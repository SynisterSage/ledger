import type { AskLedgerInitialContext } from '../../types/askLedgerContext.ts';
import type { AskLedgerSkillDefinition } from '../../types/askLedgerSkills.ts';
import type { AskLedgerSkillContract } from './contracts.ts';

export const toAskLedgerSkillContract = (skill: AskLedgerSkillDefinition, version = '1'): AskLedgerSkillContract => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  instructions: skill.instructions,
  supportedContextTypes: skill.supportedContextTypes,
  allowedContextTypes: skill.allowedContextTypes,
  allowedActions: skill.allowedActions,
  requiresContext: skill.requiresContext,
  requiresConfirmation: skill.requiresConfirmation,
  reasoningPolicy: skill.reasoningPolicy,
  outputSections: skill.outputSections,
  executionContract: skill.executionContract,
  version,
});

export const validateAskLedgerSkillContext = (skill: AskLedgerSkillContract, context?: AskLedgerInitialContext | null) => {
  if (skill.executionContract?.resources.length === 0) return 'This skill has no searchable resource scope.';
  if (context && !skill.supportedContextTypes.includes(context.resourceType)) return `${skill.name} does not support ${context.resourceType} context.`;
  if (context && (!context.resourceId.trim() || !context.title.trim())) return 'Skill context is incomplete.';
  return null;
};

export const buildAskLedgerSkillSelection = (skill?: AskLedgerSkillDefinition, reason?: string) => skill ? ({ skillId: skill.id, skill: toAskLedgerSkillContract(skill), reason }) : undefined;
