-- Ledger app_sessions repair.
-- Run this whole file to create/repair public.app_sessions and refresh PostgREST.

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  device_name text,
  platform text NOT NULL DEFAULT 'desktop'::text,
  app_name text,
  app_version text,
  user_agent text,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT app_sessions_user_device_key UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
  ON public.app_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_last_seen
  ON public.app_sessions(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_sessions_revoked_at
  ON public.app_sessions(revoked_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_sessions_user_device_key'
      AND conrelid = 'public.app_sessions'::regclass
  ) THEN
    ALTER TABLE public.app_sessions
      ADD CONSTRAINT app_sessions_user_device_key UNIQUE (user_id, device_id);
  END IF;
END
$$;

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own app sessions" ON public.app_sessions;
CREATE POLICY "Users can read own app sessions"
  ON public.app_sessions
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own app sessions" ON public.app_sessions;
CREATE POLICY "Users can create own app sessions"
  ON public.app_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own app sessions" ON public.app_sessions;
CREATE POLICY "Users can update own app sessions"
  ON public.app_sessions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own app sessions" ON public.app_sessions;
CREATE POLICY "Users can delete own app sessions"
  ON public.app_sessions
  FOR DELETE
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

/*
Legacy schema dump below is kept for reference only. It is intentionally
commented out so running this file applies the app_sessions repair without
failing later on unrelated existing tables.

CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  caretaker_id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone_number text,
  twilio_virtual_number text,
  created_at timestamp with time zone DEFAULT now(),
  passcode_hash text,
  alert_threshold_score integer DEFAULT 90,
  enable_email_alerts boolean DEFAULT true,
  enable_sms_alerts boolean DEFAULT false,
  enable_push_alerts boolean DEFAULT true,
  auto_mark_enabled boolean DEFAULT false,
  auto_mark_fraud_threshold integer DEFAULT 90,
  auto_mark_safe_threshold integer DEFAULT 30,
  auto_trust_on_safe boolean DEFAULT false,
  auto_block_on_fraud boolean DEFAULT true,
  pin_hash text,
  pin_salt bytea,
  pin_pepper_version integer NOT NULL DEFAULT 1,
  pin_locked_until timestamp with time zone,
  pin_updated_at timestamp with time zone,
  twilio_client_identity text,
  twilio_client_last_seen_at timestamp with time zone,
  address text,
  city text,
  state text,
  zip_code text,
  fallback_phone_number text,
  twilio_client_stale_notified_at timestamp with time zone,
  voip_push_token text,
  voip_push_token_updated_at timestamp with time zone,
  last_released_twilio_number text,
  last_number_released_at timestamp with time zone,
  completed_safe_phrases boolean NOT NULL DEFAULT false,
  completed_alert_prefs boolean NOT NULL DEFAULT false,
  completed_test_call boolean NOT NULL DEFAULT false,
  dismissed_nudge_cards ARRAY NOT NULL DEFAULT '{}'::text[],
  multi_endpoint_enabled boolean DEFAULT false,
  has_active_subscription boolean NOT NULL DEFAULT true,
  forwarding_number_cleared_at timestamp with time zone,
  avatar_url text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profile_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'editor'::text CHECK (role = ANY (ARRAY['admin'::text, 'editor'::text])),
  created_at timestamp with time zone DEFAULT now(),
  display_name text,
  caretaker_id uuid NOT NULL,
  notification_preferences jsonb NOT NULL DEFAULT jsonb_build_object('enable_email_alerts', true, 'enable_sms_alerts', true, 'enable_push_alerts', true, 'enable_push_trusted_activity', true, 'enable_push_circle_activity', true, 'enable_push_support_replies', true, 'enable_email_weekly_reports', true, 'enable_email_pin_reset_requests', false, 'alert_threshold_score', 50, 'auto_mark_enabled', false, 'auto_mark_fraud_threshold', 80, 'auto_mark_safe_threshold', 20, 'auto_trust_on_safe', false, 'auto_block_on_fraud', false),
  CONSTRAINT profile_members_pkey PRIMARY KEY (id),
  CONSTRAINT profile_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT profile_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT profile_members_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  call_sid text UNIQUE,
  recording_sid text UNIQUE,
  recording_url text,
  recording_status text,
  recording_duration_seconds integer,
  storage_path text,
  created_at timestamp with time zone DEFAULT now(),
  transcript text,
  transcript_confidence real,
  transcribed_at timestamp with time zone,
  caller_number text,
  caller_hash text,
  fraud_score integer,
  fraud_risk_level text,
  fraud_keywords ARRAY,
  fraud_notes jsonb,
  fraud_alert_required boolean DEFAULT false,
  fraud_alerted_at timestamp with time zone,
  feedback_status text,
  feedback_notes text,
  feedback_by_user_id uuid,
  feedback_at timestamp with time zone,
  caller_country text,
  caller_region text,
  detected_locale text,
  voice_synthetic_score real,
  voice_analysis jsonb,
  voice_detected_at timestamp with time zone,
  voice_feedback text,
  caretaker_id uuid NOT NULL,
  review_push_sent_at timestamp with time zone,
  CONSTRAINT calls_pkey PRIMARY KEY (id),
  CONSTRAINT calls_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT calls_feedback_by_user_id_fkey FOREIGN KEY (feedback_by_user_id) REFERENCES auth.users(id),
  CONSTRAINT calls_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.fraud_safe_phrases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  phrase text NOT NULL,
  created_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  caretaker_id uuid NOT NULL,
  CONSTRAINT fraud_safe_phrases_pkey PRIMARY KEY (id),
  CONSTRAINT fraud_safe_phrases_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT fraud_safe_phrases_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id),
  CONSTRAINT fraud_safe_phrases_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  call_id uuid,
  alert_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  payload jsonb,
  created_at timestamp with time zone DEFAULT now(),
  caretaker_id uuid NOT NULL,
  CONSTRAINT alerts_pkey PRIMARY KEY (id),
  CONSTRAINT alerts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT alerts_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id),
  CONSTRAINT alerts_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.blocked_callers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  caller_hash text NOT NULL,
  caller_number text,
  reason text,
  blocked_until timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  caretaker_id uuid NOT NULL,
  CONSTRAINT blocked_callers_pkey PRIMARY KEY (id),
  CONSTRAINT blocked_callers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT blocked_callers_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profile_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'editor'::text CHECK (role = ANY (ARRAY['admin'::text, 'editor'::text])),
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])),
  created_at timestamp with time zone DEFAULT now(),
  accepted_at timestamp with time zone,
  accepted_by uuid,
  short_code text,
  CONSTRAINT profile_invites_pkey PRIMARY KEY (id),
  CONSTRAINT profile_invites_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT profile_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id),
  CONSTRAINT profile_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id)
);
CREATE TABLE public.trusted_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  caller_hash text NOT NULL,
  caller_number text,
  source text NOT NULL DEFAULT 'manual'::text CHECK (source = ANY (ARRAY['manual'::text, 'contacts'::text, 'auto'::text, 'professional_lookup'::text, 'quick_action'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  relationship_tag text,
  contact_name text,
  caretaker_id uuid NOT NULL,
  trusted_care_team boolean NOT NULL DEFAULT false,
  professional_lookup_place_id text,
  CONSTRAINT trusted_contacts_pkey PRIMARY KEY (id),
  CONSTRAINT trusted_contacts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT trusted_contacts_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id)
);
CREATE TABLE public.pin_attempts (
  profile_id uuid NOT NULL,
  ip text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone,
  last_attempt_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pin_attempts_pkey PRIMARY KEY (profile_id, ip),
  CONSTRAINT pin_attempts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profile_device_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform text NOT NULL,
  locale text,
  metadata jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  caretaker_id uuid NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT profile_device_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT profile_device_tokens_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT profile_device_tokens_caretaker_id_fkey FOREIGN KEY (caretaker_id) REFERENCES auth.users(id),
  CONSTRAINT profile_device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.twilio_number_pool (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  phone_number text NOT NULL UNIQUE,
  twilio_sid text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'available'::text,
  assigned_to_profile_id uuid,
  assigned_at timestamp with time zone,
  reserved_until timestamp with time zone,
  country_code text DEFAULT 'US'::text,
  area_code text,
  capabilities jsonb DEFAULT '{"mms": false, "sms": false, "voice": true}'::jsonb,
  imported_at timestamp with time zone DEFAULT now(),
  imported_by uuid,
  released_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT twilio_number_pool_pkey PRIMARY KEY (id),
  CONSTRAINT twilio_number_pool_assigned_to_profile_id_fkey FOREIGN KEY (assigned_to_profile_id) REFERENCES public.profiles(id),
  CONSTRAINT twilio_number_pool_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id)
);
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action character varying NOT NULL,
  entity_type character varying,
  entity_id character varying,
  user_id uuid,
  profile_id uuid,
  details jsonb,
  ip_address inet,
  user_agent text,
  status character varying,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT audit_logs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  sender text NOT NULL CHECK (sender = ANY (ARRAY['user'::text, 'agent'::text])),
  content text NOT NULL,
  category text,
  metadata jsonb,
  is_read_by_user boolean NOT NULL DEFAULT false,
  is_read_by_agent boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_messages_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.assistant_status (
  id text NOT NULL,
  is_online boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assistant_status_pkey PRIMARY KEY (id)
);
CREATE TABLE public.support_setup_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_snapshot text,
  sender text NOT NULL CHECK (sender = ANY (ARRAY['user'::text, 'agent'::text])),
  content text NOT NULL,
  category text,
  metadata jsonb,
  is_read_by_user boolean NOT NULL DEFAULT false,
  is_read_by_agent boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  merged_profile_id uuid,
  merged_at timestamp with time zone,
  CONSTRAINT support_setup_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_setup_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT support_setup_messages_merged_profile_id_fkey FOREIGN KEY (merged_profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.twilio_client_call_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  call_sid text NOT NULL,
  call_uuid text,
  direction text NOT NULL DEFAULT 'incoming'::text CHECK (direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])),
  from_number text,
  to_number text,
  to_client_identity text,
  state text NOT NULL CHECK (state = ANY (ARRAY['ringing'::text, 'connecting'::text, 'connected'::text, 'reconnecting'::text, 'disconnected'::text, 'failed'::text, 'ended'::text])),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  connected_at timestamp with time zone,
  ended_at timestamp with time zone,
  last_event_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT twilio_client_call_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT twilio_client_call_sessions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.support_bug_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  reporter_user_id uuid NOT NULL,
  reporter_role text NOT NULL DEFAULT 'member'::text,
  topic text NOT NULL,
  details text NOT NULL,
  metadata jsonb,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text])),
  resolution_note text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_bug_reports_pkey PRIMARY KEY (id),
  CONSTRAINT support_bug_reports_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT support_bug_reports_reporter_user_id_fkey FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.legal_acceptances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'mobile_signup'::text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id),
  CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_subscriptions (
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'ios'::text,
  source text NOT NULL DEFAULT 'app_store'::text,
  status text NOT NULL DEFAULT 'inactive'::text CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'expired'::text, 'cancelled'::text, 'billing_retry'::text, 'unknown'::text])),
  is_active boolean NOT NULL DEFAULT false,
  product_id text,
  transaction_id text,
  original_transaction_id text,
  purchased_at timestamp with time zone,
  expires_at timestamp with time zone,
  verification_environment text,
  latest_receipt_status integer,
  latest_receipt_data text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  trial_converted_at timestamp with time zone,
  trial_reclaimed_at timestamp with time zone,
  trial_purge_after_at timestamp with time zone,
  trial_purged_at timestamp with time zone,
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.trial_nudge_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nudge_key text NOT NULL,
  profile_id uuid,
  channel text NOT NULL DEFAULT 'push'::text CHECK (channel = ANY (ARRAY['push'::text, 'in_app'::text, 'email'::text])),
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trial_nudge_events_pkey PRIMARY KEY (id),
  CONSTRAINT trial_nudge_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT trial_nudge_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.facilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text])),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facilities_pkey PRIMARY KEY (id)
);
CREATE TABLE public.facility_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamp with time zone,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facility_codes_pkey PRIMARY KEY (id),
  CONSTRAINT facility_codes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id)
);
CREATE TABLE public.facility_code_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_code_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id text NOT NULL,
  transaction_id text,
  original_transaction_id text,
  redeemed_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT facility_code_redemptions_pkey PRIMARY KEY (id),
  CONSTRAINT facility_code_redemptions_facility_code_id_fkey FOREIGN KEY (facility_code_id) REFERENCES public.facility_codes(id),
  CONSTRAINT facility_code_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.app_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform = ANY (ARRAY['ios'::text, 'android'::text])),
  latest_version text,
  min_supported_version text,
  soft_prompt_enabled boolean NOT NULL DEFAULT true,
  hard_block_enabled boolean NOT NULL DEFAULT false,
  update_message text,
  store_url text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_versions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.pin_reset_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  requester_user_id uuid,
  requester_name text,
  requester_role text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text, 'completed'::text])),
  message text,
  approver_user_id uuid,
  approved_at timestamp with time zone,
  denied_at timestamp with time zone,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pin_reset_requests_pkey PRIMARY KEY (id),
  CONSTRAINT pin_reset_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT pin_reset_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id),
  CONSTRAINT pin_reset_requests_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profile_endpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  endpoint_type character varying NOT NULL CHECK (endpoint_type::text = ANY (ARRAY['mobile'::character varying, 'landline'::character varying, 'app'::character varying]::text[])),
  phone_number text CHECK (phone_number IS NULL OR phone_number ~ '^\+?[0-9]{10,}$'::text),
  phone_number_e164 character varying,
  is_active boolean DEFAULT true,
  verified_at timestamp with time zone,
  last_dialed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profile_endpoints_pkey PRIMARY KEY (id),
  CONSTRAINT profile_endpoints_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profile_routing_prefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE,
  multi_endpoint_enabled boolean DEFAULT false,
  use_ingress_aware_routing boolean DEFAULT true,
  default_fallback_type character varying CHECK (default_fallback_type::text = ANY (ARRAY['app'::character varying, 'voicemail'::character varying, 'first_available'::character varying]::text[])),
  simultaneous_ring_enabled boolean DEFAULT false,
  ring_timeout_seconds integer DEFAULT 30 CHECK (ring_timeout_seconds > 0 AND ring_timeout_seconds <= 300),
  hop_limit_threshold integer DEFAULT 5 CHECK (hop_limit_threshold > 0 AND hop_limit_threshold <= 10),
  duplicate_detection_window_seconds integer DEFAULT 300,
  no_answer_action character varying DEFAULT 'voicemail'::character varying CHECK (no_answer_action::text = ANY (ARRAY['voicemail'::character varying, 'fallback'::character varying, 'hangup'::character varying]::text[])),
  voicemail_enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profile_routing_prefs_pkey PRIMARY KEY (id),
  CONSTRAINT profile_routing_prefs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.call_routing_traces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_id uuid,
  profile_id uuid NOT NULL,
  ingress_detected character varying CHECK (ingress_detected::text = ANY (ARRAY['mobile'::character varying, 'landline'::character varying, 'app'::character varying, 'unknown'::character varying]::text[])),
  ingress_confidence character varying DEFAULT 'low'::character varying CHECK (ingress_confidence::text = ANY (ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying]::text[])),
  ingress_from_number character varying,
  forwarded_from_number character varying,
  routing_mode character varying NOT NULL CHECK (routing_mode::text = ANY (ARRAY['ingress_aware'::character varying, 'legacy'::character varying, 'failed_safe'::character varying]::text[])),
  target_endpoint_type character varying,
  ani_confidence character varying CHECK (ani_confidence::text = ANY (ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying]::text[])),
  loop_guard_result character varying CHECK (loop_guard_result::text = ANY (ARRAY['allowed'::character varying, 'blocked_ingress'::character varying, 'blocked_hop'::character varying, 'blocked_duplicate'::character varying]::text[])),
  hop_count integer DEFAULT 0,
  routing_attempts integer DEFAULT 0,
  last_attempted_leg character varying,
  trace_notes text,
  created_at timestamp with time zone DEFAULT now(),
  call_sid text,
  CONSTRAINT call_routing_traces_pkey PRIMARY KEY (id),
  CONSTRAINT call_routing_traces_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id),
  CONSTRAINT call_routing_traces_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.orphaned_dids (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_number character varying NOT NULL UNIQUE,
  original_profile_id uuid,
  reclaim_reason character varying NOT NULL DEFAULT 'trial_expired'::character varying,
  reclaimed_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT orphaned_dids_pkey PRIMARY KEY (id),
  CONSTRAINT orphaned_dids_original_profile_id_fkey FOREIGN KEY (original_profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE IF NOT EXISTS public.app_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  device_name text,
  platform text NOT NULL DEFAULT 'desktop'::text,
  app_name text,
  app_version text,
  user_agent text,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT app_sessions_user_device_key UNIQUE (user_id, device_id)
);
*/
