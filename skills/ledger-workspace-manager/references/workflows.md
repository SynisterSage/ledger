# Ledger MCP workflows

Use the exact registered names below. Treat every write response as the source of truth for whether a change succeeded.

## 1. Daily reset

1. Read `ledger-workspace-context` at `ledger://workspace/current/context` to establish the approved workspace and available scopes.
2. Call `get_today`, normally without `date`, to load focus, due-today tasks, reminders, events, and check-in fields.
3. Call `list_tasks` with `overdue: true` and, when needed, a due-today range. Use returned IDs and `updatedAt` values; do not infer them.
4. Call `list_upcoming_events` for the relevant planning window if Today context is insufficient.
5. Separate retrieved items from a concise recommendation of priorities, conflicts, and next actions.
6. Ask the user to approve specific focus changes. For each approved existing task, call `add_to_focus` with a fresh stable `idempotencyKey`. Do not add completed tasks or exceed the server's three-item limit.
7. Report only the changes confirmed by the tool responses. `get_today` does not update check-in fields, and no focus-removal tool is exposed.

## 2. Weekly plan

1. Read the workspace context.
2. Call `list_projects` for active statuses and follow pagination with `nextCursor` when needed.
3. Call `list_tasks` for unfinished work, overdue work, and the week’s due-date range. Use `projectId` to inspect a specific project.
4. Call `list_upcoming_events` for the week and include reminders in the review.
5. Identify conflicts, overdue items, missing next actions, and workload risks from the retrieved data. Produce a proposed weekly plan; label recommendations as recommendations.
6. After the user explicitly approves changes, call `reschedule_task` for each requested task using the current task ID and `expectedUpdatedAt` when available. Confirm ambiguous dates before writing.
7. Summarize confirmed reschedules and leave events, reminders, and unrelated project records unchanged because no corresponding write tools are exposed.

## 3. Project status report

1. Read workspace context and use `list_projects` if the project ID is not already known.
2. Call `get_project` for the selected project. This includes bounded project data, linked-note summaries, and next actions.
3. Use `get_task` for important task details and `get_note` with `includeContent: true` only for explicitly relevant linked notes. Use `search_notes` when locating related notes by text.
4. Summarize current status, progress, due dates, overdue items, risks, linked context, and next actions.
5. Do not change records unless the user explicitly asks. A status report alone never calls a write tool.

## 4. Meeting follow-up

1. Identify the selected note through `search_notes` or `list_notes` if necessary.
2. Call `get_note` with that `noteId` and `includeContent: true`.
3. Extract decisions, owners, dates, and action items. Mark anything not present in the note as unknown rather than guessing.
4. Present proposed tasks to the user before creating several items. Ask only for missing details that are necessary to make a task unambiguous.
5. For approved actions, call `create_task` with a fresh `idempotencyKey`; include `projectId`, `assigneeId`, priority, and due date only when supported and confirmed by the user or retrieved context.
6. Use `append_to_note` only when the user explicitly requests adding the follow-up to the existing note. Read first and use `expectedUpdatedAt` when available.
7. Report each confirmed task/note result. There is no MCP tool to create a calendar event or edit rich note formatting.

## 5. Capture and organize

1. Decide whether the user has clearly requested Intake, a note, a concrete task, or a project container.
2. If genuinely ambiguous, ask one focused destination question. Do not silently create several representations of the same information.
3. Use `send_to_intake` for unstructured capture that should remain unprocessed; use `create_note` for durable plain-text reference material; use `create_task` for an actionable item; use `create_project` for a new outcome container.
4. Before linking to a project, section, or assignee, retrieve or verify the existing ID and workspace access.
5. Supply the required idempotency key and report the confirmed returned object. Do not claim that Intake has been organized further because the MCP server exposes no Intake-processing tool.

## 6. Review overdue work

1. Read workspace context.
2. Call `list_tasks` with `overdue: true`, then use `get_task` for items requiring more detail.
3. Use `get_project` for the project context of important overdue tasks and `list_upcoming_events` if calendar conflicts matter.
4. Present the overdue list and recommendations without changing records.
5. If the user approves a specific action, call `reschedule_task` or `complete_task` as appropriate. Use `expectedUpdatedAt` when acting on a task just read and report conflicts instead of overwriting newer data.

## 7. Reschedule or complete tasks

1. Locate the task with `list_tasks` or confirm it with `get_task`.
2. For a date/time change, call `reschedule_task`; for completion, call `complete_task`; for other supported fields, call `update_task`.
3. Use the current task ID and `expectedUpdatedAt` where supported. Do not use `update_task` to simulate unsupported event or project changes.
4. A clearly requested single-item operation may proceed; confirm bulk or inferred changes first.
5. Treat the returned task/status as authoritative and report any already-completed or concurrency-conflict result.

## 8. Update Today focus

1. Call `get_today` and/or `list_tasks` to identify candidate tasks.
2. Recommend no more than three concrete focus items using current titles, statuses, and due dates.
3. Wait for approval of the specific task IDs.
4. Call `add_to_focus` once per approved task with a fresh idempotency key. The server rejects completed tasks and a fourth active focus item.
5. Confirm the returned result. The MCP server exposes no remove-from-focus operation, so do not promise to undo focus changes through this connector.

## 9. Switch workspace when supported

1. Read `ledger-workspace-context` to establish the current workspace.
2. Call `switch_workspace`, optionally with a user-confirmed `workspaceId`.
3. Tell the user to open the returned authorization URL and approve the destination in Ledger. The MCP client cannot switch the connection directly.
4. Do not claim completion from the returned session details. After the client completes its approval/polling flow, read the workspace context again before using records from the new workspace.

## Permission handling

If a tool fails because its scope is unavailable, name the missing scope and explain the requested operation. `request_scope_upgrade` can start explicit browser approval for supported write scopes, but it does not grant permission or perform a write by itself. Never use Supabase or another backend path to work around a missing scope.
