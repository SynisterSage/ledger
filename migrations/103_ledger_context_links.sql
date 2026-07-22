create table if not exists public.ledger_context_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_a_type text not null,
  resource_a_id uuid not null,
  resource_b_type text not null,
  resource_b_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_context_links_types check (resource_a_type in ('note','project','task','event','reminder','intake') and resource_b_type in ('note','project','task','event','reminder','intake')),
  constraint ledger_context_links_distinct check (resource_a_type <> resource_b_type or resource_a_id <> resource_b_id),
  constraint ledger_context_links_ordered check (
    case resource_a_type when 'event' then 1 when 'intake' then 2 when 'note' then 3 when 'project' then 4 when 'reminder' then 5 when 'task' then 6 end <
    case resource_b_type when 'event' then 1 when 'intake' then 2 when 'note' then 3 when 'project' then 4 when 'reminder' then 5 when 'task' then 6 end
    or (
      resource_a_type = resource_b_type
      and resource_a_id::text < resource_b_id::text
    )
  ),
  unique (workspace_id, resource_a_type, resource_a_id, resource_b_type, resource_b_id)
);

create index if not exists idx_ledger_context_links_a on public.ledger_context_links (workspace_id, resource_a_type, resource_a_id);
create index if not exists idx_ledger_context_links_b on public.ledger_context_links (workspace_id, resource_b_type, resource_b_id);

alter table public.ledger_context_links enable row level security;

alter table public.ledger_context_links drop constraint if exists ledger_context_links_types;
alter table public.ledger_context_links add constraint ledger_context_links_types check (resource_a_type in ('note','project','task','event','reminder','intake') and resource_b_type in ('note','project','task','event','reminder','intake'));

-- Keep this migration safe to rerun if the table was created before the
-- explicit type ordering was corrected.
alter table public.ledger_context_links drop constraint if exists ledger_context_links_ordered;
alter table public.ledger_context_links add constraint ledger_context_links_ordered check (
  case resource_a_type when 'event' then 1 when 'intake' then 2 when 'note' then 3 when 'project' then 4 when 'reminder' then 5 when 'task' then 6 end <
  case resource_b_type when 'event' then 1 when 'intake' then 2 when 'note' then 3 when 'project' then 4 when 'reminder' then 5 when 'task' then 6 end
  or (resource_a_type = resource_b_type and resource_a_id::text < resource_b_id::text)
);

-- Preserve the existing Calendar-side Note/Project relationships in the
-- reciprocal relationship store. The application keeps the legacy columns
-- for Calendar compatibility while this table becomes the shared read path.
insert into public.ledger_context_links (workspace_id, resource_a_type, resource_a_id, resource_b_type, resource_b_id)
select workspace_id, 'event', id, 'project', project_id from public.events where project_id is not null
on conflict do nothing;
insert into public.ledger_context_links (workspace_id, resource_a_type, resource_a_id, resource_b_type, resource_b_id)
select workspace_id, 'event', id, 'note', note_id from public.events where note_id is not null
on conflict do nothing;
insert into public.ledger_context_links (workspace_id, resource_a_type, resource_a_id, resource_b_type, resource_b_id)
select workspace_id, 'project', project_id, 'reminder', id from public.reminders where project_id is not null
on conflict do nothing;
insert into public.ledger_context_links (workspace_id, resource_a_type, resource_a_id, resource_b_type, resource_b_id)
select workspace_id, 'note', note_id, 'reminder', id from public.reminders where note_id is not null
on conflict do nothing;
