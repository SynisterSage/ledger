# MOBILE_DESIGN_GUIDE.md

## Ledger Mobile Design Guide

Ledger Mobile should visually belong to the same product system as Ledger desktop.

Do not invent a separate mobile design language.

Use the main Ledger design tokens wherever possible.

The mobile app should feel native to iOS and Android while still clearly feeling like Ledger.

Think:

* Apple
* Notion
* Linear
* clean editorial UI
* native mobile utility
* quiet productivity

Do not make it feel like a generic SaaS mobile app.

---

## Token Rule

Do not hardcode colors, spacing, typography, radii, or shadows directly in screens.

Use Ledger’s shared design tokens.

If the mobile app has its own `src/theme/` folder, it should map to the main Ledger tokens, not invent unrelated values.

Preferred approach:

* import shared tokens if available
* mirror desktop token names if direct sharing is not set up yet
* keep token names consistent with Ledger desktop
* document any temporary mobile-only tokens clearly

Examples of token categories:

* color tokens
* text tokens
* spacing tokens
* radius tokens
* border tokens
* icon size tokens
* motion tokens
* z-index/elevation tokens if needed

Do not use one-off values like random hex codes, arbitrary spacing numbers, or custom shadows inside components.

---

## Design Source of Truth

The main Ledger desktop app is the source of truth for visual direction.

Mobile should adapt the system to a phone, not redesign it.

Follow the desktop direction:

* minimal
* calm
* text-first
* editorial
* warm
* restrained
* easy to scan
* workspace-aware
* attention-focused

Avoid making mobile more playful, colorful, or decorative than desktop.

---

## Product Feel

Ledger Mobile should feel like:

> A simple capture and attention layer for Ledger workspaces.

It should not feel like:

> Desktop Ledger squeezed onto a phone.

This means mobile UI should be simpler, more focused, and more native.

---

## Design Principles

### 1. Text First

Information should be easy to read.

Use clear titles, simple metadata, and calm spacing.

Avoid hiding important context behind decorative UI.

---

### 2. Minimal Surfaces

The screen itself is the surface.

Avoid card-inside-card layouts.

Use spacing, dividers, and hierarchy before adding containers.

---

### 3. Calm Hierarchy

Use typography, spacing, and placement to create hierarchy.

Do not rely on shadows, gradients, or loud colors.

---

### 4. Mobile Native

Do not copy desktop layouts.

No three-pane designs.

No desktop-style modals.

No oversized dashboard widgets.

Use simple lists, sheets, rows, and focused forms.

---

### 5. Accent Color Discipline

Use Ledger’s accent token only for meaningful emphasis.

Use accent color for:

* primary actions
* active tab/selected state
* selected capture type
* important status/action emphasis

Do not use accent color everywhere.

If everything is orange, nothing is important.

---

## Token Usage Requirements

### Colors

Use Ledger color tokens.

Do not hardcode hex values in screen components.

Color usage should come from semantic tokens such as:

* background
* surface
* surfaceMuted
* textPrimary
* textSecondary
* textMuted
* borderSubtle
* borderStrong
* accent
* danger
* success
* warning

If a needed token does not exist, add it to the theme layer first rather than hardcoding it in a component.

---

### Spacing

Use Ledger spacing tokens.

Do not use random margins/padding throughout screens.

Spacing should feel consistent across:

* screen padding
* section gaps
* row spacing
* form spacing
* button spacing
* list item spacing

If a layout needs a special value, name it as a token or explain why it is temporary.

---

### Typography

Use Ledger typography tokens.

Do not hardcode font sizes and weights directly in every component.

Typography should be defined through roles such as:

* screenTitle
* title
* sectionTitle
* body
* bodyStrong
* meta
* caption
* button

Keep typography readable and native-feeling.

No tracked uppercase labels.

Use normal labels:

* Today
* Capture
* Workspace
* Notifications
* Reminder
* Event
* Project

Avoid:

* T O D A Y
* C A P T U R E
* N O T I F I C A T I O N S

---

### Radius

Use Ledger radius tokens.

Do not make mobile overly bubbly.

Rounded corners should feel calm and intentional.

Use radius for:

* buttons
* inputs
* small surfaces
* sheets

Avoid huge rounded cards unless specifically designed.

---

### Borders and Dividers

Use border tokens.

Prefer thin dividers and subtle borders over heavy cards.

Mobile Ledger should use rows and dividers more often than boxed cards.

---

### Shadows / Elevation

Avoid drop shadows by default.

Do not add heavy shadows unless explicitly requested by design.

If elevation is needed, use Ledger elevation tokens.

Most mobile screens should work with:

* spacing
* dividers
* soft surfaces
* typography

not shadows.

---

### Motion

Use Ledger motion tokens.

Motion should be subtle and native.

Allowed:

* short fade
* slight slide
* native sheet transition
* button press feedback

Avoid:

* bouncy animations
* long transitions
* flashy onboarding
* gradient motion
* dramatic splash effects

If the user enables Reduce Motion, motion should be minimized.

---

## Components

Build reusable primitives and use them consistently.

Recommended primitives:

* Screen
* AppButton
* AppTextInput
* Section
* Row
* WorkspaceLabel
* EmptyState
* ActionSheet
* SegmentedControl
* Badge/StatusDot only if needed

Do not style each screen from scratch.

If a pattern appears twice, consider making or improving a shared component.

---

## Buttons

Primary buttons should use the Ledger primary action token.

Secondary buttons should be quiet.

Ghost/text actions should be used for low-priority actions.

Use tokenized:

* height
* radius
* padding
* text style
* background
* border
* disabled state

Avoid huge bubbly buttons.

Avoid one-off button styles per screen.

---

## Forms

Forms should be short and mobile-native.

Use simple labels and clean fields.

Fields should use tokenized:

* background
* border
* radius
* padding
* text style
* placeholder color
* focus state

Each capture form should be easy to complete quickly.

Do not recreate desktop forms exactly.

---

## Lists

Today and Notifications should be list-first.

Rows should include:

* title
* workspace label
* time/status metadata
* optional small action row

Use dividers between rows.

Avoid large individual cards unless the item truly needs emphasis.

---

## Today Screen Direction

Today should feel like a clean agenda.

It should show all-workspace context simply.

Example structure:

Today
All Workspaces

Alfa Summer 26
Remote internship · 11:00 AM
Submit hours · 2:00 PM

Ledger
Test browser extension capture
Review notification center logic

Personal
Pick up prescription

Use workspace labels as context, not giant workspace cards.

---

## Capture Screen Direction

Capture should be simple.

Top:

Capture
Add something to Ledger.

Capture types:

* Reminder
* Task
* Event
* Note
* Project action

Use clean rows or compact controls.

Do not use a bulky grid if it feels heavy.

Each type opens a focused form.

---

## Notifications Screen Direction

Notifications should feel like an attention list.

Example:

Notifications
3 active

Now
Reminder due
Submit Alfa hours
Alfa Summer 26

Actions:
Complete · Snooze · Open

Use calm rows and simple actions.

No giant alert cards.

No aggressive red unless destructive.

---

## Welcome/Auth Direction

Welcome should be a soft hard gate.

It should not show a raw login form immediately.

Welcome copy direction:

Ledger

Your workspaces, wherever you remember things.

Capture reminders, tasks, events, and notes from your phone, then see them back in Ledger on desktop.

Actions:

* Sign in
* Create account

Keep this screen minimal and warm.

Use Ledger tokens for all styling.

---

## Empty States

Keep empty states short.

Good:

You’re caught up.
Ledger will show reminders, events, and actions here when they need attention.

Bad:

Large illustration, long paragraph, marketing copy, multiple buttons.

---

## Do Not Use

Avoid:

* hardcoded hex colors in screens
* hardcoded spacing values in screens
* hardcoded typography values in screens
* gradients
* heavy drop shadows
* glassmorphism
* neon color
* oversized icons
* nested cards
* tracked uppercase labels
* fake charts
* decorative dashboards
* loud badges
* complex illustrations
* overly rounded bubbly UI

---

## Design Workflow

The designer will provide creative direction, moodboards, and screens.

Implementation should follow designs section by section.

Do not invent the full visual system in one pass.

Do not redesign screens that have not been provided yet.

Do not one-shot the whole app.

Build carefully, one surface at a time.

---

## Implementation Rule

When implementing any screen, first check:

1. Is there an existing Ledger token for this value?
2. Is there an existing mobile shared component for this pattern?
3. Does this match the desktop Ledger design direction?
4. Is this simpler than the desktop equivalent?
5. Is this readable and useful without decoration?

If the answer is no, stop and simplify before continuing.
