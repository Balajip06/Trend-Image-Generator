import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <section aria-hidden="true" className="flex flex-col gap-8">
      {/* Header: title + CTA */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-40 rounded-full" />
      </header>

      {/* Filter bar */}
      <div className="border-border/60 bg-card/40 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Skeleton className="mb-1 h-3 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="sm:w-44">
          <Skeleton className="mb-1 h-3 w-10" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="sm:w-32">
          <Skeleton className="mb-1 h-3 w-10" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>

      {/* View chip row (All / Favorites) */}
      <div className="border-border/60 bg-muted inline-flex w-fit items-center gap-1 rounded-lg border p-1">
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-7 w-24" />
      </div>

      {/* Creations grid: 2 / 3 / 4 cols */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </section>
  )
}
