export type AskLedgerResearchCitation = { url: string; title?: string };

export const isExternalResearchQuestion = (question: string) =>
  /\b(?:research|look\s+(?:this|it)\s+up|browse|search\s+the\s+web|online|latest|current|recent news|sources?)\b/i.test(question);

export const buildExternalResearchInstruction = () =>
  'External research mode is active. Use current web evidence available through the connected research provider. Cite factual claims with returned source URLs, distinguish current findings from Ledger workspace context, and say when a claim could not be verified.';

export const buildResearchUnavailableInstruction = () =>
  'Web research is not connected for this request. Answer only from the supplied Ledger context, and do not imply that you searched the web or verified current external facts.';

export const normalizeResearchCitations = (value: unknown): AskLedgerResearchCitation[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry === 'string') return { url: entry.trim() };
    if (!entry || typeof entry !== 'object') return null;
    const url = String((entry as { url?: unknown }).url ?? '').trim();
    const title = String((entry as { title?: unknown }).title ?? '').trim();
    return url ? { url, ...(title ? { title } : {}) } : null;
  }).filter((entry): entry is AskLedgerResearchCitation => {
    if (!entry || !/^https?:\/\//i.test(entry.url) || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  }).slice(0, 12);
};
