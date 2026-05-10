export const SkeletonLoader = () => {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      <div className="h-4 bg-gray-200 rounded w-full"></div>
      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
    </div>
  )
}

export const SkeletonCard = () => {
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-200 animate-pulse space-y-2">
      <div className="h-4 bg-gray-200 rounded w-2/3"></div>
      <div className="h-3 bg-gray-100 rounded w-full"></div>
      <div className="h-2 bg-gray-100 rounded w-1/2"></div>
    </div>
  )
}

export const SkeletonList = ({ count = 3 }) => {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// Stats card skeleton for dashboard
export const SkeletonStatCard = () => {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 bg-gray-200 rounded w-24"></div>
        <div className="h-5 w-5 bg-gray-200 rounded"></div>
      </div>
      <div className="mt-4 h-8 bg-gray-200 rounded w-16"></div>
      <div className="mt-1 h-3 bg-gray-100 rounded w-32"></div>
    </div>
  )
}

export const SkeletonStatCards = ({ count = 4 }) => {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  )
}

// Project card skeleton
export const SkeletonProjectCard = () => {
  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="mt-1 h-3 bg-gray-100 rounded w-20"></div>
        </div>
        <div className="h-4 bg-gray-200 rounded w-12"></div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-gray-200"></div>
    </div>
  )
}

// Note/Event card skeleton
export const SkeletonNoteCard = () => {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          <div className="mt-1 h-3 bg-gray-100 rounded w-full"></div>
          <div className="mt-1 h-3 bg-gray-100 rounded w-3/4"></div>
        </div>
        <div className="h-3 bg-gray-200 rounded w-12"></div>
      </div>
    </div>
  )
}

// Task item skeleton (for focus items)
export const SkeletonTaskItem = () => {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 animate-pulse">
      <div className="mt-0.5 h-5 w-5 shrink-0 bg-gray-200 rounded-full"></div>
      <div className="flex-1 space-y-1">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
      <div className="mt-0.5 h-5 w-5 shrink-0 bg-gray-200 rounded"></div>
    </div>
  )
}
