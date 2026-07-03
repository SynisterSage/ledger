# Windows Floating Sidebar Docking Regression

This note documents the Windows-only floating sidebar docking regression fixed in
`electron/main.ts`.

## Later Tracker Fix

A second Windows issue showed up after the initial dock started working:

- the sidebar would attach, then detach a moment later when the target app moved
  or the native tracker restarted
- the tracker sometimes crashed because the generated PowerShell/C# helper was
  declared as a static class while it still used instance state
- when the native tracker failed, the fallback edge polling could reflow the
  sidebar toward the screen edge instead of staying attached to the app

The follow-up fix was to keep the Windows dock tracker as an instance class,
bind the callback during `Start()`, and guard `refreshFloatingDockTarget()` so
only one Windows probe runs at a time. The Windows PowerShell probe timeouts
were also increased so the tracker does not get killed mid-scan.

That combination is the version that kept the sidebar attached correctly on
Windows in the follow-up test pass.

## Symptoms

- Main display: floating sidebar did not dock to either side of an app.
- Secondary displays: floating sidebar docked and followed the app on the app's
  left side, but not on the app's right side.
- macOS docking was not part of the regression.

## What Fixed It

The working fix had two important parts.

### 1. Use the full Windows edge scan first

For Windows manual docking, `dockFloatingSidebarToTarget()` should ask
`getFloatingDockTargetAtCursor()` first. That path enumerates visible Windows
windows and scores the nearest dockable app edge.

The narrower point-probe fallback,
`getFloatingDockTargetAtEdge(sidebarBounds, 'left' | 'right')`, should run only
after the full scan fails.

This matters because point probes can miss valid targets on mixed-monitor
setups, especially when display scale or native screen coordinates differ from
Electron DIP coordinates.

### 2. Compare adjacent edges only

The side-distance logic must compare the actual adjacent edges:

```ts
// Ledger is left of the target app.
leftDistance = Math.abs(sidebarRight - targetLeft);

// Ledger is right of the target app.
rightDistance = Math.abs(sidebarLeft - targetRight);
```

Do not use a loose `Math.min(...)` comparison against both left or both right
edges. That can choose the wrong side and was the cause of the right-side
docking failure.

The same adjacent-edge logic must exist in both places:

- TypeScript `getDockIntentDistance(...)`
- embedded Windows PowerShell scan inside `getFloatingDockTargetAtCursor()`

## Regression Checklist

When changing Windows docking logic, test all four cases before shipping:

- main display, Ledger docked to the left side of an app
- main display, Ledger docked to the right side of an app
- secondary display, Ledger docked to the left side of an app
- secondary display, Ledger docked to the right side of an app

Fully restart the Electron app before testing. This logic runs in the Electron
main process, so renderer refreshes are not enough.

## Relevant Code

- `electron/main.ts`
- `getFloatingDockTargetAtCursor()`
- `getFloatingDockTargetAtEdge(...)`
- `dockFloatingSidebarToTarget()`
- `getDockIntentDistance(...)`
- `getDockedBoundsForTarget(...)`
