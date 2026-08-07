# Ledger Web Desktop Renderer Audit

Status: Phase 2 architecture audit

This document audits the existing Electron renderer for browser reuse. The
target is near-identical visual and interaction parity with the desktop app at
normal desktop browser widths. It does not propose a redesign, a second
product UI, or a runtime migration in this phase.

The route source of truth is
[`docs/web/route-contract.md`](./route-contract.md).

## 1. Renderer architecture

### Current startup and provider tree

The renderer starts at `src/main.tsx` and mounts one shared React tree:

```text
ReactDOM
└── AuthProvider
    └── WorkspaceProvider
        └── PinsProvider
            └── SidebarProvider
                └── App
                    ├── SearchProvider
                    ├── ToastProvider
                    ├── NotificationCenterProvider
                    ├── NotificationMonitor
                    ├── Meeting/transcription indicators
                    ├── AppShell or module window
                    └── shared overlays
```

`AuthContext`, `WorkspaceContext`, `PinsContext`, `SearchContext`, and the API
hook are shared product state and should remain shared on web.

`src/App.tsx` currently decides whether the renderer is the main sidebar shell
or a module window. It parses the desktop `window=module`, `module`, and focus
parameters, renders the selected module, and keeps visited modules alive in
the desktop workspace window.

### Current desktop shell

The main desktop shell is composed from:

- `MainLayout`
- `SidebarProvider`
- `SidebarContainer`
- `ExpandedSidebar`
- `MinimizedSidebar`
- `CollapsedSidebar`
- `LedgerTabStrip`
- `ModuleWindowHeader`
- `WorkspaceSwitcherMenu`
- notification tray and global search overlays

Electron main-process code creates and manages separate BrowserWindows for
module pop-outs, sidebar placement, fullscreen, bounds, docking, and persistent
workspace routes. The renderer communicates with that shell through the
preload-exposed `window.desktopWindow` API and `window.ipcRenderer` events.

### Current navigation model

Desktop navigation has two layers:

1. Module/focus navigation: `openModule(kind, focus)` and focus events.
2. Persistent workspace route/tab state: `LedgerTabStrip`, route history, and
   Electron workspace-window state.

The focus payload currently includes:

```text
kind
focusDate
focusProjectId
focusNoteId
focusTaskId
focusInboxId
focusContext
focusSection
```

The browser must translate those intents to the canonical URLs in the Phase 1
contract. It should not expose `window=module` as its primary URL model.

### Module containers

The primary renderer modules are:

```text
NewTabWindow
DashboardContent in App.tsx
CircleWindow
CalendarWindow
NotesWindow
ProjectsWindow
TeamsWindow
TeamSettingsWindow
IntakeWindow / InboxWindow
SlackWindow
NotificationCenterWindow
SettingsWindow
QuickCaptureWindow
SearchModal
```

The module components contain substantial product behavior, API calls, state
management, editors, inspectors, menus, and dialogs. They are not merely
desktop mockups.

## 2. Reuse matrix

Classification:

- **Reuse unchanged** means the component should be imported by the web shell
  without a visual or behavioral fork.
- **Adapt for web** means the product UI can remain shared, but its shell
  inputs, navigation callback, or layout context must change.
- **Replace with adapter** means the current call crosses into Electron and
  needs a capability interface.
- **Desktop-only** means the behavior has no normal-browser equivalent and is
  intentionally not part of web parity.

| Area | Reuse unchanged | Adapt for web | Replace with adapter | Desktop-only |
| --- | --- | --- | --- | --- |
| Auth provider and session API | `AuthContext`, auth service, `LoginForm` | Return-to-route handling | Native auth-window sizing/visibility | Electron auth window choreography |
| Workspace state | `WorkspaceContext`, workspace API, member/access checks | URL workspace parameter and redirect state | Electron active-workspace IPC events | None; workspace data is product behavior |
| Shared API layer | `useApi`, Supabase service, domain types | Browser request/auth error handling where needed | None for ordinary API calls | None |
| New Tab / Home | `NewTabWindow` visual composition, search, pins, counts | Render as `/home`, replace module-open callbacks with URL navigation | None for data; optional external-link adapter | Desktop close/new-tab window semantics |
| Dashboard / Overview | `DashboardContent`, rows, cards, check-in UI | Read `section` from URL and emit URL navigation | None for normal data | Desktop module window controls |
| Today | Dashboard Today section | `/today` alias/normalization | None | Separate Today module does not currently exist |
| Circle | `CircleWindow` product UI and data behavior | Person/context focus from URL | Desktop module open/toggle calls | Desktop pop-out/window controls |
| Calendar | `CalendarWindow`, calendar primitives, event/reminder UI | URL date/view/event/reminder state; browser resize constraints | External calendar OAuth/opening only where applicable | Native Apple Calendar/Reminders access if not API-backed |
| Notes | `NotesWindow`, `NotesHome`, Lexical editor, mind map, templates, history, modals | Note ID and view query state; browser navigation callbacks | Native transcription/audio and file reveal/open behavior | Native system audio capture portions |
| Projects | `ProjectsWindow`, project context, next actions, Drive panels | Project/task URL focus and browser layout constraints | External provider/file actions where Electron-only | Pop-out sizing and window placement |
| Teams | `TeamsWindow`, member/team UI, roles/invites | Team ID and team-settings URL focus | External link handling only if native | Desktop team module window behavior |
| Intake / Inbox | `InboxWindow`, conversion flows, inspector, source metadata | Item/section query state and canonical target navigation | Native file/external URL handling if used | None for core Intake behavior |
| Slack | `SlackWindow`, capture status, conversion, integration UI | Workspace route and browser callback/navigation | External link adapter, OAuth popup strategy | None for Slack API-backed product UI |
| Notifications | `NotificationCenterWindow`, tray list, actions, filters | Notification URL/filter state | Browser notification delivery adapter | Electron notification scheduler/tray delivery |
| Search | Search hooks, result rendering, command definitions | URL query plus command-palette background location | Desktop search-window IPC | Touch Bar/search-window integration |
| Settings | `SettingsWindow`, settings rows, integration pages, forms | Split global/workspace URL ownership | Sidebar material/window settings, native audio settings | Native rendering/GPU/window settings |
| Quick capture | `QuickCaptureWindow`, create forms, API behavior | URL-backed overlay and background location | Native window open/close/always-on-top behavior | Global desktop capture window behavior |
| Sidebar visual UI | `ExpandedSidebar`, `MinimizedSidebar`, `CollapsedSidebar`, theme | Fixed responsive browser shell; retain visual states | Sidebar material, dock, bounds, always-on-top | Floating OS attachment and third-party app docking |
| Workspace tabs | `LedgerTab`, tab styling and route metadata | Browser route/history model | Detach/attach tab windows | Native tab detachment and separate BrowserWindows |
| Module headers | `ModuleWindowHeader` visual primitives and actions | Map close/back/fullscreen actions to web shell | Native minimize/fullscreen/window bounds | Native title-bar and drag region |
| Dialogs and menus | `ModalOverlay`, `ContextMenu`, `CloseGuardModal`, common buttons | History/escape/outside-click integration | Native file picker/external-open actions | Window-level modal positioning |
| Theme/tokens | `desktopTokens`, CSS variables, Tailwind classes, `index.css` | Browser system theme and persistence | Native material state | Native macOS/Windows vibrancy |
| Icons and avatars | Lucide, provider marks, avatar components | None expected | None | None |

## 3. UI parity inventory

The web implementation should consume the existing renderer surfaces rather
than recreate them in `ledger-web`.

### Shared visual system

Reuse:

- `src/index.css` Ledger CSS variables and global editor styling.
- `src/theme/desktopTokens.ts` light/dark color tokens, spacing, typography,
  radii, and shadows.
- `src/theme/sidebarMaterial.ts` renderer material calculations and
  accessibility fallbacks where browser support permits them.
- Tailwind utility classes already used throughout the modules.
- Existing Ledger accent, surface, border, text, warning, success, and danger
  variables.

The browser must preserve the current light/dark theme values and hierarchy.
It should not introduce a web-only color palette, typography scale, card
language, or header design.

### Shared shell and primitives

The following are the parity-critical primitives:

- `MainLayout`
- `SidebarContainer`
- `ExpandedSidebar`
- `MinimizedSidebar`
- `CollapsedSidebar`
- `PinnedSidebarSection`
- `LedgerTabStrip`
- `ModuleWindowHeader`
- `WorkspaceSwitcherMenu`
- `ModalOverlay`
- `ModalCloseButton`
- `CloseGuardModal`
- `ContextMenu`
- `PageFindBar`
- `ToastProvider`
- `UserAvatar` and `AvatarGroup`
- provider marks and integration icons
- shared skeleton and compact-row primitives

These establish the current spacing, selected states, hover behavior, menus,
panels, modal surfaces, and interaction density.

### Module parity targets

The web target includes the complete current module surface:

- Home/New Tab: greeting, search, pinned destinations, counts, shortcuts.
- Dashboard: focus, tasks, check-in/review, upcoming activity, project
  attention, recent captures.
- Circle: people/accountability context and team-only behavior.
- Calendar: center calendar, left controls, right inspector, event/reminder
  dialogs, follow-ups, calendar providers.
- Notes: file-tree sidebar, editor, inspector, templates, outline, mind map,
  transcription-related UI, version history, embeds, and attachments.
- Projects: project list, overview, next actions, context notebook, linked
  notes, provider panels, and task focus.
- Teams: teams, members, invitations, roles, and team settings.
- Intake: source preview, status sections, conversion actions, and target
  navigation.
- Slack: capture stream, connection state, conversion links, and watched
  conversations.
- Notifications: open/earlier lists, filters, inline actions, and target
  navigation.
- Search: workspace search results and command actions.
- Settings: account, sessions, workspace, members, calendar, notifications,
  integrations, sidebar, shortcuts, accessibility, and meeting notes.
- Quick capture: note, task, event, reminder, and follow-up creation surfaces.

### Layout constraints

Calendar, Notes, and Projects already define pane sizing in
`src/config/modulePaneSizes.ts`. At normal desktop browser widths, those
three-pane layouts should retain their current widths and collapse priorities.
Only below the existing usable thresholds should the browser shell collapse or
overlay a pane. This is a viewport adaptation, not a redesign.

## 4. Electron dependency inventory

### `window.desktopWindow` API

The preload exposes several groups of capabilities. All calls are already
optional in many renderer paths, which is why the renderer can be started in a
browser-tolerant development mode, but optional chaining is not itself a
stable platform boundary.

| Current dependency | Current behavior | Browser impact | Phase 3 boundary | Desktop requirement |
| --- | --- | --- | --- | --- |
| `openModule`, `toggleModule`, `closeModule` | Opens/focuses separate Electron module windows | Blocks desktop-style module navigation in a browser | `NavigationPort.openRoute` | Preserve existing Electron calls unchanged |
| `goBackWorkspaceWindow`, `goForwardWorkspaceWindow` | Navigates Electron workspace-window history | Browser must use `history.back/forward` | `NavigationPort.history` | Preserve Electron workspace history |
| `getWorkspaceNavigationState`, route update/select/close | Persists module route/tab state | Browser needs URL/history/session restoration | `WorkspaceNavigationPort` | Do not alter desktop tab state |
| `detachTab`, `confirmTabDetach`, tab session APIs | Detaches a workspace tab into a BrowserWindow | No equivalent normal-browser operation | `WorkspaceTabsPort` no-op/unsupported result on web | Keep native tab detach untouched |
| `toggleModuleFullscreen`, `setMode`, `setVisible` | Controls BrowserWindow state | No normal web equivalent with identical guarantees | `WindowShellPort` | Keep module window behavior untouched |
| `getWindowBounds`, `setHasShadow` | Reads/sets native window geometry and shadow | Not available or not meaningful in web | `WindowShellPort` | Preserve desktop bounds/shadows |
| `beginHeaderDrag`, `updateHeaderDrag`, `finishHeaderDrag` | Drags native frameless windows | Browser cannot move its tab/window through this API | `WindowDragPort` unsupported on web | Preserve title-bar drag regions |
| floating drag/dock APIs | Moves sidebar and attaches it to screen/app edges | Browser cannot attach to other apps or control OS windows | `SidebarSurfacePort` renderer-only web implementation | Preserve native docking and attachment |
| `applySidebarPreferences`, `previewSidebarOpacity` | Applies native sidebar position/material/bounds | Some preferences are visual only in web; always-on-top and dock are not | `SidebarSurfacePort` | Desktop settings continue using IPC |
| `getSidebarMaterialState`, material development APIs | Reports native Mica/vibrancy/material resolution | Native material engines do not exist in normal browser | `MaterialPort` renderer fallback | Preserve macOS/Windows material paths |
| `openExternal` | Opens links through Electron shell | Browser needs `window.open` or same-tab navigation policy | `ExternalLinkPort` | Preserve safe Electron external-open handling |
| `openCheckin` | Opens native check-in behavior/module | Browser must navigate to Dashboard Today/check-in state | `NavigationPort` | Preserve desktop check-in IPC |
| `getDeviceSessionId` | Gets stable Ledger device/session ID | Browser needs a scoped browser device ID | `DeviceSessionPort` | Preserve existing desktop device identity |
| `setRenderingMode`, rendering settings | Controls native/GPU rendering preferences | Not applicable to ordinary browser | `RenderingSettingsPort` optional/unsupported | Keep native rendering settings untouched |
| `quitApp`, `restartApp` | Exits or restarts desktop app | No safe browser equivalent | No-op/unsupported command | Preserve desktop lifecycle behavior |

### `window.ipcRenderer` events

The renderer listens for IPC events including module focus and state changes,
workspace route changes, sidebar visibility/material/accessibility changes,
notification refreshes, Slack connection changes, calendar/inbox/dashboard
updates, invite opening, and settings focus changes.

These events should not be copied into web code. Phase 3 should define shared
domain events or capability subscriptions, with the Electron implementation
bridging existing IPC and the web implementation using browser events, query
state, or API/realtime refreshes.

Desktop-only event groups include:

- `module:*`
- `workspace:route-*`
- `sidebar:*` native state events
- `touchbar:open-search`
- native window visibility/fullscreen events

Product refresh events such as notifications, Intake, calendar, dashboard, and
Slack updates should eventually have a shared browser-safe subscription model.

### Native audio, meeting recording, and transcription

Meeting recording and transcription cross the most sensitive platform boundary.
The Electron preload includes microphone/system-audio capture, Windows display
audio handling, device enumeration, permission checks, pause/resume/flush/stop
commands, chunk transport, and system-settings links.

Browser capabilities differ:

- microphone capture may be available through `getUserMedia` with permission;
- system audio capture depends on browser, operating system, and user-selected
  screen/tab/window capture;
- device labels and permissions are browser-controlled;
- native system-settings deep links are unavailable;
- background recording and window-independent recording cannot be assumed.

The Notes meeting/transcription UI can be reused, but recording must use an
explicit `MeetingAudioPort`. The web adapter must report unsupported states
instead of pretending to provide desktop parity. Desktop audio and
transcription code must remain untouched.

### Notifications

The desktop main process contains notification scheduling, delivery state, and
native notification/window behavior. The renderer also has
`NotificationMonitor`, `NotificationTray`, and `NotificationCenterWindow`.

The Notification Center product UI is reusable. Native delivery is not. A
future browser adapter may use the Web Notifications API and service-worker
infrastructure, but that is outside Phase 2 and must not alter desktop delivery.

### File, clipboard, and external-resource behavior

The Notes editor and integration surfaces use browser-compatible upload/API
paths in several places, but external open/reveal behavior can cross Electron.
The browser implementation should distinguish:

- API/storage upload: shared;
- clipboard text/image operations: browser capability adapter where needed;
- open URL: browser external-link adapter;
- reveal local file or open local path: desktop-only or explicit browser
  download behavior;
- Google Drive/Figma/GitHub resource access: shared API/UI unless a native
  picker or shell operation is invoked.

Do not add file-system assumptions to shared note/project components.

## 5. Platform boundary recommendation

Introduce a small capability layer in a later phase. The goal is not to wrap
every browser API; it is to isolate code that currently knows about Electron.

```text
Shared product renderer
├── AuthContext / WorkspaceContext / PinsContext / SearchContext
├── useApi and domain types
├── module views and product interactions
├── shared visual tokens and primitives
└── platform capability interfaces

Desktop platform implementation
├── Electron navigation and workspace windows
├── native sidebar/material/docking
├── window bounds/fullscreen/dragging
├── native notifications
├── device/session identity
├── meeting audio/transcription bridge
└── safe external/file operations

Web platform implementation
├── browser URL/history navigation
├── responsive fixed sidebar shell
├── URL-backed overlays
├── browser theme/media preferences
├── browser notifications when supported
├── browser device/session identity
├── browser media capture when supported
└── browser external/download operations
```

Recommended interfaces for Phase 3:

```ts
interface NavigationPort {
  openRoute(route: LedgerRoute, options?: { replace?: boolean }): void;
  goBack(): void;
  goForward(): void;
  openOverlay(route: LedgerOverlayRoute): void;
  closeOverlay(): void;
}

interface WorkspaceNavigationPort {
  getCurrentRoute(): Promise<WorkspaceRouteState | null>;
  subscribe(listener: (route: WorkspaceRouteState) => void): () => void;
  updateRoute(route: WorkspaceRouteState): Promise<void>;
}

interface WindowShellPort {
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
  canDragWindow: boolean;
}

interface SidebarSurfacePort {
  applyPreferences(preferences: SidebarSurfacePreferences): Promise<void>;
  previewOpacity(opacity: number): void;
  supportsNativeMaterial: boolean;
  supportsDocking: boolean;
}

interface ExternalLinkPort {
  open(url: string, options?: { newTab?: boolean }): Promise<void>;
}

interface NotificationPort {
  requestPermission(): Promise<NotificationPermissionLike>;
  show(notification: LedgerNotification): Promise<void>;
}

interface MeetingAudioPort {
  getCapabilities(): Promise<MeetingAudioCapabilities>;
  requestPermissions(): Promise<MeetingAudioPermissions>;
  start(options: MeetingAudioStartOptions): Promise<MeetingAudioSession>;
  control(sessionId: string, command: MeetingAudioCommand): Promise<void>;
  stop(sessionId: string): Promise<void>;
}

interface DeviceSessionPort {
  getId(): Promise<string>;
}
```

These are architectural boundaries only. Phase 2 does not add them.

The preferred migration pattern is to inject capability callbacks/ports into
shared components at shell boundaries. Avoid adding `if (isWeb)` to every
module. Desktop should receive the existing Electron-backed implementation;
web should receive browser-backed implementations.

## 6. What should remain shared unchanged

The following areas are product code, not Electron shell code, and should be
reused directly wherever possible:

- authentication and workspace API behavior;
- workspace membership and role checks;
- Notes editor, document hydration, autosave, templates, history, embeds, and
  mind-map data behavior;
- Projects data, next actions, context notes, linked notes, and provider state;
- Calendar event/reminder data, follow-ups, and provider-backed state;
- Circle and Teams data behavior and team-only rules;
- Intake conversion behavior and source metadata;
- Slack capture/conversion behavior;
- notification list/action behavior;
- search indexing, result categories, and command definitions;
- settings forms and persistence except native-only controls;
- Ledger tokens, CSS variables, icons, avatars, compact rows, inspectors,
  menus, dialogs, and empty/loading/error states.

The web shell should supply navigation and capabilities around these surfaces,
not fork them.

## 7. Desktop regression risk list

These files are high-risk because they sit between shared product UI and native
desktop behavior:

### Highest risk

- `src/App.tsx` — module detection, focus translation, keep-alive rendering,
  onboarding, auth-shell transitions, notification/transcription indicators.
- `src/context/SidebarContext.tsx` — sidebar state, material, persistence,
  docking, fullscreen, and module layout behavior.
- `src/components/Sidebar/SidebarContainer.tsx` — hover/autohide/floating
  behavior and native material presentation.
- `src/components/Common/MainLayout.tsx` — shell geometry and sidebar placement.
- `src/components/Common/LedgerTabStrip.tsx` — persistent route/tab state and
  Electron detach/close behavior.
- `src/components/Common/ModuleWindowHeader.tsx` — native drag, fullscreen,
  minimize, and module window controls.
- `electron/preload.ts` — the public Electron capability surface.
- `electron/main.ts` — BrowserWindow lifecycle, routing, bounds, docking,
  notifications, audio, and module windows.

### High risk by product surface

- `src/components/Notes/NotesWindow.tsx` and `RichTextEditor.tsx` — hydration,
  autosave, editor runtime, focus routing, transcription, and dialogs.
- `src/components/Calendar/CalendarWindow.tsx` — provider state, focus events,
  drag behavior, and three-pane layout.
- `src/components/Projects/ProjectsWindow.tsx` — project/task focus, provider
  operations, and pane sizing.
- `src/components/Teams/TeamsWindow.tsx` and `TeamSettingsWindow.tsx` — team
  focus contexts, invitations, and role actions.
- `src/components/Inbox/InboxWindow.tsx` — conversion and target navigation.
- `src/components/Slack/SlackWindow.tsx` — external links, capture conversion,
  and integration state.
- `src/components/Settings/SettingsWindow.tsx` — sidebar/native settings,
  integration callbacks, sessions, and workspace lifecycle.
- `src/components/Common/NewTabWindow.tsx` and `SearchModal.tsx` — command
  actions that currently call `openModule`.
- `src/components/Notifications/NotificationCenterWindow.tsx` and
  `NotificationMonitor.tsx` — native event refresh and target routing.

Do not change these files as part of introducing the web shell unless the
change is an isolated, tested capability injection that leaves Electron's
default path identical.

## 8. Phase 3 handoff

Phase 3 should introduce, in this order:

1. A typed canonical route model derived from
   `docs/web/route-contract.md`.
2. A browser `NavigationPort` implementation that supports path/query state,
   history, redirects, and background locations for overlays.
3. An Electron-compatible navigation bridge that preserves current
   `openModule` and focus behavior without replacing desktop navigation.
4. A shell/window capability interface for close, minimize, fullscreen, drag,
   bounds, and pop-outs.
5. A sidebar surface interface separating renderer sidebar presentation from
   native material, docking, always-on-top, and window bounds.
6. An external-link/file operation interface.
7. A device/session interface with `web` and `desktop` implementations.
8. A meeting audio/transcription interface with explicit unsupported and
   permission states for web.
9. A notification delivery interface; keep Notification Center UI shared.
10. Shared navigation callbacks for module cross-links so modules no longer
    directly call `window.desktopWindow.openModule` when rendered in web.

Do not begin by copying `App.tsx` or the module files into `ledger-web`. The
first implementation step should be a browser shell that supplies the same
providers, tokens, module components, API clients, and capability ports.

## 9. Explicit non-goals

- No visual redesign or web-specific design system.
- No module fork in `ledger-web`.
- No replacement of Electron navigation.
- No changes to sidebar placement, pop-outs, workspace tabs, or native window
  behavior.
- No broad `isWeb` conditionals scattered through product modules.
- No browser PWA/offline implementation.
- No browser notification implementation yet.
- No authentication rewrite.
- No responsive redesign beyond preserving usable desktop layouts at narrower
  browser widths.

## 10. Validation conclusions

- Every Phase 1 primary module is represented: Home/New Tab, Dashboard, Today
  alias, Circle, Calendar, Notes, Projects, Tasks, Events, Teams, Intake,
  Slack, Notifications, Search, Settings, and quick capture.
- The current renderer already contains the visual primitives and product
  layouts needed for parity.
- The largest web work is shell/navigation/capability separation, not visual
  recreation.
- Native material, floating/docked windows, BrowserWindow tabs, native
  notifications, native audio/system capture, window dragging, and app
  lifecycle are not ordinary browser capabilities.
- No runtime files were changed by this audit.
