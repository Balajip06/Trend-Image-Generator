import Link from 'next/link'
import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Trendly home" className="-m-2 p-2">
            <Logo gradient />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/me/creations"
              className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              My creations
            </Link>
            <Link
              href="/me/settings"
              className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Settings
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </div>
  )
}
