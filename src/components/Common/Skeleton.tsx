const skeletonSurface = 'var(--ledger-surface-muted, #FAF5F0)';
const skeletonFill = 'var(--ledger-background-muted, #FFF4EA)';
const skeletonBorder = 'var(--ledger-border-subtle, #E8DDD4)';

export const SkeletonLoader = () => {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 rounded w-3/4" style={{ backgroundColor: skeletonFill }} />
      <div className="h-4 rounded w-full" style={{ backgroundColor: skeletonFill }} />
      <div className="h-4 rounded w-5/6" style={{ backgroundColor: skeletonFill }} />
    </div>
  );
};

export const SkeletonCard = () => {
  return (
    <div
      className="rounded-lg border p-3 animate-pulse space-y-2"
      style={{ backgroundColor: skeletonSurface, borderColor: skeletonBorder }}
    >
      <div className="h-4 rounded w-2/3" style={{ backgroundColor: skeletonFill }} />
      <div className="h-3 rounded w-full" style={{ backgroundColor: skeletonFill }} />
      <div className="h-2 rounded w-1/2" style={{ backgroundColor: skeletonFill }} />
    </div>
  );
};

export const SkeletonList = ({ count = 3 }) => {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
};

// Stats card skeleton for dashboard
export const SkeletonStatCard = () => {
  return (
    <div
      className="rounded-3xl border p-5 animate-pulse"
      style={{ backgroundColor: skeletonSurface, borderColor: skeletonBorder }}
    >
      <div className="flex items-center justify-between">
        <div className="h-4 rounded w-24" style={{ backgroundColor: skeletonFill }} />
        <div className="h-5 w-5 rounded" style={{ backgroundColor: skeletonFill }} />
      </div>
      <div className="mt-4 h-8 rounded w-16" style={{ backgroundColor: skeletonFill }} />
      <div className="mt-1 h-3 rounded w-32" style={{ backgroundColor: skeletonFill }} />
    </div>
  );
};

export const SkeletonStatCards = ({ count = 4 }) => {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  );
};

// Project card skeleton
export const SkeletonProjectCard = () => {
  return (
    <div
      className="w-full rounded-2xl border p-4 animate-pulse"
      style={{ backgroundColor: skeletonSurface, borderColor: skeletonBorder }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 rounded w-3/4" style={{ backgroundColor: skeletonFill }} />
          <div className="mt-1 h-3 rounded w-20" style={{ backgroundColor: skeletonFill }} />
        </div>
        <div className="h-4 rounded w-12" style={{ backgroundColor: skeletonFill }} />
      </div>
      <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: skeletonFill }} />
    </div>
  );
};

// Note/Event card skeleton
export const SkeletonNoteCard = () => {
  return (
    <div
      className="rounded-2xl border px-4 py-3 animate-pulse"
      style={{ backgroundColor: skeletonSurface, borderColor: skeletonBorder }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 rounded w-2/3" style={{ backgroundColor: skeletonFill }} />
          <div className="mt-1 h-3 rounded w-full" style={{ backgroundColor: skeletonFill }} />
          <div className="mt-1 h-3 rounded w-3/4" style={{ backgroundColor: skeletonFill }} />
        </div>
        <div className="h-3 rounded w-12" style={{ backgroundColor: skeletonFill }} />
      </div>
    </div>
  );
};

// Task item skeleton (for focus items)
export const SkeletonTaskItem = () => {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border px-4 py-3 animate-pulse"
      style={{ backgroundColor: skeletonSurface, borderColor: skeletonBorder }}
    >
      <div
        className="mt-0.5 h-5 w-5 shrink-0 rounded-full"
        style={{ backgroundColor: skeletonFill }}
      />
      <div className="flex-1 space-y-1">
        <div className="h-4 rounded w-3/4" style={{ backgroundColor: skeletonFill }} />
      </div>
      <div
        className="mt-0.5 h-5 w-5 shrink-0 rounded"
        style={{ backgroundColor: skeletonFill }}
      />
    </div>
  );
};

export const SkeletonCompactRow = () => {
  return (
    <div
      className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-1.5 animate-pulse"
      style={{ backgroundColor: skeletonSurface }}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] bg-[color:var(--ledger-background-muted,#FFF4EA)]">
        <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: skeletonFill }} />
      </div>
      <div className="min-w-0">
        <div className="h-3.5 rounded w-3/5" style={{ backgroundColor: skeletonFill }} />
      </div>
      <div className="h-3 rounded w-16" style={{ backgroundColor: skeletonFill }} />
    </div>
  );
};
