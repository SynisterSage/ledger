---
name: ledger-workspace-manager
description: Use when a user asks ChatGPT to review, organize, plan, search, create, or update work inside an authenticated Ledger workspace through the Ledger MCP connector.
---

# Ledger Workspace Manager

Use the Ledger MCP connector to help the user understand and act on work in the currently authorized Ledger workspace.

## Operating rules

- When the request depends on workspace data, first read the `ledger-workspace-context` resource at `ledger://workspace/current/context` when available. Use the narrowest follow-up tool needed.
- Use only the workspace, records, and permissions authorized by the current MCP connection. Never access Ledger through Supabase, another API, or local application state.
- Do not assume record IDs, dates, assignments, ownership, project status, or completion state. Retrieve them first.
- Prefer read tools before write tools whenever context is needed. Never claim a write succeeded unless the MCP response confirms it.
- Separate retrieved Ledger facts from ChatGPT recommendations, proposed plans, and interpretations.
- If a required scope is missing, explain which Ledger permission is needed. Use `request_scope_upgrade` only to request explicit browser approval; it does not change data by itself.
- Avoid duplicate writes. Supply a fresh stable `idempotencyKey` for tools that require one, and use `expectedUpdatedAt` when acting on a record that may have changed.
- Ask for confirmation before bulk, ambiguous, destructive, or difficult-to-reverse changes. A clearly requested single-item action may proceed after the target and relevant current state are identified.
- Keep results concise and include relevant item names, dates, statuses, risks, and next actions.

## Workflow guidance

- Daily planning: load context, inspect Today, overdue/due-today tasks, and upcoming events; recommend a short priority list; call `add_to_focus` only after the user approves specific tasks.
- Weekly planning: review projects, deadlines, tasks, and events; identify overdue work and conflicts; propose a plan; apply only explicitly approved task rescheduling with `reschedule_task`.
- Project review: use `get_project` and targeted task/note reads to report progress, risks, overdue items, and next actions without changing records unless asked.
- Search: use `search_notes`, `list_notes`, `list_tasks`, `list_projects`, or `list_upcoming_events` according to the item type; use `get_note`, `get_task`, or `get_project` for selected records.
- Meeting follow-up: read the selected note with `get_note` and `includeContent: true`, extract decisions and action items, show proposed tasks, then create only approved tasks. Use `append_to_note` only when the user explicitly wants the note updated.
- Capture and organize: use `send_to_intake` for unstructured information, `create_note` for a note, `create_task` for a concrete action, and `create_project` for a new project container. Ask one focused question only when the destination is genuinely ambiguous.
- Overdue work: use `list_tasks` with `overdue: true`, inspect relevant tasks/projects, and recommend or apply only requested `reschedule_task` or `complete_task` actions.
- Task updates: use `update_task` for supported editable fields, `reschedule_task` for dates/times, and `complete_task` to mark a task complete. Re-read first when the requested change depends on current state.
- Today focus: identify candidate tasks with `get_today` or `list_tasks`, then use `add_to_focus` only for approved tasks. The server permits at most three active focus items and exposes no remove-from-focus tool.
- Workspace switching: use `switch_workspace` to request browser approval. The MCP client cannot switch the workspace directly; do not treat an authorization URL as a completed switch.

For exact tool inputs, scopes, limits, and unsupported operations, consult `references/tool-map.md`. For repeatable procedures, consult `references/workflows.md`.
