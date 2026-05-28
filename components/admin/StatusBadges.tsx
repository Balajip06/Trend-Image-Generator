import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'

type EvalStatus = 'untested' | 'passed' | 'failed'

const EVAL_TONE: Record<EvalStatus, string> = {
  passed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent',
  failed: 'bg-destructive/15 text-destructive border-transparent',
  untested: 'bg-muted text-muted-foreground border-transparent',
}

export function EvalBadge({
  status,
  className,
}: {
  status: EvalStatus
  className?: string
}) {
  return (
    <Badge className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', EVAL_TONE[status], className)}>
      {status}
    </Badge>
  )
}

export function ActiveBadge({
  active,
  className,
}: {
  active: boolean
  className?: string
}) {
  return (
    <Badge
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold border-transparent',
        active
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {active ? 'live' : 'draft'}
    </Badge>
  )
}

export function SourceBadge({
  source,
  className,
}: {
  source: 'auto' | 'user'
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        source === 'auto' ? 'text-[var(--brand-cyan)] border-[var(--brand-cyan)]/30' : 'text-foreground/70',
        className,
      )}
    >
      {source}
    </Badge>
  )
}
