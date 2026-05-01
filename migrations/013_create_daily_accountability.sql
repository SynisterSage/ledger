-- Migration: 013_create_daily_accountability
-- Description: Store per-user daily focus bullets and daily check-in fields.

CREATE TABLE IF NOT EXISTS public.daily_accountability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  focus_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  checkin_finished TEXT,
  checkin_blocked TEXT,
  checkin_first_task_tomorrow TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, entry_date)
);

ALTER TABLE public.daily_accountability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own daily accountability"
  ON public.daily_accountability
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own daily accountability"
  ON public.daily_accountability
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own daily accountability"
  ON public.daily_accountability
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own daily accountability"
  ON public.daily_accountability
  FOR DELETE
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_daily_accountability_user_date
  ON public.daily_accountability(user_id, entry_date);
