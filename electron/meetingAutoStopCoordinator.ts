export type AutoStopReason = 'calendar_end' | 'call_ended' | 'inactivity' | 'sleep';

export type AutoStopConfig = {
  meaningfulAudioLevel: number;
  calendarSilenceMs: number;
  callEndedSilenceMs: number;
  inactivitySilenceMs: number;
  graceMs: number;
};

export const DEFAULT_AUTO_STOP_CONFIG: AutoStopConfig = {
  meaningfulAudioLevel: 0.04,
  calendarSilenceMs: 2 * 60_000,
  callEndedSilenceMs: 5 * 60_000,
  inactivitySilenceMs: 8 * 60_000,
  graceMs: 15_000,
};

type ActiveMeeting = {
  noteId: string;
  scheduledEndAt: number | null;
  startedAt: number;
  lastMeaningfulAudioAt: number;
  callEndedAt: number | null;
  paused: boolean;
  grace: { reason: AutoStopReason; startedAt: number } | null;
};

export class MeetingAutoStopCoordinator {
  private active: ActiveMeeting | null = null;
  private readonly config: AutoStopConfig;
  private readonly onGrace: (state: { active: boolean; noteId: string; reason?: AutoStopReason }) => void;
  private readonly onStop: (reason: AutoStopReason, noteId: string) => void;
  private readonly onNewMeeting: (context: { noteId: string; title?: string }) => void;

  constructor(options: {
    onGrace: (state: { active: boolean; noteId: string; reason?: AutoStopReason }) => void;
    onStop: (reason: AutoStopReason, noteId: string) => void;
    onNewMeeting?: (context: { noteId: string; title?: string }) => void;
    config?: Partial<AutoStopConfig>;
  }) {
    this.config = { ...DEFAULT_AUTO_STOP_CONFIG, ...options.config };
    this.onGrace = options.onGrace;
    this.onStop = options.onStop;
    this.onNewMeeting = options.onNewMeeting ?? (() => undefined);
  }

  start(input: { noteId: string; scheduledEndAt?: string | null }, now = Date.now()) {
    const scheduledEndAt = input.scheduledEndAt ? Date.parse(input.scheduledEndAt) : NaN;
    this.active = {
      noteId: input.noteId,
      scheduledEndAt: Number.isFinite(scheduledEndAt) ? scheduledEndAt : null,
      startedAt: now,
      lastMeaningfulAudioAt: now,
      callEndedAt: null,
      paused: false,
      grace: null,
    };
  }

  stop() {
    if (this.active?.grace) this.onGrace({ active: false, noteId: this.active.noteId });
    this.active = null;
  }

  pause() {
    if (!this.active) return;
    this.clearGrace();
    this.active.paused = true;
  }

  resume(now = Date.now()) {
    if (!this.active) return;
    this.clearGrace();
    this.active.paused = false;
    this.active.lastMeaningfulAudioAt = now;
    this.active.callEndedAt = null;
  }

  audioLevel(level: number, now = Date.now()) {
    if (!this.active || this.active.paused || !Number.isFinite(level)) return;
    if (level >= this.config.meaningfulAudioLevel) {
      this.active.lastMeaningfulAudioAt = now;
      this.active.callEndedAt = null;
      this.clearGrace();
    }
  }

  signalCallEnded(noteId: string, now = Date.now()) {
    if (!this.active || this.active.noteId !== noteId || this.active.paused) return false;
    this.active.callEndedAt = now;
    return true;
  }

  signalNewMeeting(context: { noteId: string; title?: string }) {
    if (!this.active || context.noteId === this.active.noteId) return false;
    this.onNewMeeting(context);
    return true;
  }

  keepRecording(now = Date.now()) {
    if (!this.active) return false;
    this.clearGrace();
    this.active.lastMeaningfulAudioAt = now;
    this.active.callEndedAt = null;
    return true;
  }

  sleep() {
    if (!this.active) return false;
    this.onStop('sleep', this.active.noteId);
    return true;
  }

  tick(now = Date.now()) {
    const active = this.active;
    if (!active || active.paused || active.grace) return;
    const silenceMs = now - active.lastMeaningfulAudioAt;
    let reason: AutoStopReason | null = null;
    if (active.callEndedAt !== null && now - active.callEndedAt >= this.config.callEndedSilenceMs && silenceMs >= this.config.callEndedSilenceMs) {
      reason = 'call_ended';
    } else if (active.scheduledEndAt !== null && now >= active.scheduledEndAt && silenceMs >= this.config.calendarSilenceMs) {
      reason = 'calendar_end';
    } else if (silenceMs >= this.config.inactivitySilenceMs) {
      reason = 'inactivity';
    }
    if (reason) {
      active.grace = { reason, startedAt: now };
      this.onGrace({ active: true, noteId: active.noteId, reason });
    }
  }

  finishGrace(now = Date.now()) {
    const active = this.active;
    if (!active?.grace || now - active.grace.startedAt < this.config.graceMs) return false;
    const reason = active.grace.reason;
    const noteId = active.noteId;
    this.onGrace({ active: false, noteId, reason });
    this.onStop(reason, noteId);
    return true;
  }

  state() {
    return this.active ? { ...this.active, grace: this.active.grace ? { ...this.active.grace } : null } : null;
  }

  private clearGrace() {
    if (!this.active?.grace) return;
    this.onGrace({ active: false, noteId: this.active.noteId, reason: this.active.grace.reason });
    this.active.grace = null;
  }
}
