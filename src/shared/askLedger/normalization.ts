import type { AskLedgerContextItem } from '../../types/askLedgerContext.ts';
import { ASK_LEDGER_CHUNKER_VERSION, ASK_LEDGER_NORMALIZATION_VERSION, type AskLedgerChunk } from './contracts.ts';

const clean = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export const normalizeAskLedgerResource = (resource: AskLedgerContextItem): AskLedgerContextItem => ({
  ...resource,
  title: clean(resource.title) || 'Untitled resource',
  content: clean(resource.content),
});

export const chunkAskLedgerResource = (resource: AskLedgerContextItem, options: { maxCharacters?: number } = {}): AskLedgerChunk[] => {
  const normalized = normalizeAskLedgerResource(resource);
  const maxCharacters = Math.max(200, options.maxCharacters ?? 2400);
  const words = normalized.content.split(/\s+/).filter(Boolean);
  const chunks: AskLedgerChunk[] = [];
  let current = '';
  const flush = () => {
    if (!current) return;
    chunks.push({ workspaceId: normalized.workspaceId, resourceType: normalized.resourceType, resourceId: normalized.resourceId, chunkId: `${normalized.resourceType}:${normalized.resourceId}:${chunks.length}`, title: normalized.title, text: current, normalizationVersion: ASK_LEDGER_NORMALIZATION_VERSION, chunkerVersion: ASK_LEDGER_CHUNKER_VERSION });
    current = '';
  };
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxCharacters) flush();
    current = current ? `${current} ${word}` : word;
  }
  flush();
  return chunks;
};
