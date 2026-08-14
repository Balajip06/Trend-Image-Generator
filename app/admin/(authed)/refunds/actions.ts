'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdminRole } from '@/lib/admin/require-role'
import { grantCredits } from '@/lib/payments/credits'
import { createServiceClient } from '@/lib/supabase/server'

const ReasonCategoryEnum = z.enum(['support', 'goodwill', 'error_correction', 'vip_grant', 'other'])

export type ReasonCategory = z.infer<typeof ReasonCategoryEnum>

const RefundFormSchema = z.object({
  email: z.string().email(),
  amount: z.coerce.number().int().min(1).max(1000),
  reason_category: ReasonCategoryEnum,
  notes: z
    .string()
    .max(500)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
})

function back(params: URLSearchParams): never {
  redirect(`/admin/refunds?${params.toString()}`)
}

export async function issueRefund(formData: FormData): Promise<void> {
  // Grants up to 1000 credits on the service client — RLS offers no protection
  // here, so this guard is the only in-process authorization. 'admin' because
  // it moves money.
  await requireAdminRole('admin')

  const parsed = RefundFormSchema.safeParse({
    email: formData.get('email'),
    amount: formData.get('amount'),
    reason_category: formData.get('reason_category'),
    notes: formData.get('notes'),
  })

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid input'
    back(new URLSearchParams({ error: msg }))
  }

  const service = createServiceClient()

  const { data: profileRow, error: lookupErr } = await service
    .from('profiles')
    .select('id, email')
    .eq('email', parsed.data.email)
    .maybeSingle()

  if (lookupErr) {
    back(new URLSearchParams({ error: `lookup failed: ${lookupErr.message}` }))
  }
  const profile = profileRow ?? null
  if (!profile) {
    back(new URLSearchParams({ error: `no profile for ${parsed.data.email}` }))
  }

  // Persist the reason taxonomy + free-form notes inside source_ref so the
  // audit-log row carries everything needed for compliance review without a
  // schema change. Format: "<category>: <notes>" (notes default placeholder
  // makes blank-notes rows still grep-able by category).
  const noteFragment = parsed.data.notes ?? '<no notes>'
  const sourceRef = `${parsed.data.reason_category}: ${noteFragment}`.slice(0, 200)

  const result = await grantCredits(service, {
    userId: profile.id,
    amount: parsed.data.amount,
    source: 'support',
    sourceRef,
  })

  if (!result.ok) {
    back(new URLSearchParams({ error: result.error ?? 'grant failed' }))
  }

  back(
    new URLSearchParams({
      issued: `${parsed.data.amount} credits to ${parsed.data.email}`,
    })
  )
}
