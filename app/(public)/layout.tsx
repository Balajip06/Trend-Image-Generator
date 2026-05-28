import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-md">
        <div className="border-b border-border/60 bg-background/70">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" aria-label="Trendly home" className="-m-2 p-2">
              <Logo gradient />
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href="/me/creations"
                className="hidden rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline"
              >
                My creations
              </Link>
              <Link
                href="/login"
                className="hidden rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 sm:inline-block"
              >
                Sign in
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border/60 bg-background/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
          <Logo size="sm" />
          <p>Made for the feed. © {new Date().getFullYear()} Trendly.</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground">
              Trends
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
