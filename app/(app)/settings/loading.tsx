import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <section aria-hidden="true" className="flex flex-col gap-10">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-64" />
      </header>

      {/* Quota dashboard card */}
      <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
        <Skeleton className="h-7 w-40" />
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-24 shrink-0 rounded-full" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Buy credits card */}
      <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-4 w-2/3" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Referral card */}
      <div className="border-border/60 bg-gradient-spotlight/20 rounded-3xl border p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-md" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-5 h-12 w-full rounded-2xl" />
      </div>

      {/* Your data card */}
      <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-md" />
          <Skeleton className="h-7 w-32" />
        </div>
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-5 h-10 w-40 rounded-full" />
      </div>

      {/* Danger zone card */}
      <div className="border-destructive/30 bg-destructive/5 rounded-3xl border p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-md" />
          <Skeleton className="h-6 w-36" />
        </div>
        <Skeleton className="mt-2 h-4 w-2/3" />
        <Skeleton className="mt-4 h-10 w-48 rounded-full" />
      </div>
    </section>
  )
}
