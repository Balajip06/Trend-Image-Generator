'use client'

import type { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SupabaseUserState {
  user: User | null
  /** True until the first client-side check resolves — use to render a
   * neutral placeholder instead of guessing signed-in/out on first paint. */
  loading: boolean
}

/**
 * Client-side auth state, decoupled from server-rendered/ISR-cached markup.
 * Fetches the current user on mount, then stays live via onAuthStateChange
 * so sign-in/sign-out happening anywhere (including a stale cached shell)
 * reflects in this component without a full page reload.
 */
export function useSupabaseUser(): SupabaseUserState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      setUser(data.user)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}
