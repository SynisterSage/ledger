-- Migration: 105_slack_workspace_page
-- Description: Retain the non-sensitive Slack workspace icon for the connection overview.

ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS provider_team_icon TEXT;
