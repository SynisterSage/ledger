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
  start_ms: number;
  end_ms: number;
  transcript_text: string;
  confidence: number | null;
  segment_order: number;
  created_at: string;
  updated_at: string;
};

export type TranscriptSegmentInput = Omit<
  TranscriptSegment,
  'id' | 'note_id' | 'workspace_id' | 'created_at' | 'updated_at'
> & { id?: string };
