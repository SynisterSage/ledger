import type { AskLedgerInitialContext } from './askLedgerContext';
import { inferAskLedgerAnswerDepth, type AskLedgerAnswerDepth } from './askLedgerAnswerDepth.ts';

type AskLedgerRoutingSource = { resourceType?: string; resourceId?: string };

export type AskLedgerResponseMode = 'conversational' | 'workspace_grounded' | 'follow_up';

export type AskLedgerRoutingContext = {
  previousQuestion?: string;
  previousAnswer?: string;
  previousSources?: AskLedgerRoutingSource[];
  recentExchanges?: Array<{
    question?: string;
    answer?: string;
    sources?: AskLedgerRoutingSource[];
  }>;
  explicitContext?: AskLedgerInitialContext;
  hasSelectedSkill?: boolean;
  attachmentCount?: number;
};

export type AskLedgerRoute = {
  mode: AskLedgerResponseMode;
  retrievalRequired: boolean;
  reusePreviousGroundedContext: boolean;
  reason: string;
  answerDepth: AskLedgerAnswerDepth;
  depthExplicit: boolean;
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const workspaceSignals =
  /\b(?:ledger|workspace|project|task|todo|to do|action item|milestone|reminder|meeting|event|calendar|note|transcript|deadline|overdue|blocked|blocking|stuck|status|progress|activity|decision|decided|discussed|changed|updates?|follow[- ]?up|team members?|integration|slack|github|figma)\b/i;
const capabilitySignals =
  /\b(?:what can you help me with|what can you do|can you help|can you read|can you create|what are skills|how do skills work|what files can you read|what do you support)\b/i;
const casualSignals =
  /^(?:hi|hello|hey|yo|thanks?|thank you|thx|good morning|good afternoon|good evening|how are you|whats up|what is up|bye|goodbye|okay|ok|great|nice|cool|got it)[.!?\s]*$/i;
const factualQuestionSignals =
  /^(?:what|when|where|who|which|is|are|did|does|do|has|have|can|how many|how much|how long)\b/i;
const transformationSignals =
  /\b(?:explain|clarify|rewrite|rephrase|shorten|shorter|simplif(?:y|ier)|checklist|summari[sz]e|expand|elaborate|say that|make that|put that)\b/i;
const referenceSignals =
  /\b(?:that|this|it|those|these|the other|what about|and what|how about|anything else|tell me more|go deeper|what else)\b/i;
const continuationSignals =
  /^(?:continue|keep going|try again|another pass|another sweep|do another pass|do another sweep|tell me more|go deeper|what else|anything else)\b/i;
const reasoningFollowUpSignals = /^(?:why|how)\b/i;

const priorTurns = (context: AskLedgerRoutingContext) =>
  Boolean(
    context.previousQuestion ||
      context.previousAnswer ||
      context.recentExchanges?.length ||
      context.previousSources?.length
  );

export const routeAskLedgerMessage = (
  message: string,
  context: AskLedgerRoutingContext = {}
): AskLedgerRoute => {
  const normalized = normalize(message);
  const depthFor = (options: { conversational?: boolean } = {}) =>
    inferAskLedgerAnswerDepth(message, options);
  const withDepth = (
    base: Omit<AskLedgerRoute, 'answerDepth' | 'depthExplicit'>,
    options: { conversational?: boolean } = {}
  ): AskLedgerRoute => {
    const depth = depthFor(options);
    return { ...base, answerDepth: depth.depth, depthExplicit: depth.explicit };
  };
  const forcedGrounding = Boolean(
    context.hasSelectedSkill || context.explicitContext || (context.attachmentCount ?? 0) > 0
  );
  if (forcedGrounding) {
    return withDepth({
      mode: 'workspace_grounded',
      retrievalRequired: true,
      reusePreviousGroundedContext: false,
      reason: context.hasSelectedSkill
        ? 'selected_skill'
        : context.explicitContext
        ? 'explicit_context'
        : 'attachment',
    });
  }

  if (!normalized)
    return withDepth(
      {
        mode: 'conversational',
        retrievalRequired: false,
        reusePreviousGroundedContext: false,
        reason: 'empty_or_non_factual',
      },
      { conversational: true }
    );
  if (capabilitySignals.test(normalized))
    return withDepth(
      {
        mode: 'conversational',
        retrievalRequired: false,
        reusePreviousGroundedContext: false,
        reason: 'capability_question',
      },
      { conversational: true }
    );
  if (priorTurns(context)) {
    if (transformationSignals.test(normalized) && referenceSignals.test(normalized)) {
      return withDepth({
        mode: 'follow_up',
        retrievalRequired: false,
        reusePreviousGroundedContext: true,
        reason: 'previous_answer_transformation',
      });
    }
    if (
      referenceSignals.test(normalized) ||
      continuationSignals.test(normalized) ||
      reasoningFollowUpSignals.test(normalized) ||
      workspaceSignals.test(normalized)
    ) {
      return withDepth({
        mode: 'follow_up',
        retrievalRequired: true,
        reusePreviousGroundedContext: continuationSignals.test(normalized),
        reason: referenceSignals.test(normalized)
          ? 'referential_workspace_follow_up'
          : continuationSignals.test(normalized)
          ? 'grounded_continuation'
          : reasoningFollowUpSignals.test(normalized)
          ? 'reasoning_workspace_follow_up'
          : 'workspace_follow_up',
      });
    }
  }
  if (
    workspaceSignals.test(normalized) ||
    (factualQuestionSignals.test(normalized) && !casualSignals.test(normalized))
  ) {
    return withDepth({
      mode: 'workspace_grounded',
      retrievalRequired: true,
      reusePreviousGroundedContext: false,
      reason: 'workspace_fact_or_entity',
    });
  }
  return withDepth(
    {
      mode: 'conversational',
      retrievalRequired: false,
      reusePreviousGroundedContext: false,
      reason: 'non_workspace_request',
    },
    { conversational: true }
  );
};
