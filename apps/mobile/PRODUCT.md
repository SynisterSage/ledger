# MOBILE_PRODUCT_GUIDE.md

## Ledger Mobile Product Guide

Ledger Mobile is a companion app for Ledger desktop.

It should help users capture and respond while away from their computer.

It should not replace the desktop app.

---

## Core Product Statement

Ledger Mobile lets users capture reminders, tasks, events, notes, and project actions into their Ledger workspaces from their phone, then see what needs attention today.

---

## Product Spine

Ledger as a whole is built around:

> Separate workspaces. Unified attention.

Mobile should support that by making it easy to:

1. Capture something quickly.
2. Assign it to a workspace.
3. See what needs attention today.
4. Act on reminders and notifications.

---

## Primary Mobile Surfaces

### 1. Today

Today is the home screen.

It should answer:

> What needs my attention today?

Today should show items across workspaces with simple workspace labels.

Possible content:

* Today’s focus
* due reminders
* upcoming events
* tasks due today
* overdue items
* project actions
* captures waiting, as a small summary only

Today should be simple and scannable.

It should not look like the desktop Dashboard.

---

### 2. Capture

Capture is the main creation surface.

It should answer:

> What do I need to save into Ledger right now?

Capture types:

* Reminder
* Task
* Event
* Note
* Project action

Each capture form should be short and mobile-native.

Do not copy desktop modals directly.

---

### 3. Notifications

Notifications should answer:

> What is actively calling for my attention?

Possible notification types:

* reminder due
* event starting soon
* task overdue
* project deadline
* capture waiting
* daily check-in later

Actions:

* Open
* Complete
* Snooze
* Dismiss

Notifications are not the same as Inbox.

---

## Inbox Role on Mobile

Inbox is not a primary mobile tab for v1.

Inbox is still useful as a data destination for unclear captures, share sheet items, and integrations.

Mobile may show:

* captures waiting
* review captures
* save to Inbox from share sheet

But the main mobile app should be:

* Today
* Capture
* Notifications

---

## Capture Flow Details

### Reminder

Fields:

* title
* date
* time
* workspace
* project optional

Example:

Title: Submit Alfa hours
When: Tomorrow at 2:00 PM
Workspace: Alfa Summer 26

---

### Task

Fields:

* title
* workspace
* project optional
* due date optional
* add to Today optional

Example:

Title: Export homepage video
Workspace: Ledger
Project: Homepage Feature Showcase

---

### Event

Fields:

* title
* date
* start time
* end time
* workspace/calendar
* notes optional

Example:

Title: Remote internship
Date: Thursday
Time: 11:00 AM - 6:00 PM
Workspace: Alfa Summer 26

---

### Note

Fields:

* title
* plain text body
* workspace
* project optional

Do not build full rich text editing in v1.

---

### Project Action

Project action is not a full project module.

It should let users add an action to an existing project.

Fields:

* action title
* project
* workspace inferred from project
* due date optional

Example:

Action: Send client mockup
Project: Pigmented Perceptions
Due: Tomorrow

---

## Workspace Behavior

Today should default to all workspaces.

Capture should default to the user’s default capture workspace.

Users should be able to change workspace during capture.

Each Today/Notification row should show workspace context.

Example:

Alfa Summer 26
Submit hours · 2:00 PM

Ledger
Test browser extension capture

Personal
Pick up prescription

---

## Auth Flow

Mobile requires sign-in because the app syncs with Ledger workspaces.

Recommended first-run flow:

1. Welcome
2. Sign in / Create account
3. Choose default capture workspace
4. Enable notifications
5. Today

No anonymous mode in v1.

No fake demo mode in v1.

---

## Future Mobile-Native Features

These are important later, but not part of the first scaffold.

### Siri / Shortcuts

Examples:

* Add Ledger Reminder
* Add Ledger Task
* Capture to Ledger
* Create Ledger Event

Ideal command:

“Hey Siri, add a Ledger reminder to submit my hours tomorrow at 2.”

---

### Share Sheet

User can share from another app into Ledger.

Examples:

* link
* selected text
* photo
* screenshot
* note

Default destination can be Inbox, with workspace selection.

---

### Widgets

Future widgets:

* Today widget
* next reminder widget
* quick capture widget

---

## Out of Scope for v1

Do not build:

* full notes editor
* mind maps
* full projects dashboard
* full calendar month/week views
* integration management
* workspace admin
* desktop sidebar settings
* browser extension settings
* Slack settings
* complex notification rules

---

## Success Criteria

Ledger Mobile succeeds if a user can quickly:

1. Open the app and see what matters today.
2. Add a reminder in under 10 seconds.
3. Add a task or project action while away from desktop.
4. Create a simple event.
5. Respond to notifications.
6. Send data back to the same Ledger workspaces used on desktop.
