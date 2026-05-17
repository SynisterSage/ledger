# Ledger

> A calm workspace for notes, projects, planning, and accountability.

Ledger is a desktop-first productivity workspace built with intentionality in mind — designed to help people capture ideas quickly, organize work without friction, and maintain context across notes, projects, tasks, and calendars.

Unlike bloated enterprise tools, Ledger focuses on clarity, flow, and lightweight structure.

---

# Philosophy

Ledger is built around a few core ideas:

- **Capture quickly**
  Thoughts should never disappear because they were trapped behind tabs or context switching.

- **Context matters**
  Notes, projects, events, and tasks should connect naturally.

- **Planning should feel calm**
  Interfaces should reduce noise, not create more of it.

- **Desktop-first productivity**
  Ledger is designed to live beside your work, not replace it.

- **Intentional collaboration**
  Small teams, internships, studios, and focused groups over enterprise complexity.

---

# Features

## Notes

A rich-text note system powered by Lexical.

### Includes

- Rich text editing
- Version history
- Image paste/drop uploads
- Templates
- Linked projects/events
- Workspace-aware notes
- Autosave
- Inspector metadata
- Mind map mode (WIP)

---

## Projects

Simple project tracking without enterprise overhead.

### Includes

- Progress tracking
- Objectives
- Task management
- Timeline planning
- Workspace context
- Linked notes
- Activity metadata
- Project status states

---

## Calendar

A lightweight scheduling layer integrated into Ledger.

### Includes

- Events
- Reminders
- Follow-ups
- Project linking
- Note linking
- `.ics` import support
- Multiple calendars
- Workspace-aware scheduling

---

## Dashboard

A personalized workspace overview.

### Includes

- Today queue
- Focus priorities
- Upcoming timeline
- Recent captures
- Project attention tracking
- Workspace summaries

---

## Expanded Sidebar

Ledger’s persistent quick-access layer.

### Includes

- Universal search
- Today queue
- Quick capture
- Workspace switching
- Fast navigation
- Compact operational planning

---

# Collaboration (In Progress)

Ledger is evolving toward lightweight collaborative workspaces.

Planned/implemented features:

- Shared workspaces
- Invite links
- Workspace members
- Shared projects
- Shared notes
- Presence indicators
- Version recovery safeguards

Ledger intentionally avoids heavy enterprise collaboration complexity.

---

# Tech Stack

## Frontend

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Lexical Editor

## Backend / Infrastructure

- Supabase
  - Postgres
  - Auth
  - Realtime
  - Storage

---

# Design Direction

Ledger aims for:

- calm interfaces
- compact density
- minimal noise
- intentional hierarchy
- warm desktop-native feeling

Inspirations include:

- Linear
- Things
- Raycast
- Apple Reminders
- Arc
- Notion (without the bloat)

---

# Current Architecture

Ledger uses:

- workspace-aware data structures
- linked entities between notes/projects/events
- version history for recovery safety
- optimistic local UX
- Supabase realtime for lightweight sync

---

# Storage

Ledger currently supports:

- rich text persistence
- image uploads
- version snapshots
- workspace-scoped storage paths

Example upload structure:

```txt
workspaces/{workspaceId}/notes/{noteId}/images/{timestamp}-{random}.png
````

---

# Security Notes

Current storage implementation is MVP-oriented.

Planned improvements:

* signed URLs
* private storage buckets
* stronger workspace access enforcement
* collaborative permission layers

---

# Roadmap

## Near Term

* Workspace invites
* Shared workspaces
* Better template system
* Dashboard refinement
* Improved calendar context
* Notes collaboration safeguards

## Future

* Presence
* Realtime collaboration
* Native integrations
* Desktop reminders
* Google/Apple calendar sync
* Slack integrations
* AI-assisted organization

---

# Project Status

Ledger is actively in development and evolving rapidly.

The focus right now is:

* stability
* thoughtful UX
* reducing “vibe-coded” complexity
* creating a coherent desktop productivity system

---

# Development

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

---

# Vision

Ledger is not trying to become another bloated productivity suite.

The goal is a calm, context-aware workspace that helps people:

* think clearly
* stay organized
* maintain momentum
* capture ideas instantly
* and close the loop on their work.