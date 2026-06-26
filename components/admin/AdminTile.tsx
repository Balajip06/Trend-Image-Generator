import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

export interface AdminTileProps {
  href: string
  icon: ReactNode
  title: string
  description: string
  /** Tailwind gradient class fragment, e.g. `"from-emerald-400 to-cyan-400"`. */
  accent: string
  /** Optional pill in the top-right (e.g. "3 pending"). */
  badge?: string
}

/**
 * "Jump to" navigation tile on the admin dashboard. Renders a gradient hairline
 * at the top, an icon chip, title + description, and a hover-animated arrow.
 */
export function AdminTile({ href, icon, title, description, accent, badge }: AdminTileProps) {
  return (
    <Link
      href={href}
      className="group border-border/60 bg-card relative overflow-hidden rounded-2xl border p-5 transition-[transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
    >
      <div
        className={`absolute inset-x-0 top-0 h-0.5 origin-top bg-gradient-to-r transition-transform duration-[var(--duration-base)] group-hover:scale-y-[3] ${accent}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="bg-muted text-foreground grid size-10 place-items-center rounded-xl transition-transform duration-[var(--duration-base)] group-hover:scale-110">
          {icon}
        </div>
        {badge && (
          <Badge className="rounded-full border-transparent bg-[var(--brand-grad-1)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand-grad-1)]">
            {badge}
          </Badge>
        )}
      </div>
      <h2 className="mt-4 text-base font-bold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      <div className="text-foreground/80 mt-3 inline-flex items-center gap-1 text-xs font-semibold transition-transform group-hover:translate-x-0.5">
        Open <ArrowRight className="size-3.5" />
      </div>
    </Link>
  )
}
