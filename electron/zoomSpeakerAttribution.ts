import type { LocalTranscriptSegment } from './transcriptionJobStore';

export const DEFAULT_ZOOM_OVERLAP_THRESHOLD = 0.75;
export const MAX_ZOOM_TIMELINE_ENTRIES = 10_000;

export type ZoomSpeakerEvent = { displayName: string; observedAtMs: number; ambiguous?: boolean };
export type ZoomTimelineEntry = { displayName: string; startMs: number; endMs: number | null };
type SessionTimeline = { noteId: string; workspaceId: string; startedAtMs: number; transcriptOffsetMs: number; entries: ZoomTimelineEntry[] };
export type ZoomAttributionMetrics = { recordedEvents: number; duplicateEvents: number; rejectedEvents: number; attributedSegments: number; ambiguousSegments: number; rediscoveryCount: number };

const cleanName = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 160) : '';

export class ZoomSpeakerAttribution {
  private readonly sessions = new Map<string, SessionTimeline>();
  private readonly threshold: number;
  private readonly sessionMetrics = new Map<string, ZoomAttributionMetrics>();
  constructor(threshold = DEFAULT_ZOOM_OVERLAP_THRESHOLD) { this.threshold = threshold; }

  startSession(sessionId: string, input: { noteId: string; workspaceId: string; startedAt: string; transcriptOffsetMs?: number }) {
    this.sessions.set(sessionId, { noteId: input.noteId, workspaceId: input.workspaceId, startedAtMs: Date.parse(input.startedAt), transcriptOffsetMs: Math.max(0, input.transcriptOffsetMs ?? 0), entries: [] });
    this.sessionMetrics.set(sessionId, { recordedEvents: 0, duplicateEvents: 0, rejectedEvents: 0, attributedSegments: 0, ambiguousSegments: 0, rediscoveryCount: 0 });
  }

  clearSession(sessionId: string) { this.sessions.delete(sessionId); this.sessionMetrics.delete(sessionId); }

  metrics(sessionId: string) { return { ...(this.sessionMetrics.get(sessionId) ?? { recordedEvents: 0, duplicateEvents: 0, rejectedEvents: 0, attributedSegments: 0, ambiguousSegments: 0, rediscoveryCount: 0 }) }; }
  noteRediscovery(sessionId: string) { const metrics = this.sessionMetrics.get(sessionId); if (metrics) metrics.rediscoveryCount += 1; }

  record(sessionId: string, event: ZoomSpeakerEvent) {
    const timeline = this.sessions.get(sessionId);
    const displayName = cleanName(event.displayName);
    const metrics = this.sessionMetrics.get(sessionId);
    if (!timeline || !displayName || !Number.isFinite(event.observedAtMs) || !Number.isFinite(timeline.startedAtMs)) { if (metrics) metrics.rejectedEvents += 1; return false; }
    if (event.ambiguous) {
      const startMs = Math.max(0, event.observedAtMs - timeline.startedAtMs + timeline.transcriptOffsetMs);
      const previous = timeline.entries[timeline.entries.length - 1];
      if (previous && startMs >= previous.startMs) previous.endMs = startMs;
      metrics!.ambiguousSegments += 1;
      return false;
    }
    if (event.observedAtMs < timeline.startedAtMs) { metrics!.rejectedEvents += 1; return false; }
    const startMs = Math.max(0, event.observedAtMs - timeline.startedAtMs + timeline.transcriptOffsetMs);
    const previous = timeline.entries[timeline.entries.length - 1];
    if (previous && startMs < previous.startMs) { metrics!.rejectedEvents += 1; return false; }
    if (previous && startMs <= (previous.startMs + (previous.endMs ?? Number.MAX_SAFE_INTEGER))) {
      previous.endMs = startMs;
      if (previous.displayName === displayName) { previous.endMs = null; metrics!.duplicateEvents += 1; return true; }
    }
    if (previous && previous.endMs === startMs && previous.displayName === displayName) { metrics!.duplicateEvents += 1; return true; }
    timeline.entries.push({ displayName, startMs, endMs: null });
    metrics!.recordedEvents += 1;
    if (timeline.entries.length > MAX_ZOOM_TIMELINE_ENTRIES) timeline.entries.splice(0, timeline.entries.length - MAX_ZOOM_TIMELINE_ENTRIES);
    return true;
  }

  getTimeline(sessionId: string) { return (this.sessions.get(sessionId)?.entries ?? []).map((entry) => ({ ...entry })); }

  attribute(sessionId: string, segments: LocalTranscriptSegment[]) {
    const timeline = this.sessions.get(sessionId);
    if (!timeline) return segments;
    return segments.map((segment) => {
      if (segment.audioSource !== 'system_audio' || segment.endMs <= segment.startMs) return segment;
      const duration = segment.endMs - segment.startMs;
      const overlapByName = new Map<string, number>();
      for (const entry of timeline.entries) {
        const overlap = Math.max(0, Math.min(segment.endMs, entry.endMs ?? segment.endMs) - Math.max(segment.startMs, entry.startMs));
        if (overlap > 0) overlapByName.set(entry.displayName, (overlapByName.get(entry.displayName) ?? 0) + overlap);
      }
      const ranked = [...overlapByName.entries()].sort((a, b) => b[1] - a[1]);
      const winner = ranked[0];
      if (!winner || winner[1] / duration < this.threshold || (ranked[1] && ranked[1][1] / duration >= this.threshold)) {
        const metrics = this.sessionMetrics.get(sessionId); if (metrics) metrics.ambiguousSegments += 1;
        return segment;
      }
      const metrics = this.sessionMetrics.get(sessionId); if (metrics) metrics.attributedSegments += 1;
      return { ...segment, speakerIdentity: { rawSpeakerId: `zoom:${winner[0]}`, displayName: winner[0], state: 'known' as const, confidence: winner[1] / duration, source: 'zoom_accessibility' as const, confirmedByUser: false as const } };
    });
  }
}
