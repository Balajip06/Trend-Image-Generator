'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const ToggleSchema = z.object({
  generation_id: z.string().uuid(),
  make_public: z.boolean(),
})

export interface TogglePublicResult {
  ok: boolean
  isPublic?: boolean
  error?: string
}

/**
 * Opt a completed generation in or out of public sharing.
 *
 * Deliberately uses the request-scoped client, not the service client: the
 * `generations_own_update_share` RLS policy already constrains this to
 * `auth.uid() = user_id AND status = 'completed'`, so the database is the
 * enforcement point. A service-role write here would bypass that policy and
 * make this action the only thing standing between a crafted request and
 * another user's row.
 */
export async function toggleGenerationPublic(
  generationId: string,
  makePublic: boolean
): Promise<TogglePublicResult> {
  const parsed = ToggleSchema.safeParse({
    generation_id: generationId,
    make_public: makePublic,
  })
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You need to be signed in.' }

  const { data, error } = await supabase
    .from('generations')
    .update({ is_public: parsed.data.make_public })
    .eq('id', parsed.data.generation_id)
    .eq('user_id', user.id)
    .select('is_public')
    .maybeSingle()

  // No row came back => RLS rejected it (not the owner, or not completed).
  // Reported the same way as a genuine miss so this can't be used to probe
  // which generation ids exist.
  if (error || !data) return { ok: false, error: 'Could not update sharing for this creation.' }

  revalidatePath(`/result/${parsed.data.generation_id}`)
  revalidatePath(`/s/${parsed.data.generation_id}`)

  return { ok: true, isPublic: data.is_public }
}
