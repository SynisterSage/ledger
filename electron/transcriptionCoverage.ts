export type CoverageRange = {
  key: string;
  source: 'user_microphone' | 'system_audio';
  startMs: number;
  endMs: number;
  state: 'covered' | 'pending' | 'failed';
  kind: 'live-window' | 'archive-fallback';
};

export function mergeCoverage(ranges: CoverageRange[], toleranceMs = 120) {
  const bySource = new Map<CoverageRange['source'], CoverageRange[]>();
  for (const range of ranges) {
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs <= range.startMs) continue;
    const sourceRanges = bySource.get(range.source) ?? [];
    sourceRanges.push({ ...range, startMs: Math.max(0, range.startMs), endMs: Math.max(0, range.endMs) });
    bySource.set(range.source, sourceRanges);
  }
  const merged: CoverageRange[] = [];
  for (const [source, sourceRanges] of bySource) {
    sourceRanges.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    let current: CoverageRange | null = null;
    for (const range of sourceRanges) {
      if (!current || range.startMs > current.endMs + toleranceMs || range.state !== current.state) {
        if (current) merged.push(current);
        current = { ...range, source };
      } else {
        current.endMs = Math.max(current.endMs, range.endMs);
        current.key = `${current.key},${range.key}`;
      }
    }
    if (current) merged.push(current);
  }
  return merged.sort((a, b) => a.startMs - b.startMs || a.source.localeCompare(b.source));
}

export function missingCoverage(startMs: number, endMs: number, covered: CoverageRange[], source: CoverageRange['source'], toleranceMs = 120) {
  const relevant = mergeCoverage(covered.filter((range) => range.source === source && range.state === 'covered'), toleranceMs)
    .filter((range) => range.endMs > startMs && range.startMs < endMs);
  const gaps: Array<[number, number]> = [];
  let cursor = startMs;
  for (const range of relevant) {
    if (range.startMs > cursor + toleranceMs) gaps.push([cursor, Math.min(endMs, range.startMs)]);
    cursor = Math.max(cursor, range.endMs);
    if (cursor >= endMs - toleranceMs) break;
  }
  if (cursor < endMs - toleranceMs) gaps.push([cursor, endMs]);
  return gaps.filter(([from, to]) => to - from > toleranceMs);
}

export function coverageStatus(ranges: CoverageRange[]) {
  return {
    covered: ranges.filter((range) => range.state === 'covered'),
    pending: ranges.filter((range) => range.state === 'pending'),
    failed: ranges.filter((range) => range.state === 'failed'),
  };
}
