export const normalizeSearchTerm = (value) => String(value ?? '').trim().toLowerCase();

export const truncateSearchPreview = (value, length = 80) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
};

export const scoreSearchResult = (title, query, preview = '', contentMatched = false) => {
  const normalizedTitle = normalizeSearchTerm(title);
  const normalizedPreview = normalizeSearchTerm(preview);
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return Number.MAX_SAFE_INTEGER;
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(normalizedQuery)) return 2;
  if (contentMatched) return 3;
  if (normalizedPreview.includes(normalizedQuery)) return 4;
  return 5;
};

export const dedupeSearchResults = (results) => {
  const byKey = new Map();
  for (const result of results) {
    const key = result.type === 'meeting_metadata'
      ? `note:${result.note_id ?? result.id}`
      : result.type === 'external_reference' && result.external_url
      ? `external:${result.provider ?? 'external'}:${result.external_url}`
      : `${result.type}:${result.id}`;
    const previous = byKey.get(key);
    if (!previous || Number(result.score ?? 99) < Number(previous.score ?? 99)) byKey.set(key, result);
  }
  return [...byKey.values()];
};
