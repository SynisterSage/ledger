import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const preferences = await readFile('src/config/sidebarPreferences.ts', 'utf8');
const context = await readFile('src/context/SidebarContext.tsx', 'utf8');
const container = await readFile('src/components/Sidebar/SidebarContainer.tsx', 'utf8');
const settings = await readFile('src/components/Settings/SettingsWindow.tsx', 'utf8');
const css = await readFile('src/index.css', 'utf8');
const main = await readFile('electron/main.ts', 'utf8');
const preload = await readFile('electron/preload.ts', 'utf8');
const controller = await readFile('electron/sidebarMaterialController.ts', 'utf8');
const materialTypes = await readFile('src/theme/sidebarMaterial.ts', 'utf8');
const desktopTokens = await readFile('src/theme/desktopTokens.ts', 'utf8');

test('legacy blur preference migrates idempotently to frosted background', () => {
  assert.match(preferences, /typeof parsed\.frostedBackgroundEnabled === 'boolean'/);
  assert.match(preferences, /typeof parsed\.blur === 'boolean'\s*\n\s*\? parsed\.blur/);
  assert.match(preferences, /sidebarSettingsVersion: SIDEBAR_SETTINGS_MIGRATION_VERSION/);
  assert.doesNotMatch(preferences, /blur: preferences\.blur/);
});

test('opacity remains one clamped preference and is applied to material alpha only', () => {
  assert.match(preferences, /SIDEBAR_OPACITY_MIN = 0\.7/);
  assert.match(preferences, /SIDEBAR_OPACITY_MAX = 1/);
  assert.match(container, /--sidebar-material-alpha/);
  assert.doesNotMatch(container, /window\.setOpacity/);
  assert.match(css, /background-color: rgb\(\s*var\(--sidebar-material-rgb\)/);
});

test('system transparency overrides the resolved material without changing the saved preference', () => {
  assert.match(context, /effectiveFrostedBackground/);
  assert.match(context, /frostedBackgroundEnabled && !transparencyOverrideActive/);
  assert.match(container, /data-reduce-transparency=/);
  assert.match(css, /data-reduce-transparency='true'/);
  assert.match(settings, /Disabled while your system's Reduce Transparency/);
});

test('reduce motion is shared and disables sidebar transitions without disabling frosted material', () => {
  assert.match(context, /prefers-reduced-motion: reduce/);
  assert.match(container, /data-reduce-motion=/);
  assert.match(css, /data-reduce-motion='true'/);
  assert.match(css, /transition-duration: 0ms/);
  assert.match(container, /effectiveFrostedBackground/);
});

test('native accessibility state has a narrow preload bridge and live update event', () => {
  assert.match(preload, /getSidebarAccessibilityState/);
  assert.match(main, /nativeTheme\.prefersReducedTransparency/);
  assert.match(main, /nativeTheme\.on\('updated'/);
  assert.match(main, /sidebar:accessibility-updated/);
});

test('floating mode does not add a desktop blur filter', () => {
  assert.match(css, /sidebar-glass-material--blur\.sidebar-glass-material--attached/);
  assert.doesNotMatch(css, /sidebar-glass-material--floating[^{]*\{[^}]*backdrop-filter/);
  assert.doesNotMatch(css, /(?<!backdrop-)filter:\s*blur\(/);
});

test('sidebar material has one clipped layer and centralized renderer tokens', () => {
  assert.match(css, /--sidebar-material-rgb: 22 22 24/);
  assert.match(css, /--sidebar-solid-rgb: 24 24 26/);
  assert.match(css, /--sidebar-frost-blur: 10px/);
  assert.match(css, /--sidebar-edge-color: rgb\(255 255 255 \/ 0\.06\)/);
  assert.match(container, /sidebar-glass-clip/);
  assert.match(container, /sidebar-glass-material/);
  assert.match(container, /sidebar-glass-content/);
  assert.doesNotMatch(css, /sidebar-glass-material::before|sidebar-glass-material::after/);
  assert.doesNotMatch(css, /sidebar-glass-(?:clip|material)[^}]*box-shadow/);
  assert.match(css, /\.sidebar-glass-clip[\s\S]*isolation: isolate/);
});

test('solid accessibility fallback uses the solid token without overwriting opacity', () => {
  assert.match(css, /data-reduce-transparency='true'\] \.sidebar-glass-material/);
  assert.match(css, /background: rgb\(var\(--sidebar-solid-rgb\)\)/);
  assert.match(container, /--sidebar-material-alpha/);
  assert.match(
    context,
    /sidebarPreferences\.frostedBackgroundEnabled && !transparencyOverrideActive/
  );
});

test('material compositor stays stable during sidebar interaction', () => {
  assert.doesNotMatch(container, /willChange/);
  assert.doesNotMatch(container, /backdrop-filter\s*:/);
  assert.doesNotMatch(css, /transition[^;{]*backdrop-filter/);
  assert.equal((css.match(/(?:^|[\s{])backdrop-filter:\s*blur\(/gm) ?? []).length, 1);
});

test('native macOS material is development-only and has a renderer fallback', () => {
  assert.match(controller, /LEDGER_SIDEBAR_NATIVE_MACOS_ROLLOUT/);
  assert.match(controller, /this\.isPackaged/);
  assert.match(controller, /this\.platform === 'darwin'/);
  assert.match(controller, /setVibrancy\(this\.selectedMacVibrancy\(\)\)/);
  assert.match(controller, /under-window/);
  assert.match(controller, /visualEffectState/);
  assert.match(materialTypes, /SIDEBAR_NATIVE_MAC_TINT_ALPHA_MIN = 0\.3/);
  assert.match(materialTypes, /SIDEBAR_NATIVE_MAC_TINT_ALPHA_MAX = 0\.55/);
  assert.match(controller, /setVibrancy\(null\)/);
  assert.match(controller, /native-api-error/);
  assert.match(main, /sidebar:material-state/);
  assert.match(preload, /setSidebarMaterialDevelopmentSelection/);
  assert.match(preload, /getSidebarMaterialState/);
});

test('native renderer state deterministically disables CSS blur', () => {
  assert.match(container, /materialEngine === 'renderer'/);
  assert.match(container, /getSidebarNativeMacTintAlpha/);
  assert.match(container, /data-material-engine=/);
  assert.match(css, /data-material-engine='native-macos'\] \.sidebar-glass-material/);
  assert.match(css, /data-material-engine='native-windows-mica'\] \.sidebar-glass-material/);
  assert.match(css, /data-material-engine='native-windows-mica-alt'\] \.sidebar-glass-material/);
  assert.match(css, /data-material-engine='native-windows-acrylic'\] \.sidebar-glass-material/);
  assert.match(css, /data-material-engine='solid'\] \.sidebar-glass-material/);
  assert.match(css, /data-material-engine='native-macos'[\s\S]*backdrop-filter: none/);
});

test('Windows native material prefers Acrylic and supports Mica comparison modes', () => {
  assert.match(controller, /LEDGER_SIDEBAR_NATIVE_WINDOWS_ROLLOUT/);
  assert.match(materialTypes, /native-windows-mica-alt/);
  assert.match(controller, /native-windows-mica/);
  assert.match(controller, /native-windows-acrylic/);
  assert.match(controller, /setBackgroundMaterial\('mica'\)/);
  assert.match(controller, /setBackgroundMaterial\('tabbed'\)/);
  assert.match(controller, /setBackgroundMaterial\('acrylic'\)/);
  assert.match(controller, /setBackgroundMaterial\('none'\)/);
  assert.match(controller, /SIDEBAR_MATERIAL_SUPPORT_MATRIX\.windowsBuild/);
  assert.match(preload, /'mica' \| 'mica-alt' \| 'acrylic'/);
});

test('central controller owns explicit resolution, fallback, and native call deduplication', () => {
  assert.match(materialTypes, /\| 'solid'/);
  assert.match(materialTypes, /fallbackReason/);
  assert.match(controller, /resolveSidebarMaterial/);
  assert.match(controller, /engineUnchanged/);
  assert.match(controller, /win\.isDestroyed\(\)/);
  assert.match(controller, /activeNativeEngine/);
  assert.match(controller, /isNewWindow/);
  assert.match(controller, /this\.activeWindow = null/);
  assert.doesNotMatch(container, /setVibrancy|setBackgroundMaterial/);
});

test('phase 7 diagnostics track native lifecycle and tint updates without changing the engine', () => {
  assert.match(controller, /nativeMaterialApplyCount/);
  assert.match(controller, /nativeMaterialClearCount/);
  assert.match(controller, /lastApplicationTimestamp/);
  assert.match(controller, /noteOpacityUpdate/);
  assert.match(controller, /resetDiagnostics/);
  assert.match(main, /window:reset-sidebar-material-diagnostics/);
  assert.match(preload, /resetSidebarMaterialDiagnostics/);
  assert.match(controller, /rendererMaterialLayerCount: 1/);
  assert.match(css, /native-windows-mica-alt/);
});

test('phase 8 production rollout selects macOS native or Windows Acrylic', () => {
  assert.match(controller, /LEDGER_SIDEBAR_NATIVE_MATERIAL_ENABLED/);
  assert.match(controller, /LEDGER_SIDEBAR_NATIVE_KILL_SWITCH/);
  assert.match(controller, /LEDGER_SIDEBAR_NATIVE_COHORT/);
  assert.match(materialTypes, /productionMacEngine: 'native-macos'/);
  assert.match(materialTypes, /productionWindowsEngine: 'native-windows-acrylic'/);
  assert.doesNotMatch(materialTypes, /productionWindowsEngine: 'native-windows-mica-alt'/);
  assert.doesNotMatch(materialTypes, /productionWindowsEngine: 'native-windows-mica'/);
});

test('native failure is session-sticky and does not retry on ordinary lifecycle sync', () => {
  assert.match(controller, /failedNativeEngines/);
  assert.match(controller, /this\.failedNativeEngines\.add/);
  assert.match(controller, /this\.failedNativeEngines\.has/);
});

test('attached renderer frost changes only tint alpha and blur, never floating or native modes', () => {
  assert.match(container, /isAttachedRendererMaterial/);
  assert.match(container, /getSidebarMaterialAlpha\(opacity\) -/);
  assert.match(container, /isRendererMaterial && effectiveFrostedBackground \? 0\.16 : 0/);
  assert.match(container, /sidebar-glass-material--blur/);
  assert.match(container, /materialEngine === 'renderer'/);
  assert.match(container, /__LEDGER_SIDEBAR_MATERIAL_DIAGNOSTICS__/);
  assert.match(container, /rendererBackdropContentAvailable/);
});

test('sidebar material tokens follow the resolved light or dark desktop theme', () => {
  assert.match(desktopTokens, /const sidebarMaterial =/);
  assert.match(desktopTokens, /scheme === 'dark'/);
  assert.match(desktopTokens, /'--sidebar-material-rgb': sidebarMaterial\.rgb/);
  assert.match(desktopTokens, /'--sidebar-material-text-primary': sidebarMaterial\.textPrimary/);
  assert.match(desktopTokens, /'--sidebar-edge-color': sidebarMaterial\.edge/);
});
