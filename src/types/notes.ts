export type NoteMode = 'text' | 'mind_map' | 'meeting_note';

export type MeetingTranscriptionStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'complete'
  | 'failed';

export type MeetingAudioRetention = 'delete_after_transcription' | 'retain';
export type MeetingAudioSource = 'user_microphone' | 'system_audio';

export type MeetingSpeakerIdentityState = 'known' | 'suggested' | 'unknown';
export type MeetingSpeakerIdentitySource =
  | 'current_user'
  | 'calendar_attendee'
  | 'transcript_context'
  | 'user_confirmed';

export type MeetingSpeakerIdentity = {
  rawSpeakerId?: string;
  personId?: string;
  displayName?: string;
  state: MeetingSpeakerIdentityState;
  confidence?: number;
  source?: MeetingSpeakerIdentitySource;
  confirmedByUser: boolean;
};

export type MeetingNoteMetadata = {
  id: string;
  note_id: string;
  workspace_id: string;
  calendar_event_id: string | null;
  calendar_series_id: string | null;
  calendar_provider: 'ledger' | 'google' | 'apple' | null;
  calendar_event_key: string | null;
  calendar_series_key: string | null;
  calendar_source_name: string | null;
  calendar_event_title: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  calendar_event_deleted: boolean;
  meeting_start_at: string | null;
  meeting_end_at: string | null;
  duration_seconds: number | null;
  transcription_status: MeetingTranscriptionStatus;
  microphone_enabled: boolean;
  system_audio_enabled: boolean;
  audio_retention: MeetingAudioRetention;
  attendees: unknown[] | null;
  meeting_template?: 'auto' | 'one_on_one' | 'team_sync' | 'project_review' | 'customer_sales' | 'interview' | 'custom' | null;
  meeting_template_instructions?: string | null;
  transcription_error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

export type MeetingNoteMetadataInput = Partial<
  Omit<MeetingNoteMetadata, 'id' | 'note_id' | 'workspace_id' | 'created_at' | 'updated_at'>
>;

export type TranscriptSegment = {
  id: string;
  note_id: string;
  workspace_id: string;
  audio_source: MeetingAudioSource;
  speaker_label: string | null;
  speaker_identity?: MeetingSpeakerIdentity | null;
  start_ms: number;
  end_ms: number;
  transcript_text: string;
  confidence: number | null;
  segment_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type TranscriptSegmentInput = Omit<
  TranscriptSegment,
  'id' | 'note_id' | 'workspace_id' | 'created_at' | 'updated_at'
> & { id?: string };

export type MeetingTranscriptLinkType =
  | 'ledger_item'
  | 'action_item'
  | 'decision'
  | 'key_point'
  | 'meeting_note';

export type MeetingTranscriptLink = {
  id: string;
  workspace_id: string;
  meeting_note_id: string;
  transcript_segment_id: string;
  link_type: MeetingTranscriptLinkType;
  ledger_item_type: 'task' | 'reminder' | 'event' | 'intake' | null;
  ledger_item_id: string | null;
  quoted_text: string;
  timestamp_ms: number;
  speaker_label: string | null;
  audio_source: MeetingAudioSource;
  created_at: string;
  updated_at: string;
};

/**
 * Bounded, evidence-first input contract for future meeting intelligence.
 * Phase 1 only defines the shape; it must not trigger generation or mutate
 * the note body.
 */
export type MeetingIntelligenceContext = {
  workspaceId: string;
  noteId: string;
  meeting: {
    title: string;
    calendarEventId?: string | null;
    calendarSeriesId?: string | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
    attendees: unknown[];
    calendarProvider?: string | null;
    calendarEventKey?: string | null;
    calendarSeriesKey?: string | null;
    template?: MeetingNoteMetadata['meeting_template'];
    templateInstructions?: string | null;
  };
  humanNotes: {
    contentHtml: string;
    contentText?: string;
  };
  transcriptSegments: TranscriptSegment[];
  transcriptLinks: MeetingTranscriptLink[];
  relatedContext?: {
    project?: unknown;
    event?: unknown;
    priorMeeting?: unknown;
  };
};
