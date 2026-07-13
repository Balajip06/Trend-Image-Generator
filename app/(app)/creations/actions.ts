'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const ToggleSchema = z.object({ generation_id: z.string().uuid() })

export async function toggleFavorite(formData: FormData): Promise<void> {
  const parsed = ToggleSchema.safeParse({
    generation_id: formData.get('generation_id'),
  })
  if (!parsed.success) redirect('/creations?error=invalid_id')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/creations')

  const { data: row } = await supabase
    .from('generations')
    .select('is_favorite')
    .eq('id', parsed.data.generation_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) redirect('/creations?error=not_found')

  const next = !row.is_favorite

  await supabase
    .from('generations')
    .update({
      is_favorite: next,
      favorited_at: next ? new Date().toISOString() : null,
    })
    .eq('id', parsed.data.generation_id)
    .eq('user_id', user.id)

  revalidatePath('/creations')
}
