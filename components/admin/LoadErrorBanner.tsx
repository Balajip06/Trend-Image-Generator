import { TriangleAlert } from 'lucide-react'

interface LoadErrorBannerProps {
  /** The failure message. Renders nothing when null/undefined. */
  error?: string | null
  /** What failed to load, e.g. "referrals". */
  label?: string
}

/**
 * Renders a failed admin read as an explicit error.
 *
 * Admin pages previously discarded `error` from every Supabase read, so a
 * failure was indistinguishable from an empty table — "No entries yet" showed
 * for both. On pages with demo fallbacks it was worse: an outage rendered
 * fabricated numbers behind a "demo data" badge. Pair this with `adminRead`
 * from `@/lib/admin/read`.
 */
export function LoadErrorBanner({ error, label = 'data' }: LoadErrorBannerProps) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-2xl border border-dashed p-4"
    >
      <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">Could not load {label}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-xs break-words">{error}</p>
      </div>
    </div>
  )
}
