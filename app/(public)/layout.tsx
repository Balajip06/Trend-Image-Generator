import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

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
              <Link
                href="/login"
                className="bg-foreground text-background hidden rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 sm:inline-block"
              >
                Sign in
              </Link>
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
