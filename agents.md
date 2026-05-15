# AGENTS.md — Ledger Engineering + Product Build Guide

## Purpose

This file gives AI coding agents and collaborators the context needed to work on Ledger without drifting into generic SaaS UI, local-only state, or half-finished frontend-only features.

Ledger is an Electron desktop app built with React, TypeScript, Tailwind, and a Supabase-backed workspace model. The product is a sidebar-first accountability workspace for capturing thoughts, planning the day, organizing projects/notes/calendar context, and following through.

The goal is not to build a Notion clone, Google Calendar clone, or generic productivity dashboard. The goal is to build a calm desktop command center around this loop:

**Capture → Plan → Execute → Review**

Every feature should support that loop.

---

## Product Definition

Ledger is a sidebar-first desktop workspace for daily accountability.

It helps users:

* capture notes, tasks, projects, events, reminders, and ideas quickly
* keep context beside the apps they already use
* organize scattered thoughts into projects, notes, and calendar items
* choose what matters today
* review what moved, what got blocked, and what comes next

Ledger should feel like:

* a calm desktop companion
* a persistent command center
* a lightweight project/notes/calendar/accountability system
* native-feeling on macOS and Windows

Ledger should not feel like:

* Notion
* Google Docs
* Google Calendar
* Jira
* generic SaaS dashboard slop
* a pile of unrelated modules

---

## Core Product Principles

### 1. Daily accountability is the spine

Tasks, notes, projects, calendar, sidebar, and review should all feed the daily accountability loop.

Ask before adding anything:

> Does this help the user capture, plan, execute, or review?

If not, simplify it or cut it.

### 2. Sidebar-first, not page-first

The sidebar is Ledger’s differentiator. It should feel like a persistent layer beside the user’s work.

The sidebar is for:

* quick capture
* today’s tasks
* navigation
* project/calendar/note access
* fast context

Pop-out windows are for expanded workspaces.

### 3. Pop-outs are expanded workspaces

A pop-out should not feel like a cramped floating widget.

Sidebar mode = compact command center.
Pop-out mode = spacious focused workspace.

### 4. Workspace-aware by default

Ledger supports workspaces and multiple users. Do not build persistent features as local-only unless explicitly requested.

Every persistent object should generally include:

* `workspace_id`
* `created_by` when ownership matters
* `updated_by` when edits matter
* timestamps

### 5. Local storage is only for personal UI preferences

Use localStorage for things like:

* collapsed panels
* last selected tab
* window bounds
* sidebar visibility preference

Do not use localStorage as the source of truth for shared data like:

* notes
* projects
* sections
* calendars
* events
* tasks
* linked notes
* workspace settings

### 6. Avoid frontend-only features

If a feature creates persistent structure, it needs:

* database/schema changes
* API/backend changes
* frontend API client changes
* UI state updates
* workspace handling
* edge cases

Do not only mock it visually.

---

## Architecture Assumptions

Ledger uses:

* Electron
* React
* TypeScript
* Tailwind CSS
* Supabase/Postgres backend
* workspace-aware data model
* IPC between renderer and Electron main process for desktop/window behavior

When implementing any feature, check existing patterns before inventing a new one.

---

## Required Implementation Checklist for New Persistent Features

For any feature that persists, organize the implementation across the full stack.

### 1. Product behavior

Define:

* what the user is trying to do
* where the feature appears
* how it connects to capture/plan/execute/review
* what is out of scope

### 2. Data model

Add or update tables/columns.

Include:

* `workspace_id`
* `created_by`
* `updated_by` if useful
* `created_at`
* `updated_at`
* indexes for common queries
* foreign keys
* safe delete behavior

### 3. SQL migration

Any new persisted object or relationship needs a migration.

Examples:

* note sections
* project context notes
* linked notes
* calendars
* event/project/note links
* reminders

### 4. API/backend

Add or update endpoints.

Common needs:

* GET list by active workspace
* POST create
* PATCH update
* DELETE/archive
* move/reorder endpoints if drag/drop exists
* validate workspace access
* validate related records belong to same workspace

### 5. Frontend API client

Expose matching frontend methods.

Do not call raw fetch all over the UI.

### 6. UI components/state

Build the component experience.

Make sure state updates after API responses and survives refresh/workspace switch.

### 7. Permissions/workspace safety

Rules:

* users should only access data in workspaces they belong to
* links between records must stay within the same workspace
* destructive actions should be confirmed when they affect shared data

### 8. Edge cases

Plan for:

* empty states
* missing linked data
* deleted linked records
* no active workspace
* read-only users if roles exist
* offline/failure states if relevant

---

## Electron / Desktop Requirements

Ledger should feel native on macOS and Windows.

### Window behavior

Use Electron main process + IPC for:

* pop-out windows
* always-on-top
* transparency/blur
* auto-hide
* sidebar placement
* window bounds persistence
* native shortcuts

Avoid platform-specific hacks unless there is a Windows/macOS fallback.

### Platform conventions

Use platform-aware shortcuts:

* macOS: `Cmd`
* Windows: `Ctrl`

Avoid macOS-only assumptions in renderer code.

### Pop-out windows

Pop-out module windows should use a shared global system.

Affected modules:

* Dashboard
* Notes
* Projects
* Calendar
* Settings
* future modules

Default full-module pop-out size:

```ts
const DEFAULT_POPOUT_BOUNDS = {
  width: 1440,
  height: 860,
}
```

Minimum usable size:

```ts
const MIN_POPOUT_BOUNDS = {
  width: 1100,
  height: 720,
}
```

Full 3-panel layouts should target:

```ts
const PANEL_WIDTHS = {
  left: 280,
  right: 320,
  centerMin: 720,
}
```

Priority when space is limited:

1. center content
2. left navigation
3. right inspector/context

If width is below ~1200px, hide/collapse the right inspector first.
If width is below ~1000px, enter focus mode or collapse side panels.

### Sidebar-aware pop-out placement

When opening any module from the sidebar, the pop-out should open relative to the sidebar.

Supported sidebar states:

* left
* right
* top
* bottom
* floating
* auto-hide / hover

Placement rules:

* sidebar left → open pop-out to the right
* sidebar right → open pop-out to the left
* sidebar floating → choose side with more screen room
* sidebar auto-hide/hover → use current visible bounds if visible; otherwise use saved edge/position
* keep the pop-out fully on-screen
* use current display/work area via Electron display APIs
* use a small gap, about 12–16px

Use one helper, not duplicated logic:

```ts
createPopoutWindow({
  module,
  sidebarBounds,
  sidebarPosition,
  sidebarMode,
  sidebarVisible,
})
```

Remember window bounds per module, but ignore stale/offscreen bounds.

---

## Sidebar Customization

Sidebar customization should support:

* position: left, right, top, bottom, floating
* transparency/opacity slider
* blur/glass effect toggle
* default state: expanded, collapsed, remember last state
* always-on-top toggle
* auto-hide toggle
* manual dock mode later

Important:

* Do not overbuild customization.
* Do not make settings the product.
* Sidebar settings are personal UI preferences and can use localStorage unless they affect shared workspace behavior.
* Desktop/window behavior must go through Electron IPC.

### Manual Dock Mode Direction

Future direction:

* user drags sidebar near another app/window/screen edge
* show snap zones
* drop to dock
* store docked side/state

Do not build full automatic OS-aware app attachment yet.

Out of scope for now:

* resizing third-party apps
* active app tracking
* advanced tiling window manager behavior
* complex multi-monitor docking

---

## Notes Module

Notes should support:

* workspace-aware notes
* sections/folders
* nested notes via parent/child relationships
* templates
* tags later if needed
* mind map mode as a view/mode, not necessarily a separate note type
* linked projects/events later
* right inspector with details/workspace/recent updates

Notes should not become Notion.

Avoid:

* databases
* infinite block customization
* enterprise wiki complexity
* heavy permissions UI

### Notes sidebar

The left Notes sidebar should feel like a clean file tree.

It should support:

* sections
* folders/parent notes
* child notes
* drag/drop organization
* collapsed Templates at bottom
* white context menus
* subtle color coding

Templates should be secondary, collapsed, and not permanently expanded.

### Note sections data model

If sections exist, they must be persisted.

Suggested table:

```sql
CREATE TABLE IF NOT EXISTS note_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#FF5F40',
  sort_order INTEGER DEFAULT 0,
  collapsed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES note_sections(id) ON DELETE SET NULL;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES notes(id) ON DELETE SET NULL;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

ALTER TABLE notes
ADD COLUMN IF NOT EXISTS depth INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_note_sections_workspace_id
ON note_sections(workspace_id);

CREATE INDEX IF NOT EXISTS idx_notes_workspace_section
ON notes(workspace_id, section_id);

CREATE INDEX IF NOT EXISTS idx_notes_parent_id
ON notes(parent_id);
```

Notes with `section_id IS NULL` should appear under a virtual `Unsorted` section.

Default sections if workspace has none:

* Work
* Personal
* Ideas

### Notes right inspector

The Notes right pane should be compact and row-based.

Good structure:

* Current note
* Details
* Workspace
* Recent updates

Workspace section can include lightweight presence/context:

* workspace name
* created by
* last edited by
* viewing: only you / avatars if real presence exists

Do not build full Google Docs/Figma real-time collaboration yet.

Allowed MVP collaboration metadata:

* created by
* last edited by
* viewing only you
* lightweight presence if already available

Out of scope:

* live cursors
* simultaneous rich-text conflict resolution
* comments
* mentions
* version history

---

## Projects Module

Projects should be lightweight outcome containers, not full project management software.

A project should answer:

* what is the goal?
* what is the status?
* what is progress?
* what needs to happen next?
* what is due?
* what context is linked?

### Projects left sidebar

The Projects left sidebar should feel like a clean project list, not mini dashboards.

Project items should show:

* title
* status/progress text
* due date
* thin progress bar

Avoid:

* big status pills
* clipped date ranges
* heavy blue active states
* loud progress bars

Status in sidebar should be text/dot, not a large pill.

Progress bar should use the project color, not a red-to-green gradient.

### Project color and progress

Project color represents identity.

Progress percentage is not a moral state. A project at 10% is not bad; it may simply be early.

Use:

* track = soft gray
* fill = project color
* knob = project color if present

Status may have semantic color:

* Not started = gray
* In progress = project color or blue
* Paused = amber/gray
* Completed = green

### Projects center pane

The center should feel like a project command center.

Suggested order:

1. Project overview
2. Timeline/details
3. Objective
4. Next actions
5. Linked notes
6. Activity

Status should appear once, preferably as a dropdown in the overview card.

Avoid duplicate status pill + dropdown.

Rename “Project tasks” to:

**Next actions**

Task rows should be compact, not giant cards.

### Project context right pane

The Projects right pane should be a project side notebook/context panel, not an at-a-glance stat card.

Suggested structure:

* Project context
* Project notes
* Linked notes
* Details
* Workspace
* Recent activity

Project notes should persist on the project and be workspace-aware.

Suggested column:

```sql
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS context_html TEXT DEFAULT '';
```

or:

```sql
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS notes_html TEXT DEFAULT '';
```

Linked notes can use a join table later:

```sql
CREATE TABLE IF NOT EXISTS project_note_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, note_id)
);
```

Do not fake persistence for linked notes.

---

## Calendar Module

Calendar should connect time to projects, notes, tasks, reminders, and follow-through.

It should not just be a generic event grid.

Calendar should answer:

* what does my time look like?
* what event is selected?
* what project/note is connected?
* what follow-up should I create?
* what event notes should be captured?

### Calendar left pane

The left pane is mostly calendar controls:

* mini month
* overview
* calendars
* quick actions

Calendars should support multiple calendars eventually.

Default calendar:

* Personal

Users should be able to create:

* Personal
* Work
* School
* Projects
* custom calendars

Keep calendar creation simple.

### Calendar data model

Calendars should be workspace-aware.

Suggested table:

```sql
CREATE TABLE IF NOT EXISTS calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#FF5F40',
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendars_workspace_id
ON calendars(workspace_id);
```

Events should support context:

```sql
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL;

ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES notes(id) ON DELETE SET NULL;

ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS notes_html TEXT DEFAULT '';

ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'planned';
```

Validate that linked project/note/calendar belong to the same workspace.

### New Event modal

Current event modal is too basic if it only has title/date/time/repeat.

MVP fields:

* title
* date
* start time
* end time optional
* calendar
* linked project optional
* linked note optional
* notes optional
* repeat

Do not overbuild invites/attendees yet.

### New Reminder modal

Reminder should be faster and task-like.

Fields:

* reminder title
* due date
* due time optional
* calendar/list
* linked project optional
* linked note optional
* notes optional

### Calendar right pane

The right pane should visually match the compact Notes inspector style.

Keep logic/content, but style as:

* compact rows
* muted uppercase labels
* dark navy values
* subtle dividers
* no heavy cards
* no bright red/orange link spam

Suggested sections:

* Day context
* Selected event
* Project
* Linked note
* Event notes
* Follow-ups
* Agenda

Do not show big “At a glance” cards.

### Event follow-ups

A selected event should allow:

* add event notes
* link project
* link note
* create follow-up task

This is a key Ledger differentiator.

---

## Dashboard Module

Dashboard should be Ledger’s daily command center, not a generic stats page.

It should answer:

* what needs my attention today?
* what are my 1–3 focus items?
* what is coming up?
* which projects need attention?
* what did I finish?
* what is blocked?
* what should happen next?

### Dashboard should prioritize

1. Today’s Focus
2. Quick Capture
3. Upcoming timeline
4. Projects needing attention
5. Daily Check-In / Review
6. Recent captures

Avoid generic stat-card grids.

### Header copy

Preferred:

```text
Good to see you, Lex.
What needs your attention today?
```

### Today’s Focus

This should be the main dashboard card.

Encourage 1–3 focus items.

Good empty state:

```text
No focus set yet.
Pull from projects, calendar, or quick capture.
```

### Daily Check-In

Daily Check-In is core to Ledger. It should not be buried.

Fields:

* Finished
* Blocked
* First task tomorrow

The dashboard may adapt by time of day:

* morning: set focus
* evening: close the loop

### Needs Attention column

A useful right column can include:

* upcoming events
* projects due soon/paused/no next action
* recent captures

Do not just show module preview cards.

---

## Settings Module

Settings should include sidebar personalization, accessibility, workspace/account settings, and integrations later.

Sidebar settings MVP:

* position
* opacity/transparency
* blur/glass effect
* default state
* always on top
* auto-hide

Accessibility settings:

* reduce motion
* reduce transparency
* high contrast
* larger text
* keyboard shortcuts

Do not overbuild settings into the product’s identity.

---

## Integrations Strategy

Integrations are valuable, but they must support the core Ledger loop.

Do not integrate everything just because possible.

Ask:

> What outside signal should Ledger help the user act on?

### Priority integrations

1. Google Calendar
2. Apple Calendar / CalDAV / improved ICS handling
3. Slack save-to-task/note/reminder
4. Browser extension
5. Gmail follow-ups
6. GitHub / Linear for builders
7. Markdown import/export
8. Google Drive/Docs links

### Integration principle

Imported items should land in an Inbox first when ambiguous.

Inbox actions:

* turn into task
* turn into note
* link to project
* schedule event
* archive

Avoid dumping external chaos directly into the workspace.

### Calendar integration direction

ICS import exists now. Later:

* Google Calendar sync
* Apple Calendar/CalDAV
* Outlook Calendar later
* event notes
* event follow-up tasks
* project-linked events

### Slack integration direction

Do not build a Slack client.

Useful actions:

* save Slack message to Ledger as note
* create task from message
* create reminder from message
* link Slack thread to project
* daily digest of saved Slack follow-ups

---

## Website / Marketing Site Direction

Ledger website should be clean, minimal, and product-led.

It should not look vibe-coded.

Brand references:

* Linear for product storytelling
* Raycast for desktop command center positioning
* Arc for sidebar/workspace personality
* Sunsama for calm accountability language

### MVP pages

* `/` homepage
* `/features`
* `/guide`
* `/download`

No pricing if Ledger is free.

Header:

```text
Ledger    Features    Guide    Download
```

### Homepage structure

1. Hero
2. Feature showcase sections
3. Desktop companion / not another tab section
4. Final CTA
5. Footer

Hero may use video showing Ledger docking beside another app.

Feature showcases should not be generic cards.

Use three product story sections:

#### 1.0 Sidebar

```text
Keep your day beside your work

Dock Ledger next to the apps you already use, capture thoughts the moment they appear, and get back to work without losing context.
```

#### 2.0 Planning

```text
Turn ideas into a plan

Create projects, add next actions, and schedule follow-ups before scattered thoughts disappear into another tab.
```

#### 3.0 Review

```text
Close the loop before tomorrow

End the day with a quick check-in that captures what moved, what got blocked, and what needs your attention next.
```

### Visual direction

Use designed product compositions, not random screenshots.

Hero can use a polished video.
Feature sections can use layered static compositions or short loops.

Avoid fake testimonials unless real.

Footer should be simple:

* Logo
* tagline
* Product links
* Resources
* Legal
* © 2026 Ledger.

---

## UI / Visual Style Rules

Ledger should feel:

* calm
* structured
* spacious
* premium
* native desktop
* warm, not flashy

Use:

* warm off-white backgrounds
* dark navy text
* muted gray labels
* Ledger orange accents
* soft borders
* subtle shadows
* compact rows in side inspectors
* fewer, stronger cards

Avoid:

* generic 4-card SaaS grids
* bright status pills everywhere
* repeated metadata
* duplicate controls
* giant cards for small information
* nested boxes inside boxes
* red/orange text that looks destructive when it is just a link
* blue selected states that clash with Ledger brand
* overly playful animations

### Brand colors

Use or map equivalents:

```ts
const ledgerColors = {
  navy: '#111827',
  muted: '#4B5563',
  orange: '#FF5F40',
  softOrange: '#FDBA74',
  cream: '#FFF7ED',
  offWhite: '#FFFBF7',
  border: '#F3D7BE',
}
```

---

## Context Menus

Context menus should be white/light, not dark, unless the whole surface is dark.

Style:

* white background
* thin light border
* soft shadow
* 12–14px radius
* dark gray/navy text
* red only for destructive actions
* small icons optional
* no bullet dots between icon and label

---

## Rich Text / Notes UX

Notes and project context should feel like calm writing surfaces.

Avoid admin-form-like editor chrome.

Toolbar should be compact.

Metadata should live in the right inspector, not as huge cards in the center editor.

Mind map should be a mode/view inside a note, not a heavy separate creation path for MVP.

---

## Drag and Drop Rules

For note/project organization drag-drop:

* use clear hover target
* show insertion line between siblings
* highlight row when dropping onto parent
* auto-expand collapsed parent after 600–800ms
* prevent circular nesting
* persist order through API/database

Do not implement drag/drop as UI-only state.

---

## Workspace / Collaboration Rules

Workspace-aware: yes.
Full collaborative editing: not yet.

Good MVP collaboration metadata:

* workspace name
* created by
* last edited by
* viewing only you / real viewers if available

Avoid for now:

* live cursors
* simultaneous editing conflict resolution
* comments
* mentions
* version history
* permissions UI beyond existing roles

For any shared mutation:

* validate workspace access
* validate same-workspace relationships
* respect roles if implemented

---

## Prompts / Agent Behavior

When asked to implement a Ledger feature, do not only provide UI instructions.

Include:

* UX behavior
* data model
* SQL migration if needed
* API routes
* frontend API client updates
* workspace rules
* Electron/IPC requirements if desktop behavior is involved
* edge cases
* out-of-scope list

If the user asks for a simple design-only cleanup, keep it minimal and do not over-engineer.

---

## Out-of-Scope Patterns to Avoid

Avoid building these unless explicitly requested:

* Notion databases
* full Google Docs collaboration
* full Google Calendar clone
* advanced recurring event engine
* attendee invites/email scheduling
* Jira-style project management
* huge integrations marketplace
* complex permissions UI
* enterprise workspace admin
* full Slack/email clients
* advanced tiling window manager
* OS-level resizing of third-party apps

---

## Product North Star

Ledger should help a user say:

> I know what I’m doing today, why it matters, what needs attention, and what comes next.

Everything should support that.