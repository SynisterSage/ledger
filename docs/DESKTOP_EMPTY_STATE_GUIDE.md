# Desktop empty-state guide

Status: Phase 0–1 foundation

This guide defines how Ledger should handle a desktop surface that has no content yet. It is the contract for the reusable empty-state component and the later module-by-module rollout.

## Product job

An empty state should keep the user moving through Ledger’s loop:

**Capture → Plan → Execute → Review**

It should answer three things quickly:

1. What is empty or unavailable?
2. Why does that matter here?
3. What is the most useful next action?

An empty state is not a placeholder and should not make a new user infer the product’s next step.

## State taxonomy

Use one semantic state per surface. Do not use the same copy or CTA for all of these.

| State | Meaning | Primary behavior |
| --- | --- | --- |
| `first-use` | The user has never created this kind of content | Teach the purpose briefly and offer the first creation action |
| `no-results` | Content exists, but the current search/filter/date scope excludes it | Explain the scope and offer `Clear filters` or a scope change |
| `completed` | The user finished the relevant work | Confirm progress and offer the next review/planning action |
| `permission` | The user cannot see or create content because of access | Explain access and offer the permitted recovery path |
| `error` | The content could not be loaded | Explain that this is a loading problem and offer retry |
| `offline` | The app cannot currently reach the source of truth | Preserve the user’s context and offer retry/reconnect |
| `loading` | The result is not known yet | Keep the final layout stable; do not present an empty state or a permanent skeleton |

`no-results` must never look like `first-use`. A new user needs orientation; a returning user with a filter needs a way back to their data.

## Content contract

Every reusable empty state should support:

- `state`: one value from the taxonomy above
- `title`: short, sentence case, specific to the surface
- `description`: what will appear here or why the state exists; normally one or two sentences
- `primaryAction`: the single most useful next action when one exists
- `secondaryAction`: optional recovery or alternate path; never compete with the primary action
- `icon`: existing Ledger icon, decorative and hidden from assistive technology
- `size`: `compact` for a local panel or section, `default` for a main surface
- `testId`: stable identifier for state-level verification

The component should not manufacture actions from the title. The caller owns the action and its workspace-aware behavior.

## CTA rules

- Prefer one clear primary action.
- Use a verb that describes the result: `Create a note`, `Add a project`, `Plan today`, `Clear filters`, `Try again`.
- Keep actions contextual. A calendar day should not send the user to an unrelated module without explaining why.
- Do not place a primary button in every tiny subsection. The parent surface should own the main creation path when several local sections are empty.
- Keep alternate actions subordinate, such as a text link or quiet button.
- Preserve permissions and workspace rules. A CTA must not imply that a read-only user can create shared content.
- Avoid tours, large illustrations, and multi-option decision panels as the default empty state.

## Ledger voice and visual rules

- Calm, direct, and useful; no celebratory SaaS language.
- Sentence case labels and titles.
- Say what will appear here, not only that “nothing” exists.
- Use existing Ledger spacing, borders, typography, and icon primitives.
- Use a compact inline treatment for local panes and a more spacious treatment only for a primary workspace.
- Keep the underlying layout stable between loading, empty, and populated states to reduce visual shift.
- Do not repeat the same message in a parent and every child section. Consolidate when the parent CTA is sufficient.

## Initial desktop rollout matrix

This is the first-pass order for implementation. It is intentionally scoped to high-value first-use and daily-accountability surfaces before secondary inspectors and integrations.

| Priority | Surface | Current issue | Target first-use action |
| --- | --- | --- | --- |
| P0 | Post-onboarding New Tab | Ask Ledger is useful for returning users but does not orient a new workspace toward a first action | `Plan today` or `Create a note`, chosen from the user’s actual empty workspace context |
| P0 | Dashboard overview | Empty cards explain the absence but usually have no direct action | `Plan today`, `Create a task`, or the relevant module action |
| P0 | Notes home | “No notes yet” is passive even though a New note action exists above the content | `Create a note`, with optional template entry kept secondary |
| P1 | Projects home/detail | Some sections have plus actions, but local messages and affordances are inconsistent | `Add a project` at the home level; `Add next action`/`Add note` locally |
| P1 | Calendar day/agenda | Several local empty messages can stack without a clear next step | Parent-level `Create event`/`Add reminder`; local sections stay quiet when the parent action covers them |
| P1 | Search/filter results | Must clearly distinguish zero results from a new workspace | `Clear filters` first, then scope/search recovery |
| P2 | Inspectors and related context | Many small “nothing linked” messages can create noise | Compact contextual guidance; no repeated global create buttons |
| P2 | Integrations, permissions, and recovery | Requires distinct permission/error/offline language | `Connect`, `Request access`, `Retry`, or `Reconnect` based on the actual cause |

## Acceptance criteria for the reusable component

Before rolling it through the desktop app, verify:

- first-use, no-results, completed, permission, error, and offline states are visually distinguishable
- the action can open an existing module or invoke an existing workspace-aware create flow
- compact and default layouts do not clip at the supported pop-out sizes
- keyboard focus reaches the primary action first and `Escape` behavior remains unchanged
- icon is decorative; title and description provide the accessible announcement
- no loading state briefly flashes as an empty state during hydration
- parent and child surfaces do not produce duplicate primary CTAs
- the rendered branch is covered with a stable `testId`
- the state survives workspace switching and refresh without local-only persistence

## Next implementation phase

Phase 2 should add the shared semantic component and its tests only. The first integration targets should be the post-onboarding New Tab and Dashboard overview. Notes, Projects, and Calendar should be migrated after those two establish the visual and action hierarchy.
