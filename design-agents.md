````md
# Ledger — DESIGN-AGENTS.md

> Design system, UI philosophy, and implementation rules for Ledger.

This document exists to keep Ledger visually coherent as the product grows.

Ledger is not a generic SaaS dashboard.
It is a calm, desktop-first productivity workspace focused on clarity, context, and intentionality.

All UI/UX decisions should reinforce that philosophy.

---

# Core Design Philosophy

Ledger should feel:

- calm
- intentional
- lightweight
- contextual
- desktop-native
- focused
- structured without feeling rigid

Ledger should NOT feel like:
- an admin dashboard
- enterprise SaaS
- “vibe-coded” UI
- a template marketplace
- a Notion clone
- a generic Tailwind component library

The UI should reduce cognitive load, not create it.

---

# Product Philosophy

## Workspaces organize data.
## Today organizes attention.

This distinction is critical throughout the product.

Examples:
- tasks belong to workspaces
- Today aggregates across workspaces
- Dashboard Focus is curated
- Sidebar Today is operational

---

# Visual Direction

Inspirations:
- Linear
- Raycast
- Things
- Arc
- Apple Reminders
- Apple Notes
- macOS utility apps

Avoid:
- excessive gradients
- giant cards
- oversized padding
- loud UI
- over-animation
- empty “dashboard” spacing
- excessive shadows
- thick borders everywhere

---

# UI Tone

Ledger should feel:

```txt
quiet
ambient
persistent
intentional
````

NOT:

```txt
gamified
playful
corporate
enterprise
over-decorated
```

---

# Layout Rules

## Density

Prefer:

* compact layouts
* strong hierarchy
* subtle spacing rhythm

Avoid:

* giant empty cards
* huge vertical gaps
* excessive whitespace without purpose

Ledger is desktop-first.
Use space intentionally.

---

## Containers

Avoid nested cards inside cards inside cards.

Prefer:

* flatter layouts
* soft separators
* lightweight grouping
* subtle borders

If something feels like a “mini app inside a card,” simplify it.

---

## Borders & Shadows

Use:

* subtle borders
* soft shadows
* low contrast separators

Avoid:

* heavy drop shadows
* thick outlines
* aggressive elevation differences

All panels should feel part of the same environment.

---

# Typography

Use typography hierarchy carefully.

## Titles

* dark navy
* strong but calm
* avoid giant text

## Metadata

* muted gray
* smaller
* secondary

## Labels

* avoid excessive uppercase
* avoid visual shouting

---

# Color Philosophy

Ledger uses restrained color intentionally.

Primary palette:

* warm whites
* charcoal/navy text
* muted grays
* subtle accent colors

Accent usage:

* Ledger orange = sparingly
* success green = subtle
* warning amber = subtle
* destructive red = rare

Never let the interface become rainbow-coded.

---

# Sidebar Philosophy

The Expanded Sidebar is:

* persistent
* operational
* lightweight
* always accessible

It should feel like:

* a calm utility layer
* not a giant dashboard

---

## Sidebar Today

Sidebar Today is:

* operational queue
* quick capture
* active tasks
* overdue reminders
* lightweight follow-ups

NOT:

* dashboard focus system
* giant planning module

---

# Dashboard Philosophy

Dashboard is:

* curated
* reflective
* intentional

Dashboard should NOT duplicate sidebar functionality.

Examples:

* Focus = curated priorities
* not another task list

---

# Notes Philosophy

Notes are the emotional core of Ledger.

Notes should support:

* fast capture
* contextual thinking
* project linking
* long-form thought
* visual organization

Avoid:

* overwhelming editor chrome
* excessive formatting UI
* cluttered inspector panels

---

# Calendar Philosophy

Calendar should feel:

* contextual
* integrated
* calm

It is NOT:

* a complex enterprise scheduling suite

Events:

* historical context objects

Reminders:

* unresolved obligations

Do not treat them identically.

---

# Projects Philosophy

Projects should feel:

* structured
* intentional
* lightweight

Avoid:

* Jira complexity
* enterprise PM tooling
* over-management

Projects should support:

* momentum
* accountability
* planning
* connected context

---

# Modals

Ledger modals should:

* feel compact
* avoid giant empty space
* use strong hierarchy
* prioritize readability

Avoid:

* giant stacked cards
* CRUD-heavy layouts
* repeated action buttons everywhere

Preferred modal patterns:

* compact lists
* detail preview panes
* subtle dividers
* one primary action

---

# Version History Rules

Version history should:

* feel safe
* feel recoverable
* not feel technical

Use:

* human-readable labels
* compact timelines
* single restore action
* preview pane

Avoid:

* “Version 24”
* raw technical metadata
* giant repetitive cards

---

# Template System Rules

Template galleries should:

* feel lightweight
* emphasize usability
* distinguish preset vs custom subtly

Avoid:

* giant template cards
* excessive badges
* giant edit panels
* noisy metadata

---

# Collaboration Philosophy

Ledger collaboration is:

* small team oriented
* intentional
* context-aware

NOT:

* enterprise org management
* massive multiplayer editing

Realtime should remain lightweight.

Version safety comes before aggressive collaboration.

---

# Workspace Rules

Workspace context belongs:

* at object level
* not everywhere globally

Example:
Today should NOT say:
“Today · Alfa Workspace”

Instead:
Tasks themselves show workspace context subtly.

---

# Interaction Rules

Animations should:

* support clarity
* feel soft
* feel responsive

Avoid:

* flashy motion
* over-animated transitions
* excessive spring physics

Preferred:

* subtle opacity
* soft scaling
* restrained hover states

---

# Empty States

Empty states should:

* feel calm
* guide lightly
* avoid marketing tone

Good:
“No focus set yet.”

Bad:
“Let’s supercharge your productivity!”

---

# Technical UI Rules

## State Safety

Never allow:

* silent destructive actions
* accidental note deletion
* context loss
* unsaved content disappearance

Version history exists for safety.

---

## Autosave

Autosave should feel:

* invisible
* trustworthy
* calm

Never noisy.

---

## Toasts

Toasts should:

* be subtle
* top-center preferred
* concise
* lightweight

Avoid giant notification systems.

---

# Workspace Collaboration

For MVP:

* invite links
* shared projects
* shared notes
* lightweight realtime

Avoid:

* granular ACL complexity
* enterprise permission systems

---

# Storage Rules

Images/files should:

* use durable storage paths
* avoid base64 persistence
* remain workspace-scoped

Preferred structure:

```txt
workspaces/{workspaceId}/notes/{noteId}/images/{file}
```

---

# Design Smells (Avoid These)

If UI feels:

* “vibe-coded”
* overly card-heavy
* duplicated
* too many borders
* giant empty spacing
* dashboard-y
* generic SaaS
* enterprise
* noisy

Then simplify.

---

# Final Principle

Ledger should feel like:

> a calm workspace that quietly supports deep thinking and intentional work.

Not:

* a productivity circus
* a gamified SaaS dashboard
* an enterprise control panel

```
```
