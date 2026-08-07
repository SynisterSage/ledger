# Ledger Web Route Contract

Status: Phase 1 architecture contract

This document is the source of truth for exposing the existing Ledger product
through a browser shell. It describes URL ownership and translation from the
current Electron module/focus system. It does not introduce a router, change
desktop navigation, or migrate product modules.

## 1. Platform ownership

### Public `ledger-web` surface

The public web repository owns marketing, authentication entry points, invite
entry points, and external authorization entry points:

```text
/
/features
/download
/login
/signup
/reset-password
/invite/:token
/integrations/*
```

The authenticated product should be opened from this surface at `/app`. The
product renderer and domain/API logic remain shared with Ledger; the browser
shell owns URL navigation, responsive layout, history, and browser capability
fallbacks.

### Authenticated Ledger product

```text
/app
/app/onboarding
/app/workspaces
/app/settings/*
/app/w/:workspaceId/*
```

Desktop remains on its existing Electron module/window contract. In
particular, this document does not replace `window=module`, Electron IPC,
sidebar placement, pop-outs, workspace tabs, or native capabilities.

## 2. Canonical route tree

```text
/
├── features
├── download
├── login
├── signup
├── reset-password
├── invite/:token
├── integrations/*
└── app
    ├── onboarding
    ├── workspaces
    ├── settings
    │   ├── account
    │   ├── sessions
    │   ├── accessibility
    │   ├── shortcuts
    │   └── browser-extension
    └── w/:workspaceId
        ├── home
        ├── dashboard
        ├── today
        ├── circle
        ├── calendar
        ├── notes
        │   └── :noteId
        ├── projects
        │   └── :projectId
        ├── tasks
        │   └── :taskId
        ├── events
        │   └── :eventId
        ├── teams
        │   ├── :teamId
        │   └── :teamId/settings
        ├── inbox
        ├── slack
        ├── notifications
        ├── search
        ├── capture
        │   ├── note
        │   ├── task
        │   ├── event
        │   └── reminder
        ├── follow-up
        └── settings
            ├── workspace
            ├── members
            ├── calendar
            ├── notifications
            ├── sidebar
            ├── meeting-notes
            └── integrations
                ├── google-drive
                ├── github
                ├── slack
                └── figma
```

The workspace root is not a content page. It redirects to `/home`.

## 3. Desktop module mapping

The current renderer's module identifiers are:

```text
new-tab
circle
calendar
notes
projects
teams
dashboard
notifications
settings
inbox
slack
quick-follow-up
quick-task
quick-note
quick-event
quick-reminder
```

The browser mapping is:

| Desktop module | Canonical web destination | Notes |
| --- | --- | --- |
| `new-tab` | `/app/w/:workspaceId/home` | New Tab becomes the web Home page. |
| `dashboard` | `/app/w/:workspaceId/dashboard` | Current Overview/Dashboard module. |
| dashboard `focusSection=today` | `/app/w/:workspaceId/today` | Alias into Dashboard Today section. |
| `circle` | `/app/w/:workspaceId/circle` | Team-workspace module. |
| `calendar` | `/app/w/:workspaceId/calendar` | Date, view, event, and reminder are query state. |
| `notes` | `/app/w/:workspaceId/notes` | A selected note uses `:noteId`. |
| `projects` | `/app/w/:workspaceId/projects` | A selected project uses `:projectId`. |
| `teams` | `/app/w/:workspaceId/teams` | A selected team uses `:teamId`. |
| team settings focus | `/app/w/:workspaceId/teams/:teamId/settings` | Desktop currently uses a team-settings focus context. |
| `inbox` | `/app/w/:workspaceId/inbox` | Navigation label remains “Intake.” |
| `slack` | `/app/w/:workspaceId/slack` | Capture/follow-through surface, not a Slack client. |
| `notifications` | `/app/w/:workspaceId/notifications` | Notification target opens a canonical resource URL. |
| `settings` | `/app/settings/*` or `/app/w/:workspaceId/settings/*` | Ownership depends on the settings section. |
| `quick-*` | URL-backed capture overlay | Not a primary sidebar page. |

## 4. Route semantics

### Home

`/app/w/:workspaceId/home` maps to the current New Tab module. It owns the
greeting, quick navigation, global workspace search, pinned items, unread Intake
and notification counts, module shortcuts, and quick capture entry points.

### Dashboard

`/app/w/:workspaceId/dashboard` maps to the current Overview/Dashboard module.
It owns focus items, tasks and upcoming activity, check-in/review, project
attention, recent captures, and workspace summaries.

### Today

The desktop implementation does not have a separate `today` module. Existing
search commands for Today and Check-in open `dashboard` with
`focusSection=today`. Therefore:

```text
/app/w/:workspaceId/today
    resolves to
/app/w/:workspaceId/dashboard?section=today
```

The web may display the friendly `/today` URL, but it must render the Dashboard
Today section. There is no separate Today data loader or product implementation
in Phase 1.

### Notes

The note resource is canonical at:

```text
/app/w/:workspaceId/notes/:noteId
```

Modes are query state:

```text
?view=write
?view=outline
?view=map
?view=transcribe
```

`/notes/:noteId/map` is not canonical and must not be added as a competing
route.

### Calendar

Calendar view and selection are query state:

```text
/app/w/:workspaceId/calendar?view=month
/app/w/:workspaceId/calendar?view=week
/app/w/:workspaceId/calendar?view=day
/app/w/:workspaceId/calendar?view=agenda
/app/w/:workspaceId/calendar?date=2026-08-06
/app/w/:workspaceId/calendar?event=:eventId
/app/w/:workspaceId/calendar?reminder=:reminderId
```

The desktop `focusDate` maps to `date`, and desktop event/reminder focus
contexts map to `event` or `reminder`.

### Circle

Circle is a first-class team-workspace module. It is not documented as a
project map. Person or context focus is query state:

```text
/app/w/:workspaceId/circle?person=:personId
/app/w/:workspaceId/circle?context=:contextId
```

The current desktop person-pin encoding is retained only as a legacy adapter;
new web URLs use explicit query keys.

### Projects and tasks

```text
/app/w/:workspaceId/projects
/app/w/:workspaceId/projects/:projectId
/app/w/:workspaceId/projects/:projectId?task=:taskId
/app/w/:workspaceId/tasks/:taskId
```

The project route owns project context. A selected task may render as an
inspector or overlay when opened from a project, while the standalone task
route remains available for notifications, search, extension captures, and
shared links.

### Teams

```text
/app/w/:workspaceId/teams
/app/w/:workspaceId/teams/:teamId
/app/w/:workspaceId/teams/:teamId/settings
```

Members, roles, invitations, and team settings are team-workspace concerns.

### Intake

The URL uses `/inbox` for compatibility with the existing module and path
handling; “Intake” remains the product-facing label:

```text
/app/w/:workspaceId/inbox?item=:inboxItemId
/app/w/:workspaceId/inbox?section=unprocessed
/app/w/:workspaceId/inbox?section=converted
/app/w/:workspaceId/inbox?section=snoozed
/app/w/:workspaceId/inbox?section=archived
```

The selected item inspector is query state. Converting an item navigates to the
canonical URL for the resulting note, task, event, reminder, or project.

### Slack

```text
/app/w/:workspaceId/slack
/app/w/:workspaceId/slack?capture=:captureId
```

Slack remains a capture and follow-through surface. It can open the original
Slack message, Intake item, or converted Ledger resource.

### Notifications

```text
/app/w/:workspaceId/notifications?filter=active
/app/w/:workspaceId/notifications?filter=earlier
/app/w/:workspaceId/notifications?item=:notificationId
```

Notification actions must resolve to canonical resource routes rather than
desktop module/focus URLs.

### Search

```text
/app/w/:workspaceId/search?q=:query
```

Search may render as a command-palette overlay in the browser, but the query
URL is durable and reloadable. Search commands map to the same canonical routes
as sidebar navigation.

## 5. Settings ownership

Personal settings are outside the workspace URL because they describe the
authenticated user or their personal browser/device experience:

```text
/app/settings/account
/app/settings/sessions
/app/settings/accessibility
/app/settings/shortcuts
/app/settings/browser-extension
```

Workspace settings are scoped to the active workspace:

```text
/app/w/:workspaceId/settings/workspace
/app/w/:workspaceId/settings/members
/app/w/:workspaceId/settings/calendar
/app/w/:workspaceId/settings/notifications
/app/w/:workspaceId/settings/sidebar
/app/w/:workspaceId/settings/meeting-notes
/app/w/:workspaceId/settings/integrations
```

Integration detail pages are:

```text
/app/w/:workspaceId/settings/integrations/google-drive
/app/w/:workspaceId/settings/integrations/github
/app/w/:workspaceId/settings/integrations/slack
/app/w/:workspaceId/settings/integrations/figma
```

Repository evidence shows the browser-extension token is created for the active
workspace even though the setting is personal in placement. The route remains
global, but the UI must require an active workspace and clearly show which
workspace the token targets. This is an ownership distinction, not a reason to
create per-workspace duplicate extension pages.

OAuth and external authorization callbacks remain under the public integration
surface, for example:

```text
/integrations/google/callback
/integrations/github/callback
/integrations/slack/callback
/integrations/figma/authorize
/integrations/mcp/authorize
/integrations/mcp/scope-upgrade
```

The existing renderer also recognizes authorization query payloads for Figma and
MCP. Later web implementation may preserve those callback parameters while
normalizing their public paths.

## 6. Path, query, and local state

### Path state

Use paths for durable primary locations and resources:

- workspace ID
- note ID
- project ID
- team ID
- task ID
- event ID
- settings ownership and section
- capture action type

### Query state

Use query parameters for durable view context:

- selected inspector/item
- calendar date and view
- note mode
- search query
- filters and sort
- Dashboard section
- Circle person/context focus
- overlay context such as `project` or `entity`

### Local UI state

Keep hover, tooltip, animation, temporary menus, active drag/resize state, and
editor toolbar visibility out of the URL. Sidebar appearance and other personal
UI preferences may remain in local storage where they do not represent shared
workspace data.

## 7. URL-backed overlays

Capture and follow-up actions are overlays over the current workspace route:

```text
/app/w/:workspaceId/capture/note
/app/w/:workspaceId/capture/task
/app/w/:workspaceId/capture/event
/app/w/:workspaceId/capture/reminder
/app/w/:workspaceId/follow-up
```

Context is query state:

```text
/capture/task?project=:projectId
/capture/note?project=:projectId
/capture/event?date=2026-08-06
/follow-up?entity=:entityId
```

The browser shell stores the background location when opening an overlay. A
direct visit or refresh renders the overlay with an appropriate fallback
background. Browser Back closes the overlay and restores the background URL.

Quick capture remains one conceptual flow even though the desktop renderer has
five module identifiers:

```text
quick-note      → capture/note
quick-task      → capture/task
quick-event     → capture/event
quick-reminder  → capture/reminder
quick-follow-up → follow-up
```

## 8. Redirect, auth, and restoration rules

### `/app`

1. Load the authenticated user's accessible workspaces.
2. If a valid last-used workspace exists, redirect to
   `/app/w/:workspaceId/home`.
3. If there are workspaces but no valid preference, render `/app/workspaces`.
4. If there are no workspaces, render `/app/onboarding`.

The last-used workspace preference is a navigation preference, not an access
grant. It must be checked against the current workspace membership.

### `/app/w/:workspaceId`

Redirect to:

```text
/app/w/:workspaceId/home
```

### Access and missing resources

- An inaccessible workspace ID renders an access-denied state and must not
  fetch or display workspace data.
- A missing note, project, team, task, event, or Intake item renders a proper
  not-found state within the workspace shell.
- A valid resource that was deleted or archived should explain its state where
  the API can distinguish that condition.

### Authentication restoration

Unauthenticated visits to an authenticated route preserve the original path,
query, and overlay context as a return target. After successful login, the user
returns to that target only after workspace access is revalidated.

Invite links preserve the invite token through authentication. After acceptance,
the user enters the invited workspace and returns to the intended post-invite
destination, normally the workspace Home page.

## 9. Legacy desktop focus mapping

The current Electron contract defines these focus fields:

```text
focusDate
focusProjectId
focusNoteId
focusTaskId
focusInboxId
focusContext
focusSection
```

Web equivalents are:

| Desktop field | Web equivalent |
| --- | --- |
| `focusDate` | `calendar?date=...` |
| `focusProjectId` | `/projects/:projectId` |
| `focusNoteId` | `/notes/:noteId` |
| `focusTaskId` | `/tasks/:taskId`, or `projects/:projectId?task=:taskId` when project context is known |
| `focusInboxId` | `inbox?item=:inboxItemId` |
| `focusSection` | Module-specific query such as `dashboard?section=today` or `inbox?section=unprocessed` |
| `focusContext=focus-event:id` | `calendar?event=:eventId` |
| `focusContext=focus-reminder:id` | `calendar?reminder=:reminderId` |
| `focusContext=team:id` | `/app/w/:workspaceId/teams/:teamId` |
| `focusContext=team-settings:id` | `/app/w/:workspaceId/teams/:teamId/settings` |
| `focusContext=ledger-person|id|name` | `/app/w/:workspaceId/circle?person=:personId` |
| `focusContext=try:template` | `/app/w/:workspaceId/notes?view=templates` or a template overlay; exact UI route remains unresolved |
| `focusContext=integrations` | `/app/w/:workspaceId/settings/integrations` |
| `focusContext=shortcuts` | `/app/settings/shortcuts` |
| `focusContext=workspace` | `/app/w/:workspaceId/settings/workspace` |

The `window=module` and `module=` parameters are desktop transport details, not
web URL contract fields. A later adapter may parse them for compatibility, but
new browser navigation must produce canonical web URLs.

## 10. Team-only restrictions

The current New Tab navigation marks Circle and Teams as team-only. Web access
must enforce the same rule using the active workspace's membership/type rather
than merely hiding links:

```text
personal workspace → Circle and Teams unavailable
team workspace     → Circle and Teams available according to permissions
```

Workspace members, invitations, roles, team settings, shared Slack settings,
and shared integrations must also enforce API permissions. A hidden navigation
item is not an authorization boundary.

## 11. Canonical resource URL rules

Every durable resource gets one canonical web URL:

```text
note       → /app/w/:workspaceId/notes/:noteId
project    → /app/w/:workspaceId/projects/:projectId
team       → /app/w/:workspaceId/teams/:teamId
task       → /app/w/:workspaceId/tasks/:taskId
event      → /app/w/:workspaceId/events/:eventId
```

Contextual inspectors may use query parameters on the parent page, but they do
not create alternate canonical resource URLs. Notifications, search, browser
extension captures, Slack conversions, and shared links must resolve to these
URLs.

## 12. Unresolved decisions

These do not block the route contract but need an implementation decision later:

1. Whether the web shell displays `/today` in the address bar after resolving
   the Dashboard Today alias, or immediately normalizes to
   `/dashboard?section=today`.
2. Whether template browsing receives a dedicated `/notes?view=templates`
   query state or remains a notes overlay.
3. The final public callback path and parameter names for the existing Figma
   and MCP authorization flows. Their current renderer uses query payloads.
4. Whether a standalone task/event page renders as a full page or as a modal
   when opened from a notification or shared link.
5. Whether workspace tabs have a browser equivalent. They are a desktop
   persistent-window concept and are not required for the Phase 1 route tree.

## 13. Phase 1 out of scope

- Browser router mounting
- `WebAppShell`
- Responsive sidebar implementation
- Module migration
- New web-specific UI
- Electron navigation changes
- Desktop sidebar or pop-out changes
- Platform capability adapters
- PWA/offline behavior
- Browser notifications
- Authentication rewrites
- New APIs, database migrations, or domain models

Phase 1 is complete when later implementation can consume this document without
reopening primary path ownership, resource URL conventions, or overlay history
behavior.
