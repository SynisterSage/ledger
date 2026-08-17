export type AskLedgerAnswerDepth = 'brief' | 'standard' | 'detailed';

export type AskLedgerAnswerDepthDecision = {
  depth: AskLedgerAnswerDepth;
  explicit: boolean;
  reason: string;
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const detailedSignals =
  /\b(?:in detail|detailed|thorough(?:ly)?|walk me through|explain why|explain how|how did we|get to this decision|analy[sz]e|risks?|dependencies|go deeper|deep dive)\b/i;
const briefSignals =
  /\b(?:short(?:er)?|brief(?:ly)?|one sentence|quick(?:ly)?|just tell me|key takeaway|simpl(?:e|ify|er|y)|short version|brief version)\b/i;
const simpleFactSignals =
  /^(?:is|are|did|when is|when are|who is|who are|what is the (?:status|deadline|due date)|whats the (?:status|deadline|due date)|what(?:s| is) (?:the )?[a-z0-9 ]*status)\b/i;
const synthesisSignals =
  /\b(?:blocking|blocked|changed|summary|summari[sz]e|where are we|what came out|review|moving|needs? attention|what happened|status of)\b/i;

export const inferAskLedgerAnswerDepth = (
  message: string,
  options: { conversational?: boolean } = {}
): AskLedgerAnswerDepthDecision => {
  const normalized = normalize(message);
  if (briefSignals.test(normalized))
    return { depth: 'brief', explicit: true, reason: 'explicit_brevity_request' };
  if (options.conversational)
    return { depth: 'brief', explicit: false, reason: 'casual_or_capability_request' };
  if (detailedSignals.test(normalized) || /^(?:why|how)\b/i.test(normalized))
    return { depth: 'detailed', explicit: true, reason: 'explicit_detail_request' };
  if (simpleFactSignals.test(normalized) && !synthesisSignals.test(normalized))
    return { depth: 'brief', explicit: false, reason: 'simple_factual_question' };
  return {
    depth: 'standard',
    explicit: false,
    reason: synthesisSignals.test(normalized) ? 'synthesis_question' : 'substantive_default',
  };
};
