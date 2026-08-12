import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { PublicHeaderAuth } from '@/components/nav/PublicHeaderAuth'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

// No server-side auth read here on purpose. `/` and `/trend/[slug]` are
// ISR-cached (revalidate 600s / 3600s) — baking `getUser()` into this shared
// layout would bake stale auth chrome into the cached render too (the "logo
// click shows signed out" bug). PublicHeaderAuth fetches auth state
// client-side after hydration instead, so it's always fresh regardless of
// page cache age. The footer's "Sign in" link is unconditional — a harmless
// extra link for already-signed-in visitors, not worth a second client
// component for a footer nobody's reporting bugs about.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-md">
        <div className="border-border/60 bg-background/70 border-b">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" aria-label="Trendly home" className="-m-2 p-2">
              <Logo gradient />
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href="/creations"
                className="text-muted-foreground hover:text-foreground hidden rounded-full px-3 py-1.5 sm:inline"
              >
                My creations
              </Link>
              <PublicHeaderAuth />
              <ThemeToggle />
            </nav>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-border/60 bg-background/60 border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm sm:flex-row">
          <Logo size="sm" />
          <p>Made for the feed. © {new Date().getFullYear()} Trendly.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/" className="hover:text-foreground">
              Trends
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
