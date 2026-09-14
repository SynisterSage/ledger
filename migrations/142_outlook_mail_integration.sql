-- Migration: 142_outlook_mail_integration
-- Description: Store a user-scoped Microsoft account connection for Outlook mail.

ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_account_email TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS outlook_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS outlook_client_state_encrypted TEXT;
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS outlook_delta_link TEXT;
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS outlook_capture_config JSONB NOT NULL DEFAULT '{"include_senders":[],"keywords":[],"exclude_automated":false}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_accounts_outlook_user_account
  ON public.integration_accounts(workspace_id, provider, installed_by, provider_account_id)
  WHERE provider = 'outlook' AND provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_accounts_outlook_user
  ON public.integration_accounts(workspace_id, provider, installed_by)
  WHERE provider = 'outlook';
