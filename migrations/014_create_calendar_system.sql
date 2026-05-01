-- Migration: 014_create_calendar_system
-- Description: Calendar system with workspace-aware calendars, events, reminders, and accountability outcomes.

CREATE TABLE IF NOT EXISTS public.calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_personal BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  notes TEXT,
  location TEXT,
  start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'missed', 'cancelled')),
  linked_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  linked_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  recurrence_rule TEXT,
  recurrence_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.event_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  minutes_before INTEGER NOT NULL CHECK (minutes_before >= 0 AND minutes_before <= 10080),
  channel VARCHAR(20) NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('done', 'partial', 'missed')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(event_id, user_id)
);

ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;

-- Calendars RLS
CREATE POLICY "Users can read workspace calendars"
  ON public.calendars
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create workspace calendars"
  ON public.calendars
  FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
    AND owner_id = auth.uid()
  );

CREATE POLICY "Users can update workspace calendars"
  ON public.calendars
  FOR UPDATE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can delete workspace calendars"
  ON public.calendars
  FOR DELETE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

-- Events RLS
CREATE POLICY "Users can read workspace events"
  ON public.events
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create workspace events"
  ON public.events
  FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update workspace events"
  ON public.events
  FOR UPDATE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can delete workspace events"
  ON public.events
  FOR DELETE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

-- Reminders RLS
CREATE POLICY "Users can read event reminders"
  ON public.event_reminders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_id
        AND e.workspace_id IN (
          SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          UNION
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can manage event reminders"
  ON public.event_reminders
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_id
        AND e.workspace_id IN (
          SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          UNION
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
        )
    )
  );

-- Check-ins RLS
CREATE POLICY "Users can read workspace event checkins"
  ON public.event_checkins
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_id
        AND e.workspace_id IN (
          SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          UNION
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can create own event checkins"
  ON public.event_checkins
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_id
        AND e.workspace_id IN (
          SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
          UNION
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can update own event checkins"
  ON public.event_checkins
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own event checkins"
  ON public.event_checkins
  FOR DELETE
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_calendars_workspace_id ON public.calendars(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_workspace_id ON public.events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_calendar_id ON public.events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON public.events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_end_at ON public.events(end_at);
CREATE INDEX IF NOT EXISTS idx_event_reminders_event_id ON public.event_reminders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event_id ON public.event_checkins(event_id);
