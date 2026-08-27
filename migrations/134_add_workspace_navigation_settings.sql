-- Migration: 134_add_workspace_navigation_settings
-- Description: Store workspace-scoped navigation preferences.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS navigation_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
