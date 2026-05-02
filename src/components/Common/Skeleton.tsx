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
