export type IndicatorDisplay = {
  id: string | number;
  workArea: { x: number; y: number; width: number; height: number };
};

export type IndicatorBounds = { x: number; y: number; width: number; height: number };

export type SavedIndicatorPosition = {
  displayId: string;
  relativeX: number;
  relativeY: number;
};

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

export function clampIndicatorBounds(bounds: IndicatorBounds, workArea: IndicatorDisplay['workArea']) {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    ...bounds,
    x: Math.max(workArea.x, Math.min(bounds.x, maxX)),
    y: Math.max(workArea.y, Math.min(bounds.y, maxY)),
  };
}

export function saveIndicatorPosition(bounds: IndicatorBounds, display: IndicatorDisplay): SavedIndicatorPosition {
  const maxX = Math.max(1, display.workArea.width - bounds.width);
  const maxY = Math.max(1, display.workArea.height - bounds.height);
  return {
    displayId: String(display.id),
    relativeX: Math.max(0, Math.min(1, (bounds.x - display.workArea.x) / maxX)),
    relativeY: Math.max(0, Math.min(1, (bounds.y - display.workArea.y) / maxY)),
  };
}

export function restoreIndicatorPosition(
  saved: SavedIndicatorPosition | null,
  display: IndicatorDisplay,
  bounds: Pick<IndicatorBounds, 'width' | 'height'>,
) {
  const availableWidth = Math.max(0, display.workArea.width - bounds.width);
  const availableHeight = Math.max(0, display.workArea.height - bounds.height);
  const relativeX = finite(saved?.relativeX) ? saved?.relativeX ?? 1 : 1;
  const relativeY = finite(saved?.relativeY) ? saved?.relativeY ?? 0.5 : 0.5;
  const candidate = {
    x: display.workArea.x + relativeX * availableWidth,
    y: display.workArea.y + relativeY * availableHeight,
    width: bounds.width,
    height: bounds.height,
  };
  return clampIndicatorBounds(candidate, display.workArea);
}

export function activityFromLevel(level: number): 'silent' | 'low' | 'medium' | 'high' {
  if (!finite(level) || level < 0.04) return 'silent';
  if (level < 0.25) return 'low';
  if (level < 0.6) return 'medium';
  return 'high';
}
