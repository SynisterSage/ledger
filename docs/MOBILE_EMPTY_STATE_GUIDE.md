# Mobile empty-state guide

Status: Phase 7 static production check complete; device runtime verification remains  
Scope: fresh accounts after onboarding, plus route-level empty, filtered, unavailable, and recoverable states.

This is the mobile companion to the desktop empty-state work. It is intentionally not a direct port of the desktop component. Mobile is a capture and attention layer, so empty states should be short, contextual, and actionable without turning the app into a tutorial carousel.

## Product contract

After notification onboarding, a new account lands on `Today`. The first-use experience should answer three things quickly:

1. What is this screen for?
2. What is the smallest useful next action?
3. Where will that action take me?

The empty state owns the explanation and the primary next action. A toolbar icon or tab-level action may remain as a secondary shortcut, but it should not be the only discoverable path for a fresh account.

Use one primary action per state. Use a secondary action only when it represents a genuinely different path, such as `View calendar` versus `Add something`.

## State taxonomy

Every reviewed branch should be classified before it is styled:

| State | Meaning | Expected behavior |
| --- | --- | --- |
| `first-use` | The user has no content yet and the surface needs orientation. | Brief explanation plus one clear creation or setup CTA. |
| `no-results` | Content exists, but the current search/filter/date has no matches. | Explain the constraint plus clear/reset or change-context CTA. |
| `informational` | An empty result is healthy and needs no action. | Reassure; do not invent work. |
| `permission` | The user can view or cannot act because of workspace permissions. | State the limitation plainly; never show a dead creation CTA. |
| `unavailable` | The requested record or route cannot be loaded or no longer exists. | Explain what happened plus return/retry action. |
| `error` | The data request failed. | Preserve context and offer retry. |

Loading is not an empty state. Skeletons or loading copy must remain separate from the empty-state contract so a new account does not see a blank surface while hydration is still in progress.

## Current route inventory

### Post-onboarding landing

| Surface | Current branch | Finding | Phase |
| --- | --- | --- | --- |
| `app/index.tsx` → `/(tabs)/today` | Completed notification onboarding redirects to Today. | Correct landing surface; Today is the highest-value first-use state. | 3 |
| `app/onboarding/notifications.tsx` | Enable notifications / Not now. | Already concise and appropriately bounded; do not turn it into a product tour. | 7 |

### Primary tabs

| Surface | Current branch | Finding | Phase |
| --- | --- | --- | --- |
| `app/(tabs)/today.tsx` | `Nothing due today`, `Nothing needs attention`, `No events coming up`. | Several local text-only empties. The screen has capture/focus actions, but the empty branches do not consistently connect to them. | 3 |
| `app/(tabs)/notes.tsx` | `No notes yet`, section empty, search empty, filter empty. | Root and section empties lack local CTAs; search/filter branches already have reset actions. | 4 |
| `app/(tabs)/projects.tsx` | First-use project CTA, filtered empty, milestone empty. | Strongest existing first-use implementation. Normalize wording and permission behavior rather than replace it wholesale. | 4 |
| `app/(tabs)/calendar.tsx` → `CalendarShell` | Calendar views delegate empty branches to child views. | Needs one consistent create path across week/day/month/agenda variants. | 5 |
| `app/notifications.tsx` | Filtered empty with `Clear filters`; base `You’re all caught up`. | Good distinction between actionable no-results and healthy informational empty. Use as the reference behavior. | 5 |

### Secondary routes and detail screens

| Surface | Current branch | Finding | Phase |
| --- | --- | --- | --- |
| `app/project/[id].tsx` | Project unavailable, section failures, hidden empty sections. | Unavailable/retry behavior exists; completely empty sections can disappear without telling the user what can be added. | 6 |
| `src/features/calendar/WeekView.tsx` | `No plans for [day]` + `+ Add something`. | Good local pattern; preserve the date context and route it through the shared contract. | 5 |
| `src/features/calendar/SelectedDayAgenda.tsx` | `No items scheduled` + `+ Create something`. | Good CTA, but it should share copy/action semantics with WeekView. | 5 |
| `src/features/notes/MobileTextNoteEditor.tsx` | Note unavailable, editor retry/read-only fallback. | These are recovery states, not first-use empties; keep them separate from list empty states. | 6 |

## Mobile component contract

The existing `src/components/EmptyState.tsx` is a useful visual base, but it currently accepts only an icon, title, description, and arbitrary footer. Before broad integration, the contract should become semantic and caller-owned:

```ts
type MobileEmptyStateKind =
  | 'first-use'
  | 'no-results'
  | 'informational'
  | 'permission'
  | 'unavailable'
  | 'error';

type MobileEmptyStateAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  variant?: 'primary' | 'secondary' | 'link';
};
```

The component should own layout, typography, spacing, accessibility, and action hierarchy. The caller should own navigation, sheet opening, retry, permissions, and data mutations. Do not put route names, API calls, or workspace logic in the component.

Required behavior:

- keep the first-use state compact enough to fit above the fold on common phones;
- use text before decoration and avoid large illustration payloads;
- expose the title and description as readable accessibility text;
- give primary actions an explicit button role and stable test identifier;
- support no-action informational states without rendering an empty button slot;
- allow inline/list contexts to use a smaller variant without creating a second component;
- never display a creation CTA when the caller reports read-only or unavailable permissions.

## Copy rules

Use sentence case and Ledger language. Explain the next useful action, not the feature inventory.

Prefer:

- `Nothing needs your attention yet.`
- `Capture a task, reminder, event, or note to give today a starting point.`
- `No notes yet.`
- `Start with a quick note, then organize it when you have more context.`
- `No plans for Tuesday.`
- `Add something to this day.`

Avoid:

- generic `No data` / `Nothing here` copy;
- instructional paragraphs that repeat onboarding;
- multiple competing CTAs in a small screen;
- decorative empty states that do not explain what happens next;
- labels that imply a backend failure for a healthy empty result.

## Implementation phases

### Phase 1 — foundation and contract (this pass)

- inventory route-level first-use, no-results, informational, permission, unavailable, error, and loading branches;
- define the mobile taxonomy and CTA rules;
- identify the real caller-owned actions and preserve existing route/sheet behavior;
- keep loading separate from empty state;
- record all findings in this guide.

Exit criteria: every in-scope route has an assigned state kind, an owner, and a planned action or an explicit reason to remain informational.

### Phase 2 — shared primitive

- evolve `src/components/EmptyState.tsx` into the semantic contract above;
- add a compact inline variant for Today sections and calendar day agenda;
- add stable accessibility labels and test IDs;
- retain compatibility for Notifications while migrating callers incrementally.

Exit criteria: the primitive can represent first-use, no-results, informational, permission, unavailable, and error without arbitrary footer markup.

Completed in `apps/mobile/src/components/EmptyState.tsx`:

- semantic `kind` support;
- caller-owned primary and secondary actions;
- regular and compact density modes;
- accessibility summary and stable kind-based test identifiers;
- action-level accessibility labels and test identifiers;
- existing Notifications usage remains informational and requires no route changes.

### Phase 3 — new-user Today

- make the post-onboarding Today state the reference first-use experience;
- connect empty attention sections to existing Capture, focus, and calendar actions;
- ensure a fully empty Today screen still gives one obvious next step;
- verify no skeleton remains indefinitely after an empty successful response.

Exit criteria: a fresh account can reach a useful first action from Today without discovering a hidden toolbar control.

Completed:

- the empty Focus section now uses the shared compact state with `Add focus`;
- the Today, attention, and next-up filtered surfaces use semantic empty states;
- Today empties route to existing Capture and Calendar tabs, while the healthy attention state remains informational;
- loading and request-error branches remain separate from successful empty responses.

### Phase 4 — Notes and Projects

- add local creation CTAs to root Notes and empty sections;
- preserve search/filter reset behavior as no-results states;
- normalize Projects copy and read-only branches;
- expose meaningful empty project sections instead of silently hiding them when the section is available to the user.

Exit criteria: every empty Notes/Projects branch either creates, resets, explains a permission boundary, or is intentionally informational.

Completed:

- Notes root, section, search, and filter empties now use the shared primitive;
- section creation preserves the current section or child-note context;
- Projects and Milestones use the same first-use, no-results, permission, and informational distinctions;
- existing filter reset, creation-sheet, and read-only behavior remains caller-owned.

### Phase 5 — Calendar and Notifications

- unify day/week/month/agenda empty copy and create action semantics;
- preserve the healthy `You’re all caught up` notification state;
- keep notification filter empties actionable with clear/reset;
- verify create actions retain the selected date and workspace.

Exit criteria: the same user intent produces the same action label and opens the correct mobile sheet from every calendar empty view.

Completed:

- selected-day agenda and week timeline use the shared calendar empty state;
- date context is preserved in the copy and accessibility label;
- create actions still call the existing date-aware calendar flow;
- notification filter empties now use the no-results contract;
- the healthy `You’re all caught up` state remains informational and action-free.

### Phase 6 — detail, permissions, and recovery

- review project detail, note editor, and linked-content failures;
- separate unavailable records from empty content;
- add retry/return actions where recovery is possible;
- ensure read-only users see a useful alternative instead of a disabled dead end.

Exit criteria: deep links and partial section failures never leave a blank screen with no next action.

Completed:

- Project detail now keeps Tasks, Milestones, Notes, Calendar, and Related context visible when their data is empty;
- empty detail sections distinguish creation permission from healthy informational context;
- project-unavailable deep links use retry/return actions;
- milestone creation permission failures explain the boundary and provide a return action;
- existing section-level retry behavior remains intact.

### Phase 7 — production verification

- test a fresh account immediately after onboarding;
- test an existing account with no records in each workspace;
- test search/filter/date no-results states;
- test read-only permissions and deleted/unavailable records;
- verify accessibility labels, touch targets, keyboard/sheet dismissal, and reduced motion;
- measure first meaningful content and empty-state appearance on slow and warm launches;
- verify iOS and Android runtime behavior, not only TypeScript/static output.

Completed in this pass:

- mobile TypeScript check passed;
- mobile note-routing, editor-bridge, and note-save lifecycle checks passed;
- desktop web build passed;
- desktop empty-state contract tests passed;
- desktop tab/view soak checks passed;
- mobile and desktop shared empty-state CTAs now use centered intrinsic-width action layout instead of left-aligned/stretching behavior.

Still requires live product verification:

- fresh-account onboarding on iOS and Android;
- slow-network and warm-cache launches;
- touch/accessibility inspection of each empty-state CTA;
- packaged desktop runtime inspection at narrow and wide window sizes.

## Acceptance checklist

- [ ] Today is the first-use reference state after onboarding.
- [ ] No first-use surface depends only on a toolbar icon or tab switch to explain itself.
- [ ] Every empty branch has a semantic kind.
- [ ] Every actionable branch has one obvious CTA with a caller-owned action.
- [ ] Healthy informational states do not invent work.
- [ ] Search/filter/date empties offer reset or context change.
- [ ] Permission states do not show unavailable creation actions.
- [ ] Loading, empty, error, and unavailable states are visually and behaviorally distinct.
- [ ] No new empty-state component contains API, routing, or workspace mutation logic.
- [ ] Fresh-account and slow-network checks are verified on device/simulator for both platforms.
