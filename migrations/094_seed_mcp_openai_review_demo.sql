-- Migration: 094_seed_mcp_openai_review_demo
-- Purpose: Seed the isolated OpenAI MCP review account with deterministic demo data.
-- This migration intentionally targets one pre-created Supabase Auth user and one workspace.

DO $$
DECLARE
  demo_user_id UUID := 'feb39fe0-9f9e-44a9-9724-ec475a169b0d';
  demo_workspace_id UUID := '0bf91072-2fdf-4e0b-b3f9-0443292958d8';
  demo_email TEXT := 'openai-review@test.com';
  calendar_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = demo_user_id
      AND lower(email) = demo_email
  ) THEN
    RAISE EXCEPTION 'OpenAI MCP demo user % was not found with the expected email.', demo_user_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = demo_workspace_id
      AND owner_id = demo_user_id
      AND is_personal = true
  ) THEN
    RAISE EXCEPTION 'OpenAI MCP demo workspace % is missing, not personal, or has the wrong owner.', demo_workspace_id;
  END IF;

  INSERT INTO public.projects (
    id, workspace_id, created_by, name, description, status, completeness,
    color, start_date, end_date, project_type, lead_id, updated_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111111', demo_workspace_id, demo_user_id,
    'Website Launch',
    'Prepare and release the Ledger marketing website.',
    'InProgress', 45, '#FF5F40', CURRENT_DATE - 14, CURRENT_DATE + 14,
    'writing', demo_user_id, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    created_by = EXCLUDED.created_by,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    completeness = EXCLUDED.completeness,
    color = EXCLUDED.color,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    project_type = EXCLUDED.project_type,
    lead_id = EXCLUDED.lead_id,
    updated_at = NOW();

  INSERT INTO public.tasks (
    id, workspace_id, project_id, title, description, status, priority,
    due_date, created_by, updated_by, updated_at
  ) VALUES
    (
      '22222222-2222-4222-8222-222222222221', demo_workspace_id,
      '11111111-1111-4111-8111-111111111111', 'Finalize homepage copy',
      'Complete the final homepage messaging pass.', 'todo', 'high',
      CURRENT_DATE - 2, demo_user_id, demo_user_id, NOW()
    ),
    (
      '22222222-2222-4222-8222-222222222222', demo_workspace_id,
      '11111111-1111-4111-8111-111111111111', 'QA checkout flow',
      'Verify the checkout flow before the website launch review.', 'todo', 'high',
      CURRENT_DATE, demo_user_id, demo_user_id, NOW()
    ),
    (
      '22222222-2222-4222-8222-222222222223', demo_workspace_id,
      '11111111-1111-4111-8111-111111111111', 'Archive old onboarding copy',
      'Remove outdated onboarding language after the new copy is approved.', 'todo', 'medium',
      CURRENT_DATE + 5, demo_user_id, demo_user_id, NOW()
    )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    due_date = EXCLUDED.due_date,
    created_by = EXCLUDED.created_by,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  INSERT INTO public.notes (
    id, workspace_id, user_id, title, content, content_html, date,
    mode, source, source_platform, updated_by, updated_at
  ) VALUES (
    '33333333-3333-4333-8333-333333333333', demo_workspace_id, demo_user_id,
    'Website Launch Kickoff',
    'Decision: proceed with the website launch after the final QA pass.\n\nAction item: complete the checkout flow QA checklist before the Website Launch Review.\n\nRisk: homepage copy and checkout QA are the remaining launch-critical items.',
    '<p>Decision: proceed with the website launch after the final QA pass.</p><p>Action item: complete the checkout flow QA checklist before the Website Launch Review.</p><p>Risk: homepage copy and checkout QA are the remaining launch-critical items.</p>',
    CURRENT_DATE, 'text', 'mcp-review-demo', 'mcp-review-demo', demo_user_id, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    content_html = EXCLUDED.content_html,
    date = EXCLUDED.date,
    mode = EXCLUDED.mode,
    source = EXCLUDED.source,
    source_platform = EXCLUDED.source_platform,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  INSERT INTO public.project_note_links (
    id, workspace_id, project_id, note_id, created_by, updated_at
  ) VALUES (
    '44444444-4444-4444-8444-444444444444', demo_workspace_id,
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333', demo_user_id, NOW()
  )
  ON CONFLICT (workspace_id, project_id, note_id) DO UPDATE SET
    updated_at = NOW();

  INSERT INTO public.calendars (
    id, workspace_id, owner_id, name, color, is_default, is_personal,
    created_by, is_visible, updated_at
  ) VALUES (
    '55555555-5555-4555-8555-555555555555', demo_workspace_id, demo_user_id,
    'OpenAI Review Calendar', '#FF5F40', true, true, demo_user_id, true, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    owner_id = EXCLUDED.owner_id,
    name = EXCLUDED.name,
    color = EXCLUDED.color,
    is_default = EXCLUDED.is_default,
    is_personal = EXCLUDED.is_personal,
    created_by = EXCLUDED.created_by,
    is_visible = EXCLUDED.is_visible,
    updated_at = NOW();

  SELECT id INTO calendar_id
  FROM public.calendars
  WHERE id = '55555555-5555-4555-8555-555555555555';

  INSERT INTO public.events (
    id, calendar_id, workspace_id, created_by, title, notes,
    start_at, end_at, all_day, timezone, status, project_id, note_id, updated_by, updated_at
  ) VALUES (
    '66666666-6666-4666-8666-666666666666', calendar_id, demo_workspace_id,
    demo_user_id, 'Website Launch Review',
    'Review launch readiness, homepage copy, and checkout QA.',
    ((CURRENT_DATE + 3)::date + TIME '10:00') AT TIME ZONE 'America/New_York',
    ((CURRENT_DATE + 3)::date + TIME '11:00') AT TIME ZONE 'America/New_York',
    false, 'America/New_York', 'planned',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333', demo_user_id, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    calendar_id = EXCLUDED.calendar_id,
    workspace_id = EXCLUDED.workspace_id,
    created_by = EXCLUDED.created_by,
    title = EXCLUDED.title,
    notes = EXCLUDED.notes,
    start_at = EXCLUDED.start_at,
    end_at = EXCLUDED.end_at,
    all_day = EXCLUDED.all_day,
    timezone = EXCLUDED.timezone,
    status = EXCLUDED.status,
    project_id = EXCLUDED.project_id,
    note_id = EXCLUDED.note_id,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  INSERT INTO public.reminders (
    id, workspace_id, user_id, title, body, remind_at, status,
    linked_type, linked_id, calendar_id, created_by, project_id, note_id, updated_at
  ) VALUES (
    '77777777-7777-4777-8777-777777777777', demo_workspace_id, demo_user_id,
    'Review launch checklist', 'Bring the final QA checklist to the Website Launch Review.',
    ((CURRENT_DATE + 4)::date + TIME '09:00') AT TIME ZONE 'America/New_York',
    'active', 'project', '11111111-1111-4111-8111-111111111111', calendar_id,
    demo_user_id, '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333', NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    remind_at = EXCLUDED.remind_at,
    status = EXCLUDED.status,
    linked_type = EXCLUDED.linked_type,
    linked_id = EXCLUDED.linked_id,
    calendar_id = EXCLUDED.calendar_id,
    created_by = EXCLUDED.created_by,
    project_id = EXCLUDED.project_id,
    note_id = EXCLUDED.note_id,
    updated_at = NOW();
END;
$$;
