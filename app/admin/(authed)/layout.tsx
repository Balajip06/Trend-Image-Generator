import type { ReactNode } from 'react'
import { AdminShell, type NavCounts } from '@/components/admin/AdminShell'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { signOutAction } from './_actions/sign-out'

// Live counts for the sidebar badges. Service-role so they reflect ALL rows
// (the authed client's RLS would scope them to the admin). Best-effort: any
// read failure degrades to 0 rather than breaking the shell.
async function loadNavCounts(): Promise<NavCounts> {
  const svc = createServiceClient()
  const [untested, activeGen] = await Promise.all([
    svc.from('trends').select('id', { count: 'exact', head: true }).eq('eval_status', 'untested'),
    svc
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'processing']),
  ])
  return {
    trendsUntested: untested.count ?? 0,
    generationsActive: activeGen.count ?? 0,
  }
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Middleware already gates /admin to authenticated admins, so user is
  // guaranteed to be present + admin-tier here. Read email for the sidebar
  // identity block.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? null
  const counts = await loadNavCounts()

  return (
    <AdminShell email={email} counts={counts} signOutAction={signOutAction}>
      {children}
    </AdminShell>
  )
}
