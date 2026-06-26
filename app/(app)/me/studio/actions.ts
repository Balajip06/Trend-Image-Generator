'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Schema = z.object({ trend_id: z.string().uuid() })

export async function toggleFavouriteTrend(formData: FormData): Promise<void> {
  const parsed = Schema.safeParse({ trend_id: formData.get('trend_id') })
  if (!parsed.success) redirect('/me/studio?error=invalid_id')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me/studio')

  const trendId = parsed.data.trend_id

  const { data: profile } = await supabase
    .from('profiles')
    .select('favourite_trend_ids')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/me/studio?error=not_found')

  const current: string[] = profile.favourite_trend_ids ?? []
  const next = current.includes(trendId)
    ? current.filter((id) => id !== trendId)
    : [...current, trendId]

  await supabase.from('profiles').update({ favourite_trend_ids: next }).eq('id', user.id)

  revalidatePath('/me/studio')
}
