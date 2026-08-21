import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { routeAskLedgerMessage } from '../src/types/askLedgerResponseMode.ts';
import { getAskLedgerSkill } from '../electron/askLedgerSkills.ts';
import { createAskLedgerService } from '../electron/askLedgerService.ts';
import { createLocalAIService } from '../electron/localAIService.ts';
import { LocalAIAssetManager } from '../electron/localAIAssets.ts';

const apiUrl = (process.env.LEDGER_PHASE10_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');
const accessToken = process.env.LEDGER_PHASE10_ACCESS_TOKEN;
const workspaceId = process.env.LEDGER_PHASE10_WORKSPACE_ID;
const outputPath = process.env.LEDGER_PHASE10_OUTPUT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', 'phase10-live', 'report.json');

if (!apiUrl || !accessToken || !workspaceId) {
  console.error(JSON.stringify({ phase: 10, status: 'blocked', reason: 'set LEDGER_PHASE10_API_URL, LEDGER_PHASE10_ACCESS_TOKEN, and LEDGER_PHASE10_WORKSPACE_ID' }));
  process.exitCode = 2;
} else {
  const api = async (endpoint, options = {}) => {
    const started = performance.now();
    const response = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Workspace-Id': workspaceId,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${body.error || response.statusText}`);
    return { body, durationMs: performance.now() - started };
  };

  const loadCorpus = async (question) => {
    const started = performance.now();
    const [documentResult, searchResult, sectionResult] = await Promise.all([
      api(`/api/workspaces/${workspaceId}/ai-documents`),
      api(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(question)}`, { method: 'POST' }),
      api('/api/sections'),
    ]);
    const documentRows = Array.isArray(documentResult.body?.documents) ? documentResult.body.documents : Array.isArray(documentResult.body) ? documentResult.body : [];
    const sectionRows = Array.isArray(sectionResult.body?.sections) ? sectionResult.body.sections : Array.isArray(sectionResult.body) ? sectionResult.body : [];
    const sectionNames = new Map(sectionRows.map((section) => [String(section.id ?? ''), String(section.name ?? section.title ?? '')]).filter(([id, name]) => id && name));
    const documents = documentRows
      .filter((item, index, all) => all.findIndex((candidate) => candidate.resourceType === item.resourceType && candidate.resourceId === item.resourceId) === index)
      .map((item) => item.resourceType === 'note' && !item.containerName && !item.sectionName
        ? { ...item, workspaceId, containerName: sectionNames.get(String(item.section_id ?? item.sectionId ?? '')) }
        : { ...item, workspaceId });
    const lexicalResults = Array.isArray(searchResult.body) ? searchResult.body : Array.isArray(searchResult.body?.results) ? searchResult.body.results : [];
    return {
      documents,
      lexicalResults,
      preparation: {
        fetchMs: documentResult.durationMs + searchResult.durationMs + sectionResult.durationMs,
        corpusAssemblyMs: performance.now() - started,
        documentCount: documents.length,
        resourceTypes: [...new Set(documents.map((item) => item.resourceType))],
      },
    };
  };

  const assets = new LocalAIAssetManager();
  const localAI = createLocalAIService(assets);
  const service = createAskLedgerService(localAI, assets);
  const records = [];
  const run = async ({ id, question, skillId, conversation }) => {
    const started = performance.now();
    const route = routeAskLedgerMessage(question, {
      previousQuestion: conversation?.previousQuestion,
      previousAnswer: conversation?.previousAnswer,
      previousSources: conversation?.previousSources,
      recentExchanges: conversation?.recentExchanges,
    });
    const corpusStarted = performance.now();
    const corpus = await loadCorpus(question);
    const corpusPreparationMs = performance.now() - corpusStarted;
    const requestId = randomUUID();
    const events = [];
    const result = await new Promise((resolve) => {
      service.start({ requestId, workspaceId, question, documents: corpus.documents, lexicalResults: corpus.lexicalResults, skillId, skillDefinition: skillId ? getAskLedgerSkill(skillId) : undefined, conversation }, { onEvent: (event) => {
        events.push(event);
        if (event.type === 'done' || event.type === 'error') resolve(event);
      } });
    });
    const performanceData = result.metrics?.performance || {};
    records.push({
      id,
      question,
      expectedExecutionMode: route.executionMode,
      executionMode: performanceData.executionMode || route.executionMode,
      routingConfidence: route.diagnostics.routingConfidence,
      retrievalRequired: performanceData.retrievalRequired ?? route.retrievalRequired,
      fastPathKind: performanceData.fastPathKind || performanceData.fastPath,
      resolution: performanceData.fastPathResolution,
      status: result.type === 'done' ? 'success' : result.error?.code || 'error',
      answer: events.filter((event) => event.type === 'delta' || event.type === 'replace').map((event) => event.text || '').join(''),
      metrics: {
        corpusPreparationMs,
        dataFetchMs: corpus.preparation.fetchMs,
        corpusAssemblyMs: corpus.preparation.corpusAssemblyMs,
        ...performanceData,
        firstVisibleMs: typeof performanceData.firstForwardedDeltaMs === 'number' ? corpusPreparationMs + performanceData.firstForwardedDeltaMs : undefined,
        rendererVisibleTotalMs: performance.now() - started,
      },
      corpus: corpus.preparation,
    });
  };

  try {
    await localAI.switchGenerationTier('balanced');
    const conversation = { id: `phase10-${randomUUID()}`, previousQuestion: 'Why is Atlas delayed?', previousAnswer: 'Approval is still pending.', previousSources: [] };
    for (const request of [
      { id: 'conversation', question: "what's a mutex?" },
      { id: 'workspace-lookup', question: "what's due today?" },
      { id: 'workspace-synthesis', question: 'summarize my last three meeting notes' },
      { id: 'workspace-research', question: 'look across Atlas and tell me what is blocking launch' },
      { id: 'plan-my-week', question: 'Plan my week.', skillId: 'plan_my_week' },
      { id: 'due-today', question: "what's due today?" },
      { id: 'overdue-count', question: 'How many overdue tasks do I have?' },
      { id: 'tomorrow-meetings', question: "what meetings are tomorrow?" },
      { id: 'active-reminders', question: 'What reminders are active?' },
      { id: 'recent-notes', question: 'Show my last 3 notes.' },
    ]) await run({ ...request, conversation: request.id === 'conversation' ? undefined : undefined });
  } finally {
    await service.shutdown().catch(() => undefined);
  }
  const report = { phase: 10, status: 'complete', workspaceId, apiUrl, modelTier: localAI.getGenerationRuntimeState?.().selectedTier, records };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputPath, recordCount: records.length, status: report.status }, null, 2));
}
