# Ledger MCP tool map

This map reflects the registrations in `backend/mcp/server.js`. The connector must already be authenticated. All data operations are restricted by the server to the connection's approved workspace.

## Resource

| Registered name | URI | Purpose | Scope | Mode | Inputs, confirmation, and limits |
|---|---|---|---|---|---|
| `ledger-workspace-context` | `ledger://workspace/current/context` | Read current workspace identity, available-scope summary, project summaries, Today items, overdue tasks, upcoming events, and recent note previews. | `workspace:read`; included sections are filtered by granted read scopes. | Read | No inputs. Use first when workspace context is needed. The response is bounded and contains previews, not arbitrary full note content. |

## Read tools

| Registered name | Purpose | Required scope | Mode | Important inputs | Confirmation considerations | Important limitations |
|---|---|---|---|---|---|---|
| `list_projects` | List project summaries with bounded task and linked-note counts, dates, lead, and owner team. | `projects:read` | Read | Optional `status`; `limit`; `cursor`. | None; present results as retrieved data. | Bounded and paginated; it does not return full project context or create/update projects. |
| `get_project` | Retrieve one project, bounded linked-note summaries, and next-action/task summaries. | `projects:read` | Read | Required `projectId`. | None. Confirm the ID from a prior result when possible. | One project at a time; linked notes are summaries/snippets, not full content. No project mutation. |
| `search_notes` | Search note titles and content and return sanitized snippets. | `notes:read` | Read | Required `query` (2–200 chars); optional `dateFrom`, `dateTo`, `limit`, `cursor`. | None. Use `get_note` before relying on full note content. | Date range is bounded by the server; results are snippets and paginated. |
| `list_notes` | Browse bounded note metadata and previews before selecting a note. | `notes:read` | Read | Optional `dateFrom`, `dateTo`, `sectionId`, `limit`, `cursor`. | None. | Does not return full content; no section/folder management tool is exposed. |
| `list_tasks` | List bounded task summaries for filtering and planning. | `tasks:read` | Read | Optional `status`, `projectId`, `assignee` (including `me`), `dueFrom`, `dueTo`, `overdue`, `limit`, `cursor`. | None. Use current results before proposing changes. | Bounded and paginated; does not include full descriptions. `overdue` means due before the server's current date and not completed. |
| `get_task` | Retrieve one task's current editable and planning fields. | `tasks:read` | Read | Required `taskId`. | None. Use `updated_at` for concurrency-safe writes. | One task at a time; does not modify it. |
| `get_note` | Retrieve note metadata and, optionally, capped sanitized plain text. | `notes:read` | Read | Required `noteId`; optional `includeContent` (default `false`). | None. Reading full content is appropriate for an explicitly selected note or follow-up workflow. | Full content is plain text capped at 20,000 characters; rich HTML and files are not returned as editable MCP content. |
| `list_upcoming_events` | List upcoming calendar events and incomplete reminders in one bounded stream. | `calendar:read` | Read | Optional `from`, `to`, `limit`, `cursor`; defaults to now through about 30 days. | None. | Read-only. It does not create, edit, delete, or reschedule events/reminders. Date ranges are server-bounded. |
| `get_today` | Retrieve Today tasks/focus items, reminders, events, and available daily check-in fields for a date. | `daily:read` | Read | Optional `date`; defaults to the server's current date. | None. | Read-only; it does not update check-in fields or remove focus items. |

## Approval and workspace-control tools

| Registered name | Purpose | Required scope | Mode | Important inputs | Confirmation considerations | Important limitations |
|---|---|---|---|---|---|---|
| `request_scope_upgrade` | Start explicit browser approval for additional non-destructive write scopes. | No fixed data scope; requests one or more write scopes. | Approval flow | Required `scopes`: one to five of `intake:write`, `tasks:write`, `notes:write`, `daily:write`, `projects:write`. | Tell the user which permission is needed. Approval URL/session creation is not approval completion. | No data changes until the user approves and the connection receives the new scope. |
| `switch_workspace` | Start browser approval to move the MCP connection to another Ledger workspace. | No fixed data scope; server controls availability. | Approval flow | Optional `workspaceId`; otherwise the user chooses in Ledger. | Explicitly tell the user a browser approval is required. Do not claim a switch completed from the returned URL. | The client cannot switch directly; the tool returns an authorization flow and polling details. |

## Write tools

| Registered name | Purpose | Required scope | Mode | Important inputs | Confirmation considerations | Important limitations |
|---|---|---|---|---|---|---|
| `create_project` | Create a new project container in the approved workspace. | `projects:write` | Write | Required `title`, `idempotencyKey`; optional `description`, `status`, `progress`, `startDate`, `dueDate`, `projectType`, `color`, `leadId`, `ownerTeamId`. | Confirm when the project request is ambiguous or could duplicate an existing project. | Creates the container only; it does not create tasks. Same-title projects are checked and may return the existing project instead. |
| `send_to_intake` | Capture unstructured information as a shared Intake item without converting it to a task or note. | `intake:write` | Write | Required `title`, `idempotencyKey`; optional `body`, HTTPS/HTTP `sourceUrl`, `sourceLabel`. | Safe for a clearly requested single capture; confirm bulk capture. | Intake remains unprocessed. It does not classify, create, or link a task/note/project. |
| `create_task` | Create a shared task, optionally linked to an existing project and member. | `tasks:write` | Write | Required `title`, `idempotencyKey`; optional `description`, `projectId`, `assigneeId`, `priority`, `status`, `dueDate`, `dueTime`. | A clearly requested single task may proceed; confirm several tasks or inferred assignments/dates. | Requires existing same-workspace project/member IDs. No recurring-task, dependency, or bulk-create support. |
| `update_task` | Update supported non-destructive task fields. | `tasks:write` | Write | Required `taskId`; at least one of `title`, `description`, `projectId`, `assigneeId`, `priority`, `status`, `dueDate`, `dueTime`; optional `expectedUpdatedAt`. | Confirm multi-field, bulk, ambiguous, or assignment-changing edits. Use `expectedUpdatedAt` after a read. | Workspace and ownership cannot change. Only listed fields are editable. |
| `complete_task` | Mark a task completed while preserving the task record. | `tasks:write` | Write | Required `taskId`; optional `expectedUpdatedAt`. | A clearly requested single completion may proceed; confirm bulk completion. | Non-destructive completion only; no delete, archive, or restore tool is exposed. Already-completed tasks are reported as such. |
| `reschedule_task` | Change or clear a task due date/time without changing other planning fields. | `tasks:write` | Write | Required `taskId`, `dueDate` (date or `null`); optional `dueTime` (time or `null`), `expectedUpdatedAt`. | Confirm if the new date is inferred, affects several tasks, or creates a meaningful commitment. | Only tasks are rescheduled; calendar events/reminders are not. |
| `create_note` | Create a shared plain-text note, optionally linked to an existing project or section. | `notes:write` | Write | Required `title`, `idempotencyKey`; optional plain-text `content`, `projectId`, `sectionId`. | Confirm several notes or an uncertain destination. | Rich HTML, file uploads, nested parent assignment, and arbitrary section creation are not accepted. Content is capped at 20,000 characters. |
| `append_to_note` | Append plain text to an existing note without replacing prior content. | `notes:write` | Write | Required `noteId`, `content`, `idempotencyKey`; optional `expectedUpdatedAt`. | Confirm before adding inferred meeting content or changing a note not explicitly selected. Use `expectedUpdatedAt` after reading. | Append-only; no replace/delete/rich formatting/file upload. Resulting plain text is capped at 20,000 characters. |
| `add_to_focus` | Add an existing task to Today's focus. | `daily:write` | Write | Required `taskId`, `idempotencyKey`; optional `date`, `position`. | Propose focus changes and wait for approval, especially for multiple items. | Maximum three active focus items; completed tasks cannot be added. No remove-from-focus tool is exposed. |

## Scope summary

Read scopes are `workspace:read`, `projects:read`, `tasks:read`, `notes:read`, `calendar:read`, and `daily:read`. Write scopes are `intake:write`, `tasks:write`, `notes:write`, `daily:write`, and `projects:write`. Missing scopes must be reported rather than bypassed.
