import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

export type AskLedgerIntegrationSource = 'slack' | 'github' | 'figma' | 'google_drive' | 'google_calendar' | 'apple_calendar' | 'apple_reminders' | 'mcp';

export type IntegrationSearchInput = {
  workspaceId: string;
  userId?: string;
  query: string;
  providers: AskLedgerIntegrationSource[];
  dateRange?: { from?: string; to?: string };
  limit: number;
  documents: AskLedgerContextItem[];
};

export type IntegrationSearchResult = {
  item: AskLedgerContextItem;
  provider: AskLedgerIntegrationSource | string;
  match: 'explicit_link' | 'cached_search';
  score: number;
  reasons: string[];
};

export type IntegrationRetrievalDiagnostics = {
  requestedSources: string[];
  availableSources: string[];
  candidates: number;
  selected: number;
  localCacheCandidates: number;
  remoteAttempts: number;
  failures: Array<{ provider: string; status: string }>;
  explicitLinks: number;
  discovered: number;
};

export interface AskLedgerIntegrationRetriever {
  supports(source: AskLedgerIntegrationSource | string): boolean;
  search(input: IntegrationSearchInput): Promise<{ results: IntegrationSearchResult[]; diagnostics: IntegrationRetrievalDiagnostics }>;
}

const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (value: string) => normalize(value).split(' ').filter((token) => token.length > 2);
const providerOf = (item: AskLedgerContextItem) => String(item.integrationProvider ?? item.metadata?.provider ?? '').toLowerCase();
const isExternal = (item: AskLedgerContextItem) => item.resourceType === 'external' && Boolean(providerOf(item));

export class CachedAskLedgerIntegrationRetriever implements AskLedgerIntegrationRetriever {
  supports(source: AskLedgerIntegrationSource | string) {
    return ['slack', 'github', 'figma', 'google_drive', 'google_calendar', 'apple_calendar', 'apple_reminders', 'mcp'].includes(String(source).toLowerCase());
  }

  async search(input: IntegrationSearchInput) {
    const requested = new Set(input.providers.map((provider) => String(provider).toLowerCase()));
    const queryTokens = tokens(input.query);
    const candidates = input.documents.filter((item) => isExternal(item) && (requested.size === 0 || requested.has(providerOf(item))) && (!input.dateRange?.from || (item.updatedAt ?? item.timestamp ?? '') >= input.dateRange.from) && (!input.dateRange?.to || (item.updatedAt ?? item.timestamp ?? '') <= `${input.dateRange.to}T23:59:59.999Z`));
    const results = candidates.map((item) => {
      const haystack = normalize([item.title, item.content, item.projectName, item.provenance, item.integrationResourceType].filter(Boolean).join(' '));
      const matched = queryTokens.filter((token) => haystack.includes(token)).length;
      const explicit = item.explicitIntegrationLink === true || Boolean(item.relationships?.length);
      const reasons = [explicit ? 'explicit-ledger-link' : 'cached-integration-search', matched ? `lexical-tokens:${matched}` : '', item.integrationResourceType ? `external-type:${item.integrationResourceType}` : ''].filter(Boolean);
      return { item, provider: providerOf(item), match: explicit ? 'explicit_link' : 'cached_search', score: (explicit ? 0.72 : 0.42) + Math.min(0.24, matched * 0.06), reasons } as IntegrationSearchResult;
    }).filter((result) => queryTokens.length === 0 || result.reasons.some((reason) => reason.startsWith('lexical-tokens:'))).sort((left, right) => right.score - left.score || left.item.resourceId.localeCompare(right.item.resourceId)).slice(0, Math.max(1, Math.min(30, input.limit)));
    const availableSources = [...new Set(candidates.map((item) => providerOf(item)))];
    return {
      results,
      diagnostics: {
        requestedSources: [...requested],
        availableSources,
        candidates: candidates.length,
        selected: results.length,
        localCacheCandidates: candidates.length,
        remoteAttempts: 0,
        failures: [...requested].filter((provider) => !availableSources.includes(provider)).map((provider) => ({ provider, status: 'no_cached_context' })),
        explicitLinks: results.filter((result) => result.match === 'explicit_link').length,
        discovered: results.filter((result) => result.match === 'cached_search').length,
        duplicateCollapses: 0,
      },
    };
  }
}
