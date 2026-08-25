export type FloatingMeetingIndicatorState = {
  recording: boolean;
  ledgerFocused: boolean;
  noteId: string | null;
  paused?: boolean;
  activity?: FloatingMeetingIndicatorActivity;
};

export type FloatingMeetingIndicatorActivity = 'silent' | 'low' | 'medium' | 'high';

export type FloatingMeetingIndicatorWindow = {
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
  hide(): void;
  close(): void;
  sendState?(state: { recording: boolean; paused: boolean; activity: FloatingMeetingIndicatorActivity }): void;
  setBounds?(bounds: { x: number; y: number; width: number; height: number }, animate?: boolean): void;
  getBounds?(): { x: number; y: number; width: number; height: number };
};

export type FloatingMeetingIndicatorWindowFactory = {
  create(onClick: () => void): FloatingMeetingIndicatorWindow;
};

/** Presentation-only state machine. Audio capture remains the source of truth. */
export class FloatingMeetingIndicatorController {
  private window: FloatingMeetingIndicatorWindow | null = null;
  private readonly factory: FloatingMeetingIndicatorWindowFactory;
  private readonly onReturnToMeeting: (noteId: string) => void;
  private state: FloatingMeetingIndicatorState = {
    recording: false,
    ledgerFocused: true,
    noteId: null,
    paused: false,
    activity: 'silent',
  };

  constructor(
    factory: FloatingMeetingIndicatorWindowFactory,
    onReturnToMeeting: (noteId: string) => void,
  ) {
    this.factory = factory;
    this.onReturnToMeeting = onReturnToMeeting;
  }

  update(next: FloatingMeetingIndicatorState) {
    this.state = next;
    const renderState = {
      recording: next.recording,
      paused: next.paused === true,
      activity: next.activity ?? 'silent',
    };
    if (!next.recording || next.ledgerFocused || !next.noteId) {
      this.hide();
      return;
    }
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.factory.create(() => this.click());
    }
    this.window.sendState?.(renderState);
    if (!this.window.isVisible()) this.window.showInactive();
  }

  setActivity(activity: FloatingMeetingIndicatorActivity) {
    this.state.activity = activity;
    this.window?.sendState?.({
      recording: this.state.recording,
      paused: this.state.paused === true,
      activity,
    });
  }

  getRenderState() {
    return {
      recording: this.state.recording,
      paused: this.state.paused === true,
      activity: this.state.activity ?? 'silent',
    };
  }

  click() {
    const noteId = this.state.noteId;
    if (!this.state.recording || !noteId) return;
    this.hide();
    this.onReturnToMeeting(noteId);
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }

  markWindowUnavailable() {
    this.window = null;
  }

  getWindow() {
    return this.window;
  }
}
