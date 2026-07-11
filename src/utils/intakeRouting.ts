export type IntakeRoutingSource =
  | 'sidebar'
  | 'browser'
  | 'slack'
  | 'meeting'
  | 'calendar'
  | 'manual'
  | 'integration'
  | 'suggestion';

export type IntakeRoutingType = 'task' | 'note' | 'project' | 'event' | 'reminder' | null;

export type IntakeRoutingDecision = 'direct' | 'intake' | 'validate';

export type ResolveIntakeRoutingInput = {
  source: IntakeRoutingSource;
  requestedType: IntakeRoutingType;
  workspaceType?: 'personal' | 'team' | 'unknown';
  explicitSendToIntake?: boolean;
  requiredFieldsValid?: boolean;
  isExternal?: boolean;
  isSuggested?: boolean;
};

export const resolveIntakeRouting = ({
  source,
  requestedType,
  explicitSendToIntake = false,
  requiredFieldsValid = true,
  isExternal = false,
  isSuggested = false,
}: ResolveIntakeRoutingInput): IntakeRoutingDecision => {
  if (explicitSendToIntake || isExternal || isSuggested) return 'intake';
  if (!requestedType) return 'intake';
  if (!requiredFieldsValid) return 'validate';
  if (source === 'browser' || source === 'slack' || source === 'integration') return 'intake';
  return 'direct';
};
