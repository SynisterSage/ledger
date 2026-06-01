# AGENTS.md

## Ledger Mobile Agent Instructions

You are working on the Ledger mobile app inside `apps/mobile`.

Ledger Mobile is a lightweight companion to the desktop Ledger app. It is not a full rebuild of desktop Ledger.

The mobile app exists for three core things:

1. See what needs attention today.
2. Capture things quickly while away from the computer.
3. Respond to notifications/reminders.

Do not overbuild. Do not create one-shot slop. Work section by section.

---

## Product Direction

Ledger Mobile should feel like:

> A simple capture and attention layer for Ledger workspaces.

It should not feel like:

> Desktop Ledger squeezed onto a phone.

Desktop Ledger is the full workspace command center.

Mobile Ledger is for:

* quick reminders
* quick tasks
* quick events
* quick notes
* project actions
* notifications
* simple Today view
* share sheet captures later
* Siri/Shortcuts later

---

## Main Navigation

The app should center around three primary areas:

1. Today
2. Capture
3. Notifications

Do not add extra main tabs unless explicitly requested.

Inbox may exist as a secondary surface later, but it should not be a primary mobile tab in the first version.

---

## Build Process

Work in small focused passes.

Do not build the full app in one prompt.

Preferred workflow:

1. Scaffold structure
2. Welcome/auth entry
3. Today screen
4. Capture screen
5. Notifications screen
6. API wiring
7. Share sheet/Siri later

If a task is broad, ask to break it into smaller passes.

---

## Design Philosophy

Use Ledger’s existing desktop design direction:

* minimal
* calm
* clean
* editorial
* Apple-like
* Notion-like
* Linear-like
* text-first
* easy to read
* useful before decorative

Avoid:

* gradients
* heavy shadows
* giant cards
* nested cards
* loud badges
* tracked uppercase labels
* bubbly SaaS UI
* fake dashboard clutter
* over-designed empty states
* complex animations
* full desktop-style layouts

The app should feel intentional, not vibe-coded.

---

## Visual Rules

Use:

* warm off-white backgrounds
* dark navy primary text
* muted gray secondary text
* Ledger orange for primary actions only
* thin dividers
* simple rows
* compact forms
* clear hierarchy
* subtle rounded corners
* native-feeling spacing

Avoid:

* card within card
* heavy drop shadows
* glassmorphism on mobile
* decorative gradients
* huge icons
* unnecessary illustration
* complex dashboard widgets

---

## Mobile UX Rules

Mobile flows must be short.

A user should be able to add a reminder, task, event, or note quickly.

Do not use desktop-style three-pane layouts.

Do not build full rich text editing in v1.

Do not build full project management in v1.

Do not build full calendar month/week views in v1 unless requested.

---

## Auth Direction

The app is account-based.

Use a soft hard-gated auth flow:

1. Welcome screen
2. Sign in / Create account
3. Choose default capture workspace
4. Enable notifications
5. Today

Do not build anonymous/local mode in v1.

The welcome screen should explain that mobile syncs with Ledger desktop workspaces.

---

## Workspace Logic

Ledger’s core product idea is:

> Separate workspaces. Unified attention.

Every created item should belong to a workspace.

Today and Notifications should be able to show all workspace context.

Capture should default to the user’s default capture workspace, with the option to change it.

---

## Code Quality

Keep code simple and modular.

Use clear folders:

* `app/` for Expo Router routes
* `src/components/` for reusable UI
* `src/features/` for feature-specific components
* `src/api/` for API functions
* `src/store/` for state
* `src/theme/` for design tokens
* `src/types/` for shared types

Avoid giant components.

Avoid duplicate styling.

Create reusable primitives before repeating UI patterns.

---

## Do Not Build Yet

Do not build these unless explicitly requested:

* Siri / Shortcuts
* Share Sheet
* widgets
* push notifications
* full notes editor
* mind maps
* full projects module
* full calendar module
* integration settings
* Slack setup
* browser extension token management
* desktop sidebar controls
* workspace admin

---

## First Principle

When unsure, choose the simplest version that supports the real mobile use case:

> I remembered something while away from my computer, and I need it to land in the right Ledger workspace.
