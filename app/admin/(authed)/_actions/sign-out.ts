'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Back to the ADMIN login, not the consumer one — an admin signing out of the
  // console should land where they can sign back into it.
  redirect('/admin/login')
}
