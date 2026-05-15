export type PaneSizeSpec = {
  min: number;
  max: number;
  defaultWidth: number;
  compactWidth: number;
  compactBreakpoint: number;
  compactThreshold: number;
};

export type ModulePaneSizing = {
  left: PaneSizeSpec;
  right: PaneSizeSpec;
};

export const modulePaneSizing: Record<'calendar' | 'notes' | 'projects', ModulePaneSizing> = {
  calendar: {
    left: {
      min: 260,
      max: 340,
      defaultWidth: 288,
      compactWidth: 268,
      compactBreakpoint: 1440,
      compactThreshold: 280,
    },
    right: {
      min: 260,
      max: 340,
      defaultWidth: 288,
      compactWidth: 268,
      compactBreakpoint: 1440,
      compactThreshold: 280,
    },
  },
  notes: {
    left: {
      min: 248,
      max: 324,
      defaultWidth: 276,
      compactWidth: 252,
      compactBreakpoint: 1400,
      compactThreshold: 280,
    },
    right: {
      min: 210,
      max: 304,
      defaultWidth: 240,
      compactWidth: 224,
      compactBreakpoint: 1400,
      compactThreshold: 248,
    },
  },
  projects: {
    left: {
      min: 244,
      max: 316,
      defaultWidth: 272,
      compactWidth: 248,
      compactBreakpoint: 1400,
      compactThreshold: 276,
    },
    right: {
      min: 220,
      max: 316,
      defaultWidth: 260,
      compactWidth: 236,
      compactBreakpoint: 1400,
      compactThreshold: 264,
    },
  },
};

export const getPaneWidthForViewport = (viewportWidth: number, spec: PaneSizeSpec) =>
  viewportWidth < spec.compactBreakpoint ? spec.compactWidth : spec.defaultWidth;

export const clampPaneWidth = (value: number, viewportWidth: number, spec: PaneSizeSpec) => {
  const maxWidth = viewportWidth < spec.compactBreakpoint ? spec.compactWidth : spec.max;
  return Math.max(spec.min, Math.min(maxWidth, value));
};

export const isCompactPaneLayout = (viewportWidth: number, spec: PaneSizeSpec) =>
  viewportWidth < spec.compactBreakpoint;
