# Ledger macOS widget

## First release

Ledger's first macOS widget is a small, system-native `Today` widget. It is a
quiet glance surface for the user's current day, not a miniature dashboard.

The widget should answer two questions without opening Ledger:

1. What is the one thing I am focused on?
2. What needs my attention next?

The first release supports the macOS small and medium widget families. A large
widget, quick capture controls, and interactive task completion are deferred
until the read-only version has proven useful.

## Visual direction

- Use SwiftUI system typography and natural macOS widget materials.
- Let the system provide the outer shape, padding, contrast, and light/dark
  treatment wherever possible.
- Use Ledger orange only for the focus marker, focus label, and empty-state
  action cue.
- Use dark navy/black primary text, muted gray secondary text, and no large
  colored cards.
- Keep the layout left aligned with generous breathing room.
- Use sentence case: `Today`, `Focus`, `Next`, `No focus set`.
- Avoid progress rings, gradients, heavy borders, badges, and dashboard stats.

### Small

```text
Today                         •

Focus
Finish the most important
thing

3 open · 2 next
```

The small family shows the focus item first. When no focus exists, it shows a
short invitation to choose one thing in Ledger.

### Medium

```text
Today                         3 open · 2 next
────────────────────────────────────────────
Focus   Finish the most important thing
Next    Review the project brief
        Today, 2:00 PM
```

The medium family adds the next actionable item and its lightweight time
metadata. It should not become a list of every task or event.

## Data contract

The macOS widget consumes a small read-only snapshot:

```ts
type LedgerMacWidgetSnapshot = {
  workspaceId: string | null;
  workspaceName: string | null;
  focusTitle: string | null;
  nextTitle: string | null;
  nextMeta: string | null;
  todayCount: number;
  upcomingCount: number;
  hasData: boolean;
  updatedAt: string;
};
```

The snapshot must be workspace-scoped. When there is no active workspace, the
widget should show an empty state rather than retain the previous workspace's
content.

The widget is read-only in v1. The widget opens:

```text
ledger:///today?source=mac-widget
```

The existing Electron deep-link handling should route this to Today and bring
the app forward.

## Native implementation boundary

The desktop build needs a real macOS WidgetKit extension. Electron cannot host
the widget view itself.

The implementation should have four parts:

1. `native/LedgerWidget/` — SwiftUI and WidgetKit extension source.
2. A macOS App Group shared container for the snapshot JSON.
3. A renderer/Electron bridge that publishes a fresh snapshot after Today,
   focus, task, workspace, and calendar state changes.
4. Electron Builder packaging/signing that embeds and signs
   `LedgerWidget.appex` inside `Ledger.app/Contents/PlugIns`.

The macOS app and widget extension must use the same App Group entitlement and
the widget bundle identifier must be separate from `com.ledger.app`. The widget
extension also needs `com.apple.security.app-sandbox`; macOS PlugInKit rejects
an extension without it even when the app and extension are otherwise signed.

## Testing the packaged widget

`npm run build` creates an installer; it does not replace the app already in
`/Applications`. Install the newly built DMG, replace the old Ledger app, and
launch Ledger once before looking in the widget gallery. Search for `Ledger`
and add `Ledger Today`. Apple requires the containing app to be launched at
least once after installation before its widget appears in the gallery.

If it still does not appear, check the *installed* extension rather than the
copy in `release/`:

```sh
codesign -d --entitlements - /Applications/Ledger.app/Contents/PlugIns/LedgerWidget.appex
pluginkit -m -v -i com.ledger.desktop.widget
```

The entitlement output should contain both `com.apple.security.app-sandbox`
and `group.com.ledger.desktop.shared`.

## Refresh behavior

- Publish immediately after a successful mutation that affects Today.
- Publish after active workspace changes.
- Request a WidgetKit timeline reload after publishing.
- Use a conservative timeline refresh as a fallback; the widget should still
  be useful if the app has not been opened recently.
- Never write data from the widget and never treat widget hydration as a user
  edit.

## Acceptance criteria

- The widget appears in macOS's widget gallery with a native-looking preview.
- Light and dark appearances remain legible without custom theme chrome.
- Small and medium sizes do not clip long focus titles.
- Empty, no-workspace, and stale-data states are explicit and safe.
- Clicking the widget opens the correct Ledger Today route.
- Switching workspaces does not leave old workspace content in the widget.
- The packaged Mac app contains a valid, signed widget extension.
- Windows and Linux builds are unchanged.

## Deferred

- Quick capture from the widget.
- Interactive task completion.
- Multiple widget configurations or per-widget workspace selection.
- Large widget family.
- A separate next-reminder widget.
