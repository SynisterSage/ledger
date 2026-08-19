import assert from 'node:assert/strict';
import test from 'node:test';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { CachedAskLedgerIntegrationRetriever } from './askLedgerIntegrationRetrieval.ts';

const item = (overrides: Partial<AskLedgerContextItem>): AskLedgerContextItem => ({ workspaceId: 'workspace-a', resourceType: 'external', resourceId: 'external-default', title: 'External', content: 'External context', ...overrides });

test('selects only the explicitly requested integration provider from local cache', async () => {
  const retriever = new CachedAskLedgerIntegrationRetriever();
  const result = await retriever.search({ workspaceId: 'workspace-a', query: 'Alfa', providers: ['slack'], limit: 10, documents: [
    item({ resourceId: 'slack-1', title: 'Alfa discussion', content: 'Slack message about Alfa', integrationProvider: 'slack', integrationResourceType: 'message', externalId: 'slack-message-1' }),
    item({ resourceId: 'github-1', title: 'Alfa PR', content: 'GitHub pull request', integrationProvider: 'github', integrationResourceType: 'pull_request', externalId: 'github-pr-1' }),
  ] });
  assert.deepEqual(result.results.map((entry) => entry.item.resourceId), ['slack-1']);
  assert.equal(result.diagnostics.requestedSources[0], 'slack');
  assert.equal(result.diagnostics.discovered, 1);
});

test('preserves explicit links and does not create inferred links', async () => {
  const retriever = new CachedAskLedgerIntegrationRetriever();
  const result = await retriever.search({ workspaceId: 'workspace-a', query: 'Alfa', providers: ['github'], limit: 10, documents: [
    item({ resourceId: 'github-linked', title: 'Alfa PR', content: 'PR linked to Alfa', integrationProvider: 'github', externalId: 'pr-1', explicitIntegrationLink: true, relationships: [{ relationshipType: 'linked_project', resourceType: 'project', resourceId: 'project-1' }] }),
  ] });
  assert.equal(result.results[0].match, 'explicit_link');
  assert.equal(result.results[0].item.relationships?.[0].resourceId, 'project-1');
});
