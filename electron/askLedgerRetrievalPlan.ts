import type { AskLedgerContextItem, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import type { AskLedgerIntegrationSource } from './askLedgerIntegrationRetrieval.ts';

export type RetrievalOperation = 'lookup' | 'summarize' | 'compare' | 'analyze' | 'plan';
export type RetrievalOrdering = 'relevance' | 'newest' | 'oldest';

export type RetrievalStrategies = {
  semantic: boolean;
  lexical: boolean;
  exactEntity: boolean;
  structured: boolean;
};

export type RetrievalStructuredConstraints = {
  horizon?: 'today' | 'long_term';
  statuses?: string[];
  openOnly?: boolean;
  overdue?: boolean;
  dueAfter?: string;
  dueBefore?: string;
  projectIds?: string[];
  read?: boolean;
  teamId?: string;
  teamIds?: string[];
  assigneeIds?: string[];
  sourceLabel?: string;
  attentionOnly?: boolean;
};

export type RetrievalPlan = {
  operation: RetrievalOperation;
  primaryResourceTypes: AskLedgerResourceType[];
  entityQuery?: string;
  containerQuery?: string;
  ordering: RetrievalOrdering;
  requestedCount?: number;
  semanticQuery: string;
  expandRelatedContext: boolean;
  retrievalStrategies: RetrievalStrategies;
  structuredConstraints: RetrievalStructuredConstraints;
  resolvedContainer?: { query: string; title?: string; confidence: number };
  integrationProviders?: AskLedgerIntegrationSource[];
  integrationRequested?: boolean;
};

const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const countWords = /\b(?:last|latest|newest|recent|first|oldest|past)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|few|several)\b/i;
const countWordValues: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const lastWorkdaySignals = /\b(?:last|final)\s+(?:day|workday)\b|\blast\s+day\s+(?:working|at work)\b/i;

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const isoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const requestedCountFor = (question: string) => {
  const match = question.match(countWords);
  if (!match) return undefined;
  if (match[1] === 'few' || match[1] === 'several') return 3;
  if (countWordValues[match[1].toLowerCase()]) return countWordValues[match[1].toLowerCase()];
  const count = Number(match[1]);
  return Number.isFinite(count) ? Math.max(1, Math.min(20, count)) : undefined;
};

const integrationProvidersFor = (question: string): AskLedgerIntegrationSource[] => {
  const normalized = normalize(question);
  const providers: AskLedgerIntegrationSource[] = [];
  if (/\bslack\b/.test(normalized)) providers.push('slack');
  if (/\bgithub\b|\bgithub work\b|\bprs?\b|\bpull requests?\b/.test(normalized)) providers.push('github');
  if (/\bfigma\b/.test(normalized)) providers.push('figma');
  if (/\b(?:google )?drive\b|\bdocs?\b/.test(normalized)) providers.push('google_drive');
  if (/\bgoogle calendar\b/.test(normalized)) providers.push('google_calendar');
  if (/\bapple calendar\b|\bcaldav\b/.test(normalized)) providers.push('apple_calendar');
  if (/\bapple reminders?\b/.test(normalized)) providers.push('apple_reminders');
  if (/\bmcp\b/.test(normalized)) providers.push('mcp');
  return [...new Set(providers)];
};

const resourceTypesFor = (question: string): AskLedgerResourceType[] => {
  const normalized = normalize(question);
  // A bounded recent-note request is authoritative even when the same
  // sentence also mentions meeting preparation or actions.
  if (/\b(?:last|latest|newest|recent|past)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|few|several)?\s*notes?\b/.test(normalized)) return ['note'];
  const linkedTeamContext = /\b(?:teamspaces?|teams?|circle)\b/.test(normalized)
    && /\b(?:notes?|tasks?|actions?|projects?|milestones?|reminders?|events?|activity|work)\b/.test(normalized)
    && /\b(?:tied|linked|connected|associated|related|belong|with|for)\b/.test(normalized);
  if (linkedTeamContext) return ['note', 'team', 'person', 'project', 'task', 'milestone', 'reminder', 'event'];
  if (/\b(?:teamspaces?|teams?|circle)\b/.test(normalized) && /\b(?:people|persons?|anyone|members?|tasks?|actions?|workload|active|open|what .* have)\b/.test(normalized)) {
    return ['team', 'person', 'task', 'milestone', 'reminder', 'event', 'project'];
  }
  if (/\bacross\s+ledger\b/.test(normalized) && /\b(?:slack|github|figma|drive|calendar)\b/.test(normalized)) return ['project', 'external'];
  if (/\b(?:slack|github|figma|google drive|drive docs?|google calendar|apple calendar|apple reminders?|mcp)\b/.test(normalized)) return ['external'];
  if (/\bunread\s+(?:notifications?|alerts?)\b/.test(normalized)) return ['notification'];
  if (/\bnotifications?\b/.test(normalized)) return ['notification'];
  if (/\b(?:activity|what changed|changes|happening|circle alerts?|teamspace alerts?)\b/.test(normalized)) return ['activity'];
  if (/\bwhat needs my attention\b/.test(normalized)) return ['notification', 'activity', 'task', 'milestone', 'reminder'];
  if (lastWorkdaySignals.test(normalized)) return ['event'];
  const broadMeetingSearch = /\bmeetings?\b/.test(normalized)
    && !/\bmeeting notes?\b/.test(normalized)
    && !/\b(?:last|latest|newest|recent|first|oldest)\s+(?:\d+\s+)?meetings?\b/.test(normalized)
    && !/\bwhat happened in\b/.test(normalized);
  if (/\bmeetings?\b/.test(normalized) && /\b(?:next steps?|follow[- ]?ups?|action items?|what should i do)\b/.test(normalized)) return ['event', 'note', 'task', 'milestone', 'reminder'];
  if (broadMeetingSearch) return ['event', 'note'];
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
  if (!primaryResourceTypes.includes('note') || !/\bnotes?\b|\bfolder\b|\bcollection\b/i.test(question)) return undefined;
  // "look through the last three notes" is a recency/count request, not a
  // folder or collection query.
  if (/\b(?:through|in|from|within|inside)\s+(?:my\s+)?(?:last|latest|newest|recent|past)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|few|several)?\s*notes?\b/i.test(question)) return undefined;
  const explicitFolder = question.match(
    /\bfolder\s+(?:called\s+|named\s+)?([a-z0-9][a-z0-9_-]*(?:\s+[a-z0-9][a-z0-9_-]*){0,4})(?=\s*(?:[,.;?]|\band\b|\bhow\s+many\b|\b(?:last|latest|newest|recent|first|oldest|past)\b|$))/i
  );
  if (explicitFolder?.[1]) {
    const candidate = explicitFolder[1].trim();
    if (candidate.length >= 3) return candidate;
  }
  const match = question.match(/\b(?:in|from|within|inside|through)\s+(?:my\s+)?(.+?)(?=\s*,?\s*(?:last|latest|newest|recent|first|oldest|past)\b|\s+and\s+(?:summarize|review|compare)|\s+to\s+(?:summarize|review)|$)/i);
  if (!match) return undefined;
  const candidate = match[1].replace(/\bfolder\b|\bcollection\b/gi, '').replace(/\s+/g, ' ').trim();
  return candidate.length >= 3 ? candidate : undefined;
};

const entityQueryFor = (question: string, primaryResourceTypes: AskLedgerResourceType[]) => {
  if (primaryResourceTypes.includes('team') || primaryResourceTypes.includes('person')) {
    const namedTeam = question.match(/\b(?:teamspace|team)\s+(?:named|called)\s+([A-Za-z][\w-]*)|\b(?:teamspace|team)\s+([A-Za-z][\w-]*)/i);
    const reversedTeam = question.match(/\b([A-Za-z][\w-]*)\s+(?:teamspace|team)\b/i);
    const teamName = [namedTeam?.[1], namedTeam?.[2], reversedTeam?.[1]]
      .find((candidate) => candidate && !/^(?:this|that|the|my|our|circle|have|has|open|tasks?|actions?)$/i.test(candidate));
    if (teamName) return teamName.trim();
  }
  if (primaryResourceTypes.includes('event') && lastWorkdaySignals.test(question)) {
    const match = question.match(/\b(?:at|for|with)\s+(?:my\s+)?([A-Z][\w-]*)/);
    return match?.[1]?.trim();
  }
  if (primaryResourceTypes.includes('event') && /\bmeetings?\b/i.test(question)) {
    const upcomingNamedMeeting = question.match(/\b(?:next|upcoming|latest|recent|last)\s+([a-z0-9][\w-]*)\s+meetings?\b/i);
    if (upcomingNamedMeeting?.[1] && !/^(?:the|my|our|\d+)$/i.test(upcomingNamedMeeting[1])) return upcomingNamedMeeting[1].trim();
    const match = question.match(/\b(?:my\s+(?:latest|recent|last)|my|the|latest|recent|last|yesterday'?s)\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*)?)\s+meetings?\b/i);
    const candidate = match?.[1]?.trim();
    if (candidate && !/^(?:last|latest|newest|recent|upcoming|calendar|work)(?:\s+\d+)?$/i.test(candidate) && !/^\d+$/.test(candidate)) return candidate;
  }
  if (primaryResourceTypes.includes('project')) {
    const namedProject = question.match(/\b(?:my|the)\s+(.+?)\s+projects?\b/i);
    if (namedProject?.[1]) return namedProject[1].trim();
    const match = question.match(/\bproject\s+(.+?)(?=\s+(?:and|to|that|where|what|is|has)\b|[,?.]|$)/i);
    return match?.[1]?.trim();
  }
  // In compound questions the primary type can be a child resource even
  // though the authoritative entity is the named project.
  if (primaryResourceTypes.some((type) => ['task', 'milestone', 'reminder', 'event', 'note'].includes(type))) {
    const searchEntity = question.match(/\b(?:with|containing|contains|mentions?|about)\s+([A-Za-z][\w-]*)\b/i);
    if (searchEntity?.[1] && !/^(?:my|our|the|this|that|its|their)$/i.test(searchEntity[1])) return searchEntity[1].trim();
    const namedProject = question.match(/\b(?:for|about|on)\s+(?:my|the)\s+(.+?)\s+projects?\b/i);
    if (namedProject?.[1]) return namedProject[1].trim();
  }
  if (primaryResourceTypes.some((type) => ['task', 'milestone', 'reminder', 'event', 'note'].includes(type))) {
    const typedEntity = question.match(/\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)\s+(?:tasks?|milestones?|reminders?|events?|meetings?|notes?)\b/);
    if (typedEntity?.[1]) return typedEntity[1].trim();
  }
  const withMatch = question.match(/\b(?:with|about|for)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/);
  return withMatch?.[1]?.trim();
};

export const buildRetrievalPlan = (question: string, now = new Date()): RetrievalPlan => {
  const primaryResourceTypes = resourceTypesFor(question);
  const isLastWorkday = lastWorkdaySignals.test(question);
  const entityQuery = entityQueryFor(question, primaryResourceTypes);
  const normalizedQuestion = normalize(question);
  const integrationProviders = integrationProvidersFor(question);
  const taskQuery = primaryResourceTypes.includes('task') || /\btasks?\b/.test(normalizedQuestion);
  const structuredConstraints: RetrievalStructuredConstraints = {};
  if (/\bunread\b/.test(normalizedQuestion) && primaryResourceTypes.includes('notification')) structuredConstraints.read = false;
  if (/\bread\b/.test(normalizedQuestion) && primaryResourceTypes.includes('notification') && !/unread/.test(normalizedQuestion)) structuredConstraints.read = true;
  // "Important updates" is a recent-update request, not a strict alert
  // filter. Activity records often have no priority/severity field, so
  // treating the adjective as attentionOnly can discard the entire activity
  // corpus before recent-update ranking runs.
  if (/\b(?:attention|high priority|urgent)\b/.test(normalizedQuestion)) structuredConstraints.attentionOnly = true;
  if (/\bcircle\b/.test(normalizedQuestion) && !(/\b(?:people|persons?|anyone|members?|tasks?|actions?|workload|active)\b/.test(normalizedQuestion))) structuredConstraints.sourceLabel = 'Circle';
  if (taskQuery && /\btoday\b/.test(normalizedQuestion)) structuredConstraints.horizon = 'today';
  if (taskQuery && /\blong[- ]term\b|\blong term work\b/.test(normalizedQuestion)) structuredConstraints.horizon = 'long_term';
  if (/\boverdue\b|\bover due\b/.test(normalizedQuestion)) {
    structuredConstraints.overdue = true;
    structuredConstraints.openOnly = true;
  }
  if (/\b(?:open|active|incomplete|unfinished|outstanding)\b/.test(normalizedQuestion)) structuredConstraints.openOnly = true;
  if (/\b(?:completed|complete|done|finished)\b/.test(normalizedQuestion)) structuredConstraints.statuses = ['completed', 'complete', 'done', 'finished'];
  if (/\btoday\b/.test(normalizedQuestion) && !taskQuery) {
    structuredConstraints.dueAfter = isoDate(startOfDay(now));
    structuredConstraints.dueBefore = isoDate(startOfDay(now));
  } else if (/\byesterday\b/.test(normalizedQuestion)) {
    const yesterday = addDays(startOfDay(now), -1);
    structuredConstraints.dueAfter = isoDate(yesterday);
    structuredConstraints.dueBefore = isoDate(yesterday);
  } else if (/\blast week\b/.test(normalizedQuestion)) {
    const start = startOfDay(now);
    const day = start.getDay();
    const thisWeek = addDays(start, -day);
    structuredConstraints.dueAfter = isoDate(addDays(thisWeek, -7));
    structuredConstraints.dueBefore = isoDate(addDays(thisWeek, -1));
  } else if (/\bthis week\b/.test(normalizedQuestion)) {
    const start = startOfDay(now);
    const thisWeek = addDays(start, -start.getDay());
    structuredConstraints.dueAfter = isoDate(thisWeek);
    structuredConstraints.dueBefore = isoDate(addDays(thisWeek, 6));
  } else if (/\bthis month\b/.test(normalizedQuestion)) {
    structuredConstraints.dueAfter = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    structuredConstraints.dueBefore = isoDate(endOfMonth(now));
  }
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
    retrievalStrategies: {
      semantic: true,
      lexical: true,
      exactEntity: true,
    structured: Object.keys(structuredConstraints).length > 0 || primaryResourceTypes.length > 0,
    },
    structuredConstraints,
    integrationProviders,
    integrationRequested: integrationProviders.length > 0,
  };
};

export const resourceDate = (item: AskLedgerContextItem) => {
  const parsed = Date.parse(item.updatedAt ?? item.timestamp ?? item.dueAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizedText = normalize;

const compactNormalized = (value: string) => normalize(value).replace(/\s+/g, '');

const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, previous[rightIndex - 1], above) + 1;
      diagonal = above;
    }
  }
  return previous[right.length];
};

const containerNamesFor = (item: AskLedgerContextItem) => {
  const names = item.containerName ? [item.containerName] : [];
  const folderMatch = item.content.match(/\bFolder:\s*([^\n.]+?)(?:\.|$)/i);
  if (folderMatch?.[1]) names.push(folderMatch[1].trim());
  return names;
};

const matchesContainerQuery = (item: AskLedgerContextItem, query: string) => {
  const normalizedQuery = normalize(query);
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 2);
  const names = containerNamesFor(item);
  if (!queryTokens.length || !names.length) return false;
  if (names.some((name) => {
    const haystack = normalize(name);
    return queryTokens.every((token) => haystack.includes(token));
  })) return true;

  const compactQuery = compactNormalized(query);
  if (compactQuery.length < 5) return false;
  return names.some((name) => {
    const compactName = compactNormalized(name);
    const threshold = Math.max(1, Math.floor(Math.max(compactQuery.length, compactName.length) * 0.2));
    return editDistance(compactQuery, compactName) <= threshold;
  });
};

export const matchesRetrievalScope = (item: AskLedgerContextItem, plan: RetrievalPlan) => {
  if (plan.primaryResourceTypes.length && !plan.primaryResourceTypes.includes(item.resourceType)) return false;
  if (plan.containerQuery) return matchesContainerQuery(item, plan.containerQuery);
  const query = plan.entityQuery ? normalize(plan.entityQuery) : '';
  if (!query) return true;
  const haystack = normalize(`${item.containerName ?? ''} ${item.title} ${item.content} ${item.projectName ?? ''} ${item.provenance ?? ''}`);
  const queryTokens = query.split(' ').filter((token) => token.length > 2);
  return queryTokens.length > 0 && queryTokens.every((token) => haystack.includes(token));
};
