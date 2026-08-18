import type { AskLedgerContextItem, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';

export type RetrievalOperation = 'lookup' | 'summarize' | 'compare' | 'analyze' | 'plan';
export type RetrievalOrdering = 'relevance' | 'newest' | 'oldest';

export type RetrievalPlan = {
  operation: RetrievalOperation;
  primaryResourceTypes: AskLedgerResourceType[];
  entityQuery?: string;
  containerQuery?: string;
  ordering: RetrievalOrdering;
  requestedCount?: number;
  semanticQuery: string;
  expandRelatedContext: boolean;
  resolvedContainer?: { query: string; title?: string; confidence: number };
};

const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const countWords = /\b(?:last|latest|newest|recent|first|oldest|past)\s+(\d+|few|several)\b/i;
const lastWorkdaySignals = /\b(?:last|final)\s+(?:day|workday)\b|\blast\s+day\s+(?:working|at work)\b/i;

const requestedCountFor = (question: string) => {
  const match = question.match(countWords);
  if (!match) return undefined;
  if (match[1] === 'few' || match[1] === 'several') return 3;
  const count = Number(match[1]);
  return Number.isFinite(count) ? Math.max(1, Math.min(20, count)) : undefined;
};

const resourceTypesFor = (question: string): AskLedgerResourceType[] => {
  const normalized = normalize(question);
  if (lastWorkdaySignals.test(normalized)) return ['event'];
  if (/\bmeeting notes?\b|\bnotes?\b/.test(normalized)) return ['note'];
  if (/\bevents?\b/.test(normalized) || ( /\bmeetings?\b/.test(normalized) && /\b(last|latest|newest|recent|what happened|what did|look through|look at|summari[sz]e|review|compare|linked|with)\b/.test(normalized))) return ['event'];
  if (/\btasks?\b/.test(normalized)) return ['task'];
  if (/\breminders?\b/.test(normalized)) return ['reminder'];
  if (/\bmilestones?\b/.test(normalized)) return ['milestone'];
  if (/\bprojects?\b/.test(normalized)) return ['project'];
  if (/\btranscripts?\b/.test(normalized)) return ['transcript'];
  return [];
};

const containerQueryFor = (question: string, primaryResourceTypes: AskLedgerResourceType[]) => {
  if (!primaryResourceTypes.includes('note')) return undefined;
  const match = question.match(/\b(?:in|from|within|inside|through)\s+(?:my\s+)?(.+?)(?=\s*,?\s*(?:last|latest|newest|recent|first|oldest|past)\b|\s+and\s+(?:summarize|review|compare)|\s+to\s+(?:summarize|review)|$)/i);
  if (!match) return undefined;
  const candidate = match[1].replace(/\bfolder\b|\bcollection\b/gi, '').replace(/\s+/g, ' ').trim();
  return candidate.length >= 3 ? candidate : undefined;
};

const entityQueryFor = (question: string, primaryResourceTypes: AskLedgerResourceType[]) => {
  if (primaryResourceTypes.includes('event') && lastWorkdaySignals.test(question)) {
    const match = question.match(/\b(?:at|for|with)\s+(?:my\s+)?([A-Z][\w-]*)/);
    return match?.[1]?.trim();
  }
  if (primaryResourceTypes.includes('project')) {
    const namedProject = question.match(/\b(?:my|the)\s+(.+?)\s+projects?\b/i);
    if (namedProject?.[1]) return namedProject[1].trim();
    const match = question.match(/\bproject\s+(.+?)(?=\s+(?:and|to|that|where|what|is|has)\b|[,?.]|$)/i);
    return match?.[1]?.trim();
  }
  const withMatch = question.match(/\b(?:with|about|for)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/);
  return withMatch?.[1]?.trim();
};

export const buildRetrievalPlan = (question: string): RetrievalPlan => {
  const primaryResourceTypes = resourceTypesFor(question);
  const isLastWorkday = lastWorkdaySignals.test(question);
  const entityQuery = entityQueryFor(question, primaryResourceTypes);
  const ordering: RetrievalOrdering = /\b(oldest|first)\b/i.test(question) ? 'oldest' : /\b(last|latest|newest|recent|past)\b/i.test(question) || isLastWorkday ? 'newest' : 'relevance';
  const operation: RetrievalOperation = /\b(compare|versus|vs\.?|difference)\b/i.test(question)
    ? 'compare'
    : /\b(summarize|summary|recap|look through|review)\b/i.test(question)
      ? 'summarize'
      : /\b(analy[sz]e|where things stand|what changed|blocking|blocked)\b/i.test(question)
        ? 'analyze'
        : /\b(plan|prioritize|what should)\b/i.test(question) ? 'plan' : 'lookup';
  const containerQuery = containerQueryFor(question, primaryResourceTypes);
  return {
    operation,
    primaryResourceTypes,
    entityQuery,
    containerQuery,
    ordering,
    requestedCount: isLastWorkday ? 1 : requestedCountFor(question),
    semanticQuery: question.trim(),
    expandRelatedContext: Boolean(primaryResourceTypes.length && (operation !== 'lookup' || containerQuery || requestedCountFor(question) || (primaryResourceTypes.includes('project') && entityQuery)) && !isLastWorkday),
  };
};

export const resourceDate = (item: AskLedgerContextItem) => {
  const parsed = Date.parse(item.updatedAt ?? item.timestamp ?? item.dueAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizedText = normalize;

export const matchesRetrievalScope = (item: AskLedgerContextItem, plan: RetrievalPlan) => {
  if (plan.primaryResourceTypes.length && !plan.primaryResourceTypes.includes(item.resourceType)) return false;
  const query = plan.containerQuery
    ? normalize(plan.containerQuery).replace(/\bnotes?\b/g, ' ').replace(/\s+/g, ' ').trim()
    : plan.entityQuery ? normalize(plan.entityQuery) : '';
  if (!query) return true;
  const haystack = normalize(`${item.containerName ?? ''} ${item.title} ${item.content} ${item.projectName ?? ''} ${item.provenance ?? ''}`);
  const queryTokens = query.split(' ').filter((token) => token.length > 2);
  return queryTokens.length > 0 && queryTokens.every((token) => haystack.includes(token));
};
