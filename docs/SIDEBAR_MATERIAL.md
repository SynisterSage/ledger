# Sidebar material

Ledger uses one renderer-owned sidebar design with a replaceable background
compositing engine. The sidebar root owns layout and window interaction. A
clipped container owns the single perimeter edge, one material tint layer, and
the opaque content layer. Navigation rows, badges, controls, scrollbars, and
footer surfaces are not material layers.

## Engine model

The shared engine type is:

- `solid`: accessibility or last-resort fallback
- `renderer`: Ledger tint, optionally with one attached `backdrop-filter`
- `native-macos`: Electron `setVibrancy()` with development candidates
  `under-window`, `sidebar`, or `hud`; production defaults to `under-window`
- `native-windows-mica`: Electron `setBackgroundMaterial('mica')`
- `native-windows-mica-alt`: development comparison using `tabbed`
- `native-windows-acrylic`: development comparison using `acrylic`

`SidebarMaterialController` is the only owner of native material lifecycle.
It tracks requested and resolved engines, clears the previous native engine
before switching, deduplicates unchanged applications, and makes native
failures session-sticky before falling back to renderer frost.

## Production support matrix

| Platform/configuration                                                                                    | Production engine             | Minimum support                           | Fallback             |
| --------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- | -------------------- |
| macOS, Electron 30+, macOS 11+, supported transparent sidebar window, rollout enabled                     | native macOS `under-window` vibrancy | `setVibrancy()` available; `visualEffectState` is selected at window creation | renderer, then solid |
| Windows, Electron 30+, Windows build 22000+, supported transparent shaped sidebar window, rollout enabled | Windows Mica                  | `setBackgroundMaterial('mica')` available | renderer, then solid |
| Windows Mica Alt                                                                                          | development-only comparison   | `tabbed` API available                    | renderer             |
| Windows Acrylic                                                                                           | development-only comparison   | `acrylic` API available                   | renderer             |
| unsupported OS, Electron, window configuration, platform, or accessibility state                          | renderer or solid             | no speculative native API call            | renderer, then solid |

Reduce Transparency and native high-contrast state always resolve to `solid`.
Frosted background disabled resolves to the translucent renderer surface with
no blur. The saved Frosted and opacity preferences are never overwritten by a
fallback.

## Rollout and kill switch

Native production rollout is disabled unless all of the following are set by
the release/configuration environment:

- `LEDGER_SIDEBAR_NATIVE_MATERIAL_ENABLED=true`
- `LEDGER_SIDEBAR_NATIVE_COHORT` is present
- the platform rollout percentage includes that cohort:
  - `LEDGER_SIDEBAR_NATIVE_MACOS_ROLLOUT=0..100`
  - `LEDGER_SIDEBAR_NATIVE_WINDOWS_ROLLOUT=0..100`

`LEDGER_SIDEBAR_NATIVE_KILL_SWITCH=true` immediately disables production
native selection without resetting user preferences. The cohort hash is
deterministic and does not use wallpaper, window content, or user data.

Mica is the only Windows production candidate. Mica Alt and Acrylic remain
available only through development diagnostics and are never selected by the
production rollout path.

## Resolution priority

1. Reduce Transparency or high contrast: `solid`.
2. Frosted background disabled: translucent `renderer` without blur.
3. Supported, rolled-out native engine: platform-native engine.
4. Native engine unavailable or failed: renderer frost.
5. Renderer material unavailable: `solid`.

Native and renderer blur are mutually exclusive. Native engines receive one
Ledger tint for brand consistency; they do not receive CSS backdrop blur,
filters, gradients, glow, reflections, or diffusion layers.

macOS native tint alpha is mapped internally from 0.30 to 0.55 across the
shared opacity preference so the system material remains visible. Renderer
material keeps its existing alpha mapping. `followWindow` and `active` are
development-testable visual effect states; Electron 30 exposes this state as
a BrowserWindow creation option rather than a runtime setter, so changing this
state requires recreating or restarting the sidebar window.

## Accessibility and lifecycle

Reduce Motion removes nonessential transitions but does not disable static
material. Reduce Transparency clears native material immediately and restores
the prior eligible engine when the override ends. Native state is synchronized
on window creation, native theme updates, restore/resume, display changes, and
material preference changes. Opacity changes update the material alpha CSS
variable and do not reapply native APIs.

Development diagnostics expose engine selection, fallback reason, native apply
and clear counts, last application time, opacity update count, and the single
renderer material-layer count. Verbose diagnostics are not shown in normal
settings and no production telemetry is currently enabled because Ledger has
no approved telemetry path for this data.

## Visual and performance constraints

The shared tokens are the only material recipe: neutral charcoal tint `22 22 24`,
solid fallback `24 24 26`, `10px` renderer frost, and a single neutral edge
`rgb(255 255 255 / 0.06)`. The foreground remains opaque. Floating windows do
not simulate blur from desktop applications.

Future sidebar material changes must not add nested backdrop filters, glow
layers, diffusion overlays, reflections, gradients used as frost, or per-row
glass effects. Any new native engine must first pass the platform matrix,
visual QA, accessibility checks, lifecycle stress testing, and fallback tests.

## Troubleshooting

- Inspect the development material snapshot for requested/resolved engine and
  fallback reason.
- Reset diagnostics before a controlled lifecycle test.
- If a native API fails, verify the window is recreated or restart the app
  before attempting another native activation; ordinary rerenders do not retry.
- Set `LEDGER_SIDEBAR_NATIVE_KILL_SWITCH=true` to force renderer fallback while
  preserving user settings.
