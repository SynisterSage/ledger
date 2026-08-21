import type { AskLedgerInitialContext } from './askLedgerContext';
import { inferAskLedgerAnswerDepth, type AskLedgerAnswerDepth } from './askLedgerAnswerDepth.ts';

type AskLedgerRoutingSource = { resourceType?: string; resourceId?: string };

export type AskLedgerResponseMode = 'conversational' | 'workspace_grounded' | 'follow_up';
export type AskLedgerExecutionMode = 'conversation' | 'ledger_product_help' | 'workspace_lookup' | 'workspace_synthesis' | 'workspace_research' | 'skills';

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
  previousExecutionMode?: AskLedgerExecutionMode;
  previousProductArea?: string;
  previousProductFeature?: string;
  previousSkill?: string;
  resolvedWorkspaceEntities?: AskLedgerRoutingSource[];
};

export type AskLedgerRoute = {
  mode: AskLedgerResponseMode;
  executionMode: AskLedgerExecutionMode;
  retrievalRequired: boolean;
  reusePreviousGroundedContext: boolean;
  reason: string;
  answerDepth: AskLedgerAnswerDepth;
  depthExplicit: boolean;
  diagnostics: {
    productHelpDetected: boolean;
    productAreaDetected?: string;
    productArea?: string;
    productFeature?: string;
    productKnowledgeIds?: string[];
    productKnowledgeTokens?: number;
    productResolutionConfidence?: number;
    productResolutionReason?: string;
    previousExecutionMode?: AskLedgerExecutionMode;
    selectedExecutionMode: AskLedgerExecutionMode;
    contextReused: boolean;
    contextReset: boolean;
    transitionReason: string;
    resolvedFollowUpReference?: string;
    productLanguageDetected: boolean;
    workspaceDataIntentDetected: boolean;
    previousProductHelpContextReusable: boolean;
    workspaceEntityDetected: boolean;
    workspacePossessiveDetected: boolean;
    structuredIntentDetected: boolean;
    followUpReferenceDetected: boolean;
    newWorkspaceFactsRequired: boolean;
    existingGroundedContextReusable: boolean;
    skillSelected: boolean;
    routingConfidence: number;
  };
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const workspaceSignals =
  /\b(?:ledger|workspace|projects?|tasks?|todo|to do|action items?|milestones?|reminders?|meetings?|events?|calendar|notes?|transcripts?|deadlines?|overdue|blocked|blocking|stuck|status|progress|activity|happening|going on|decision|decided|discussed|changed|updates?|follow[- ]?ups?|team members?|integration|slack|github|figma|launch|this week)\b/i;
const capabilitySignals =
  /\b(?:what can you help me with|what can you do|what do you do|what do u do|what does ledger do|what is ledger|who (?:made|built|created) (?:ledger|it)|who is (?:ledger|it) made by|can you help|can you read|can you create|what are skills|how do skills work|what files can you read|what do you support)\b/i;
const casualSignals =
  /^(?:h+i+|hello+|hey+|yo+|thanks?|thank you|thx|good morning|good afternoon|good evening|how are you|whats up|what is up|bye|goodbye|okay|ok|great|nice|cool|got it)[.!?\s]*$/i;
const factualQuestionSignals =
  /^(?:what|whats|when|where|who|which|is|are|did|does|do|has|have|can|how many|how much|how long)\b/i;
const transformationSignals =
  /\b(?:explain|clarify|rewrite|rephrase|shorten|shorter|simplif(?:y|ier)|checklist|summari[sz]e|expand|elaborate|say that|make that|put that)\b/i;
const referenceSignals =
  /\b(?:that|this|it|those|these|the other|what about|and what|how about|anything else|tell me more|go deeper|what else)\b/i;
const continuationSignals =
  /^(?:continue|keep going|try again|another pass|another sweep|do another pass|do another sweep|tell me more|go deeper|what else|anything else)\b/i;
const reasoningFollowUpSignals = /^(?:why|how)\b/i;
const contextReuseSignals = /\b(?:with|using|based on|from)\s+(?:this|that|these|those)\s+(?:context|notes?|summary|answer)\b|\bnot really searching\b|\bwithout (?:search|searching|looking)\b/i;
const explicitExistingResourceSignals = /\b(?:last|latest|newest|recent|what happened|what did|look through|look at|summari[sz]e|review|compare|linked)\b[\s\S]{0,80}\b(?:notes?|meetings?|events?|tasks?|reminders?|projects?|transcripts?)\b/i;
const possessiveWorkspaceSignals = /\b(?:my|our|we|in ledger|in the workspace|this workspace)\b/i;
const structuredIntentSignals = /\b(?:due today|due tomorrow|overdue|next meeting|meetings? (?:today|tomorrow|this week)|last \d+ notes?|how many .*tasks?|who owns|when is .* due|active reminders?|what should i do today|plan my week)\b/i;
const synthesisSignals = /\b(?:summari[sz]e|recap|review|plan|prioriti[sz]e|explain what|tell me what|what did we decide|what happened with|compare (?:this|last) week|patterns .* last .* meetings?)\b/i;
const productAreas = /\b(calendar|notes?|projects?|sidebar|dashboard|settings|reminders?|tasks?|meetings?|teams?|intake|inbox|search|transcri(?:be|ption)|integrations?|github|slack|figma|google drive|drive|apple calendar|apple reminders|browser extension|mcp|slash commands?|smart dates?|people references?|mind ?map|embeds?|skills?)\b/i;
const productLanguage = /\b(?:ledger|feature(?:s)?|page|support(?:s|ed)?|how does|how do i?|what does|what can|can ledger|does ledger|is ledger|available in)\b/i;
const productQuestionSignals = /^(?:what|how|does|do|can|is|are|which|where)\b/i;
const productFollowUpQuestionSignals = /^(?:what\s+does|how\s+does|can\s+it|does\s+it|what\s+about|how\s+about|and\s+what|what\s+else)\b/i;
const productSkillHelpSignals = /\b(?:what|how)\s+(?:does|do)\s+(?:the\s+)?plan\s+my\s+week\s+(?:skill|do)|\bdoes\s+ledger\s+have\s+(?:other\s+)?planning\s+skills?\b/i;
const notesPeopleCapabilitySignals = /\b(?:mention|mentions|people|ppl|person)\b[\s\S]*\bnotes?\b|\bnotes?\b[\s\S]*\b(?:mention|mentions|people|ppl|person)\b/i;
const notesDateCapabilitySignals = /\bhow\s+does\s+(?:that\s+)?date\s+thing\s+work\b/i;
const workspaceDataIntentSignals = /\b(?:my|mine|our|today|yesterday|tomorrow|this\s+(?:task|project|meeting|note|event|reminder)|on my|show|list|find|due|overdue|have i|what did i\s+(?:write|put|save|capture|say|do)|(?:what|which) .* (?:do i have|is due))\b/i;
const researchSignals = /\b(?:across (?:all|the workspace|Atlas)|look through|actually blocking|where .* really stand\b|where .* really stands\b|connect|analy[sz]e .*dependencies|dependencies|compare .* and|compare .* evidence|all the context|contradictions?|cross[- ]resource|biggest .* risks?|keeping .* from moving)\b/i;
const freshFollowUpSignals = /^(?:what happened\b|did (?:she|he|they|it|[a-z][a-z]+)\s+(?:ever\s+)?(?:respond|reply|answer)|what did we say\b|what about\b|when is that due\b)/i;
const responseFactSignals = /\b(?:did|has)\s+(?:she|he|they|[A-Z][a-z]+)\s+(?:ever\s+)?(?:respond|reply|answer)/;
const generalKnowledgeSignals = /^(?:what(?:'s| is)\s+(?:a|an)\s+\w+|how do .* usually work|what(?:'s| is) the difference between)\b/i;
const namedWorkspaceEntity = (message: string) => [...message.matchAll(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][\w-]+)*\b/g)]
  .some((match) => !/^(?:What|When|Where|Who|Which|Why|How|Can|Could|Would|Tell|Show|Did|Does|Do|Is|Are|Has|Have|The|And|That|Explain)$/i.test(match[0]));

const priorTurns = (context: AskLedgerRoutingContext) =>
  Boolean(
    context.previousQuestion ||
      context.previousAnswer ||
      context.recentExchanges?.length ||
      context.previousSources?.length
  );

export const detectAskLedgerProductArea = (message: string) => normalize(message).match(productAreas)?.[1];

const previousProductHelpContext = (context: AskLedgerRoutingContext): boolean => Boolean(
  context.previousExecutionMode === 'ledger_product_help'
    || isLedgerProductHelpQuestion(context.previousQuestion ?? '')
    || (context.recentExchanges ?? []).slice(-1).some((exchange) => isLedgerProductHelpQuestion(exchange.question ?? ''))
);

export const isLedgerProductHelpQuestion = (message: string, context: AskLedgerRoutingContext = {}): boolean => {
  const normalized = normalize(message);
  const hasPriorProductContext = context.previousExecutionMode === 'ledger_product_help' || Boolean(context.previousProductArea);
  const productCapabilityIntent = /\b(?:can|could|does|do|will)\b[\s\S]*\b(?:appear|show|sync|import|connect|support|work|use)\b[\s\S]*\b(?:ledger|workspace|there)\b/i.test(normalized);
  const genericSoftwareQuestion = /\b(?:api|markdown|transcription)\b/i.test(normalized) && !/\bledger\b/i.test(normalized) && !hasPriorProductContext;
  const genericCapabilityQuestion = capabilitySignals.test(normalized) && !/\bledger\b/i.test(normalized) && !productSkillHelpSignals.test(normalized);
  if (!normalized || genericSoftwareQuestion || genericCapabilityQuestion || (workspaceDataIntentSignals.test(normalized) && !productCapabilityIntent && !productSkillHelpSignals.test(normalized))) return false;
  const productWords = productLanguage.test(normalized);
  const productFollowUp: boolean = hasPriorProductContext
    && (referenceSignals.test(normalized) || continuationSignals.test(normalized) || productFollowUpQuestionSignals.test(normalized));
  return Boolean(
    productSkillHelpSignals.test(normalized)
    || notesPeopleCapabilitySignals.test(normalized)
    || notesDateCapabilitySignals.test(normalized)
    || (productWords && (productAreas.test(normalized) || /\bledger\b/i.test(normalized)))
    || (detectAskLedgerProductArea(message) && productQuestionSignals.test(normalized) && /\b(?:feature|page|work|support|view|do|have|use|are|overview|integration|mention|recognize|capture)\b/i.test(normalized))
    || productFollowUp
  );
};

export const routeAskLedgerMessage = (
  message: string,
  context: AskLedgerRoutingContext = {}
): AskLedgerRoute => {
  const normalized = normalize(message);
  const productAreaDetected = detectAskLedgerProductArea(message);
  const productLanguageDetected = productLanguage.test(normalized);
  const workspaceDataIntentDetected = workspaceDataIntentSignals.test(normalized);
  const previousProductHelpContextReusable = previousProductHelpContext(context);
  const productHelpDetected = isLedgerProductHelpQuestion(message, context);
  const previousExecutionMode = context.previousExecutionMode;
  const depthFor = (options: { conversational?: boolean } = {}) =>
    inferAskLedgerAnswerDepth(message, options);
  const withDepth = (
    base: Omit<AskLedgerRoute, 'answerDepth' | 'depthExplicit' | 'executionMode' | 'diagnostics'> & { executionMode?: AskLedgerExecutionMode },
    options: { conversational?: boolean } = {}
  ): AskLedgerRoute => {
    const depth = depthFor(options);
    const workspaceEntityDetected = namedWorkspaceEntity(message) || workspaceSignals.test(normalized);
    const workspacePossessiveDetected = possessiveWorkspaceSignals.test(normalized);
    const structuredIntentDetected = structuredIntentSignals.test(normalized);
    const followUpReferenceDetected = referenceSignals.test(normalized) || continuationSignals.test(normalized);
    const newWorkspaceFactsRequired = Boolean(base.retrievalRequired && (structuredIntentDetected || explicitExistingResourceSignals.test(normalized) || workspaceEntityDetected || (workspacePossessiveDetected && factualQuestionSignals.test(normalized))));
    const inferredMode = base.executionMode
      ?? (context.hasSelectedSkill ? 'skills' : !base.retrievalRequired ? 'conversation' : researchSignals.test(normalized) ? 'workspace_research' : synthesisSignals.test(normalized) ? 'workspace_synthesis' : 'workspace_lookup');
    const contextReused = Boolean(base.reusePreviousGroundedContext)
      || (previousProductHelpContextReusable && inferredMode === 'ledger_product_help' && Boolean(previousExecutionMode));
    const contextReset = Boolean(previousExecutionMode && previousExecutionMode !== inferredMode && !contextReused);
    const resolvedFollowUpReference = followUpReferenceDetected
      ? context.previousProductFeature
        ? `product:${context.previousProductArea ?? 'ledger'}${context.previousProductFeature ? `.${context.previousProductFeature}` : ''}`
        : context.previousSources?.[0]?.resourceId
          ? `workspace:${context.previousSources[0].resourceId}`
          : context.resolvedWorkspaceEntities?.[0]?.resourceId
            ? `workspace:${context.resolvedWorkspaceEntities[0].resourceId}`
            : undefined
      : undefined;
    const transitionReason = !previousExecutionMode
      ? 'initial_route'
      : contextReused
        ? (inferredMode === 'skills' ? 'skill_context_reused' : inferredMode === 'ledger_product_help' ? 'product_context_reused' : 'grounded_context_reused')
        : inferredMode === 'skills'
          ? 'selected_skill'
          : inferredMode === 'ledger_product_help'
            ? previousExecutionMode === 'skills' ? 'skill_to_product_help' : 'explicit_product_question'
            : previousExecutionMode === 'ledger_product_help' && inferredMode.startsWith('workspace_')
              ? 'explicit_workspace_data_request'
              : previousExecutionMode.startsWith('workspace_') && inferredMode === 'conversation'
                ? 'topic_reset_to_conversation'
                : previousExecutionMode !== inferredMode ? 'mode_switch' : 'same_mode_continuation';
    const confidence = base.retrievalRequired
      ? (newWorkspaceFactsRequired ? 0.95 : 0.68)
      : (followUpReferenceDetected || workspaceEntityDetected ? 0.78 : 0.97);
    return {
      ...base,
      executionMode: inferredMode,
      answerDepth: depth.depth,
      depthExplicit: depth.explicit,
      diagnostics: {
        productHelpDetected,
        productAreaDetected,
        productLanguageDetected,
        workspaceDataIntentDetected,
        previousProductHelpContextReusable,
        previousExecutionMode,
        selectedExecutionMode: inferredMode,
        contextReused,
        contextReset,
        transitionReason,
        resolvedFollowUpReference,
        workspaceEntityDetected,
        workspacePossessiveDetected,
        structuredIntentDetected,
        followUpReferenceDetected,
        newWorkspaceFactsRequired,
        existingGroundedContextReusable: Boolean(base.reusePreviousGroundedContext),
        skillSelected: Boolean(context.hasSelectedSkill),
        routingConfidence: confidence,
      },
    };
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
  if (productHelpDetected) {
    return withDepth({
      mode: previousProductHelpContextReusable ? 'follow_up' : 'conversational',
      executionMode: 'ledger_product_help',
      retrievalRequired: false,
      reusePreviousGroundedContext: false,
      reason: /^what\s+(?:does|is)\s+ledger(?:\s+do)?\s*\??$/i.test(message)
        ? 'capability_question'
        : previousProductHelpContextReusable ? 'product_help_context_reuse' : 'ledger_product_help',
    }, { conversational: true });
  }
  const skillContextReusable = previousExecutionMode === 'skills' && Boolean(context.previousSkill || context.previousQuestion);
  if (skillContextReusable && (referenceSignals.test(normalized) || continuationSignals.test(normalized) || reasoningFollowUpSignals.test(normalized))) {
    return withDepth({
      mode: 'follow_up',
      executionMode: 'skills',
      retrievalRequired: false,
      reusePreviousGroundedContext: true,
      reason: 'skill_context_reuse',
    });
  }
  // Workspace-aware requests such as “can you help me plan a meeting?” must
  // not be treated as generic capability questions just because they contain
  // the phrase “can you help”.
  const capabilityOnly = capabilitySignals.test(normalized)
    && !explicitExistingResourceSignals.test(normalized)
    && !structuredIntentSignals.test(normalized)
    && !/\b(?:plan|look|search|find|summari[sz]e|review)\b/i.test(normalized);
  if (capabilityOnly)
    return withDepth(
      {
        mode: 'conversational',
        retrievalRequired: false,
        reusePreviousGroundedContext: false,
        reason: 'capability_question',
      },
      { conversational: true }
    );
  if (priorTurns(context) && (!workspaceDataIntentDetected || contextReuseSignals.test(normalized))) {
    const newFactsRequested = structuredIntentSignals.test(normalized)
      || explicitExistingResourceSignals.test(normalized)
      || freshFollowUpSignals.test(message)
      || responseFactSignals.test(message)
      || (namedWorkspaceEntity(message) && factualQuestionSignals.test(normalized))
      || (possessiveWorkspaceSignals.test(normalized) && factualQuestionSignals.test(normalized))
      || (workspaceSignals.test(normalized) && factualQuestionSignals.test(normalized))
      || (/^(?:what|when|where|who|which|is|are|did|does|do|has|have)\b/i.test(normalized) && /^(?:what|how) about\b/i.test(normalized));
    if (!newFactsRequested && (referenceSignals.test(normalized) || continuationSignals.test(normalized) || reasoningFollowUpSignals.test(normalized) || casualSignals.test(normalized) || !factualQuestionSignals.test(normalized))) {
      const casual = casualSignals.test(normalized);
      return withDepth({
        mode: casual ? 'conversational' : 'follow_up',
        retrievalRequired: false,
        reusePreviousGroundedContext: !casual,
        reason: casual ? 'casual_conversation' : 'grounded_context_reuse',
      });
    }
    if (contextReuseSignals.test(normalized) && !explicitExistingResourceSignals.test(normalized)) {
      return withDepth({
        mode: 'follow_up',
        retrievalRequired: false,
        reusePreviousGroundedContext: true,
        reason: 'grounded_context_reuse',
      });
    }
    if (transformationSignals.test(normalized) && referenceSignals.test(normalized)) {
      return withDepth({
        mode: 'follow_up',
        retrievalRequired: false,
        reusePreviousGroundedContext: true,
        reason: 'previous_answer_transformation',
      });
    }
    if (
      freshFollowUpSignals.test(normalized) ||
      referenceSignals.test(normalized) ||
      continuationSignals.test(normalized) ||
      (reasoningFollowUpSignals.test(normalized) && (workspaceSignals.test(normalized) || namedWorkspaceEntity(message)))
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
  const ambiguousReferenceWithoutContext = /^(?:what about|how about|show me|summari[sz]e|explain|tell me about)\s+(?:that|it|those|these|mine|them)\b/i.test(normalized) && !priorTurns(context);
  const namedEntityOnly = namedWorkspaceEntity(message) && factualQuestionSignals.test(normalized) && !responseFactSignals.test(message) && !workspaceSignals.test(normalized) && !possessiveWorkspaceSignals.test(normalized) && !structuredIntentSignals.test(normalized) && !explicitExistingResourceSignals.test(normalized);
  if (!ambiguousReferenceWithoutContext && !namedEntityOnly && !generalKnowledgeSignals.test(message) && (workspaceSignals.test(normalized) || explicitExistingResourceSignals.test(normalized) || structuredIntentSignals.test(normalized) || synthesisSignals.test(normalized) || researchSignals.test(normalized) || responseFactSignals.test(message) || (workspaceDataIntentDetected && (factualQuestionSignals.test(normalized) || /\b(?:show|list|find)\b/i.test(normalized))) || (namedWorkspaceEntity(message) && factualQuestionSignals.test(normalized)))) {
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
