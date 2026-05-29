import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Badge } from '@/components/ui/badge'

interface AdminShellProps {
  children: ReactNode
}

/**
 * Internal-tooling shell. Borrows brand Logo + theme toggle from the consumer
 * app but skips the gradient surface — admin is workhorse, not viral.
 */
export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/admin"
            aria-label="Admin home"
            className="-m-2 flex items-center gap-2 p-2"
          >
            <Logo wordmark={false} size="sm" />
            <span className="text-sm font-semibold tracking-tight">Admin console</span>
            <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase">
              internal
            </Badge>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin/trends"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Trends
            </Link>
            <Link
              href="/admin/suggestions"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Suggestions
            </Link>
            <Link
              href="/admin/referrals"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Referrals
            </Link>
            <Link
              href="/admin/audit"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Audit
            </Link>
            <Link
              href="/"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              ← App
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  )
}
