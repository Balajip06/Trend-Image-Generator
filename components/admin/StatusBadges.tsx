import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'

type EvalStatus = 'untested' | 'passed' | 'failed'

const EVAL_TONE: Record<EvalStatus, string> = {
  passed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent',
  failed: 'bg-destructive/15 text-destructive border-transparent',
  untested: 'bg-muted text-muted-foreground border-transparent',
}

export function EvalBadge({ status, className }: { status: EvalStatus; className?: string }) {
  return (
    <Badge
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        EVAL_TONE[status],
        className
      )}
    >
      {status}
    </Badge>
  )
}

export function ActiveBadge({ active, className }: { active: boolean; className?: string }) {
  return (
    <Badge
      className={cn(
        'rounded-full border-transparent px-2.5 py-0.5 text-[11px] font-semibold',
        active
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground',
        className
      )}
    >
      {active ? 'live' : 'draft'}
    </Badge>
  )
}

type GenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'failed_retryable'
  | string

const GEN_TONE: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  processing: 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]',
  pending: 'bg-amber-400/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-destructive/15 text-destructive',
  failed_retryable: 'bg-amber-400/15 text-amber-700 dark:text-amber-300',
}

const GEN_LABEL: Record<string, string> = {
  failed_retryable: 'retrying',
}

const IN_FLIGHT = new Set(['pending', 'processing', 'failed_retryable'])

/** Tinted status pill for a generation row; in-flight statuses get a pulsing dot. */
export function GenerationStatusBadge({
  status,
  className,
}: {
  status: GenerationStatus
  className?: string
}) {
  return (
    <Badge
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border-transparent px-2.5 py-0.5 text-[11px] font-semibold',
        GEN_TONE[status] ?? 'bg-muted text-muted-foreground',
        className
      )}
    >
      {IN_FLIGHT.has(status) && (
        <span className="relative grid size-1.5 place-items-center">
          <span className="absolute size-1.5 rounded-full bg-current opacity-75" />
          <span className="live-ping absolute size-1.5 rounded-full bg-current" />
        </span>
      )}
      {GEN_LABEL[status] ?? status}
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
        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        source === 'auto'
          ? 'border-[var(--brand-cyan)]/30 text-[var(--brand-cyan)]'
          : 'text-foreground/70',
        className
      )}
    >
      {source}
    </Badge>
  )
}
