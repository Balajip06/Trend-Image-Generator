import Link from 'next/link'
import type { ReactNode } from 'react'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Trend Image
          </Link>
          <nav className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-300">
            <Link href="/me/creations" className="hover:text-zinc-900 dark:hover:text-zinc-50">
              My creations
            </Link>
            <Link href="/me/settings" className="hover:text-zinc-900 dark:hover:text-zinc-50">
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </div>
  )
}
