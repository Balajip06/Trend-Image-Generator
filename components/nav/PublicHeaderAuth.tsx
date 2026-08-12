'use client'

import { LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSupabaseUser } from '@/lib/hooks/useSupabaseUser'

/**
 * Auth-dependent slice of the public header (email chip + sign out, or the
 * "Sign in" link). Client-rendered on purpose — `/` and `/trend/[slug]`
 * are ISR-cached pages, so any auth state baked into their server render
 * goes stale for up to the revalidate window (10min–1hr). Fetching here,
 * after hydration, keeps the header honest regardless of page cache age.
 */
export function PublicHeaderAuth() {
  const { user, loading } = useSupabaseUser()
  const [pending, startTransition] = useTransition()
  const [signedOut, setSignedOut] = useState(false)
  const router = useRouter()

  const onSignOut = () => {
    startTransition(async () => {
      await createClient().auth.signOut()
      setSignedOut(true)
      router.push('/')
      router.refresh()
    })
  }

  // Pre-resolve, render nothing in this slot rather than guessing — avoids
  // a flash of the wrong state (signed-in user briefly seeing "Sign in").
  if (loading) {
    return <span className="hidden h-8 w-24 sm:inline-block" aria-hidden />
  }

  if (!user || signedOut) {
    return (
      <Link
        href="/login"
        className="bg-foreground text-background hidden rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 sm:inline-block"
      >
        Sign in
      </Link>
    )
  }

  return (
    <div
      className="border-border/60 bg-card/40 hidden items-center gap-2 rounded-full border py-1 pr-1 pl-3 sm:flex"
      title={user.email ?? undefined}
    >
      <span className="text-foreground max-w-[160px] truncate text-xs font-semibold">
        {user.email}
      </span>
      <button
        type="button"
        onClick={onSignOut}
        disabled={pending}
        aria-label="Sign out"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-ring/60 grid size-6 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
      >
        <LogOut className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
