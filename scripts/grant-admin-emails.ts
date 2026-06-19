/**
 * Grant admin access to a list of emails.
 *
 * Usage:
 *   pnpm dlx tsx scripts/grant-admin-emails.ts
 *
 * Reads ADMIN_EMAILS from the environment (comma-separated).
 * For each email:
 *   1. Finds the profile by email
 *   2. Inserts a row into admin_users with role='admin' if not already there
 *   3. Prints a summary
 *
 * Safe to re-run — idempotent.
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

const rawEmails = process.env.ADMIN_EMAILS ?? ''
if (!rawEmails.trim()) {
  console.error('ADMIN_EMAILS is not set in .env.local — add a comma-separated list of emails')
  process.exit(1)
}

const emails = rawEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
console.log(`Granting admin access to ${emails.length} email(s):`, emails)

const supabase = createClient(url, key, { auth: { persistSession: false } })

for (const email of emails) {
  console.log(`\n── ${email}`)

  // Find profile by email
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle()

  if (!profile) {
    console.log(`  ℹ  No profile yet — sign in first, then re-run this script`)
    continue
  }

  // Check if already an admin
  const { data: existing } = await supabase
    .from('admin_users')
    .select('user_id, role')
    .eq('user_id', profile.id)
    .maybeSingle()

  if (existing) {
    console.log(`  ✓ Already has admin access (role: ${existing.role}) — no change needed`)
    continue
  }

  // Insert into admin_users
  const { error } = await supabase
    .from('admin_users')
    .insert({ user_id: profile.id, role: 'admin' })

  if (error) {
    console.error(`  ✗ Failed:`, error.message)
  } else {
    console.log(`  ✓ Added to admin_users with role='admin' (user_id: ${profile.id})`)
  }
}

console.log('\nDone.')
