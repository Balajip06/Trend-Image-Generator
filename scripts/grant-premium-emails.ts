/**
 * Grant unlimited (premium) access to a list of emails.
 *
 * Usage:
 *   pnpm dlx tsx scripts/grant-premium-emails.ts
 *
 * Reads PREMIUM_EMAILS from the environment (comma-separated).
 * For each email:
 *   1. Inserts into kimp_client_allowlist (the proof the DB trigger needs)
 *   2. If a profile exists, sets kimp_unlimited=true immediately
 *   3. Prints a summary
 *
 * Safe to re-run — all operations are idempotent.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'node:path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const rawEmails = process.env.PREMIUM_EMAILS ?? ''
if (!rawEmails.trim()) {
  console.error('PREMIUM_EMAILS is not set in .env.local — add a comma-separated list of emails')
  process.exit(1)
}

const emails = rawEmails
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)
console.log(`Granting premium access to ${emails.length} email(s):`, emails)

const supabase = createClient(url, key, { auth: { persistSession: false } })

for (const email of emails) {
  console.log(`\n── ${email}`)

  // 1. Insert into allowlist — check first to be idempotent
  const { data: existing } = await supabase
    .from('kimp_client_allowlist')
    .select('id, is_active')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    if (!existing.is_active) {
      await supabase.from('kimp_client_allowlist').update({ is_active: true }).eq('id', existing.id)
      console.log(`  ✓ Re-activated in kimp_client_allowlist`)
    } else {
      console.log(`  ✓ Already in kimp_client_allowlist`)
    }
  } else {
    const { error: allowlistError } = await supabase
      .from('kimp_client_allowlist')
      .insert({ email, is_active: true, note: 'Granted via PREMIUM_EMAILS env var' })

    if (allowlistError) {
      console.error(`  ✗ Allowlist insert failed:`, allowlistError.message)
      continue
    }
    console.log(`  ✓ Added to kimp_client_allowlist`)
  }

  // 2. Find the profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, kimp_unlimited')
    .eq('email', email)
    .maybeSingle()

  if (!profile) {
    console.log(`  ℹ  No profile yet — access will be granted automatically on first login`)
    continue
  }

  if (profile.kimp_unlimited) {
    console.log(`  ✓ Already has unlimited access — no change needed`)
    continue
  }

  // 3. Grant unlimited directly (allowlist row in DB satisfies the proof trigger)
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      kimp_unlimited: true,
      kimp_client_status: 'active',
      kimp_verified_at: new Date().toISOString(),
    })
    .eq('id', profile.id)

  if (updateError) {
    console.error(`  ✗ Profile update failed:`, updateError.message)
    console.error(
      `    (If you see "check_violation", the allowlist insert may not have committed yet — re-run the script)`
    )
  } else {
    console.log(`  ✓ kimp_unlimited=true set on profile ${profile.id}`)
  }
}

console.log('\nDone.')
