import type { AskLedgerContextItem } from '../../types/askLedgerContext.ts';

export type HybridCandidateSignals = {
  semanticScore: number;
  lexicalScore: number;
  exactEntityMatch: boolean;
  structuredMatch: boolean;
  explicitContext?: boolean;
  authoritativeResource?: boolean;
};

export type HybridCandidateEvidence = HybridCandidateSignals & {
  score: number;
  reasons: string[];
};

const STOP_WORDS = new Set('a an and are at be but can could did do for from have how i in is it me my of on or should tell that the this to was we what when where which with would you your'.split(' '));

export const normalizeHybridText = (value: unknown) => String(value ?? '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const meaningfulTokens = (value: unknown) => normalizeHybridText(value)
  .split(' ')
  .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

const unique = (values: string[]) => [...new Set(values)];

export const lexicalMatch = (question: string, item: Pick<AskLedgerContextItem, 'title' | 'content' | 'projectName' | 'containerName' | 'provenance'>) => {
  const queryTokens = unique(meaningfulTokens(question));
  if (!queryTokens.length) return { score: 0, phraseMatch: false, titleTokenCoverage: 0 };
  const title = normalizeHybridText(item.title);
  const searchable = normalizeHybridText([item.title, item.content, item.projectName, item.containerName, item.provenance].filter(Boolean).join(' '));
  const titleTokens = new Set(meaningfulTokens(item.title));
  const titleMatches = queryTokens.filter((token) => titleTokens.has(token)).length;
  const contentMatches = queryTokens.filter((token) => searchable.includes(token)).length;
  const titleTokenCoverage = titleMatches / queryTokens.length;
  const contentCoverage = contentMatches / queryTokens.length;
  const phraseMatch = queryTokens.length > 1 && title.includes(queryTokens.join(' '));
  return { score: Math.min(1, titleTokenCoverage * 0.72 + contentCoverage * 0.28 + (phraseMatch ? 0.18 : 0)), phraseMatch, titleTokenCoverage };
};

export const entityMatch = (entityQuery: string | undefined, item: Pick<AskLedgerContextItem, 'title' | 'projectName' | 'containerName'>) => {
  if (!entityQuery) return false;
  const query = normalizeHybridText(entityQuery);
  if (!query) return false;
  const queryTokens = unique(meaningfulTokens(query));
  const fields = [item.title, item.projectName, item.containerName].map(normalizeHybridText).filter(Boolean);
  return fields.some((field) => field === query || (queryTokens.length > 0 && queryTokens.every((token) => field.split(' ').includes(token))));
};

export const scoreHybridCandidate = (signals: HybridCandidateSignals): HybridCandidateEvidence => {
  const reasons: string[] = [];
  let score = Math.max(0, signals.semanticScore) * 0.38 + Math.max(0, signals.lexicalScore) * 0.32;
  if (signals.semanticScore > 0) reasons.push(`semantic:${signals.semanticScore.toFixed(3)}`);
  if (signals.lexicalScore > 0) reasons.push(`lexical-score:${signals.lexicalScore.toFixed(3)}`);
  if (signals.exactEntityMatch) { score += 1.35; reasons.push('exact-title-match'); }
  if (signals.structuredMatch) { score += 1.05; reasons.push('structured-match'); }
  if (signals.authoritativeResource) { score += 0.22; reasons.push('authoritative-resource'); }
  if (signals.explicitContext) { score += 0.8; reasons.push('explicit-context'); }
  return { ...signals, score, reasons };
};
