/**
 * Structural guard: every mutating admin server action must authorize itself.
 *
 * Admin pages are gated by `proxy.ts`, but that is a single point of failure
 * with a documented `MOCK_TRENDS=true` bypass (lib/supabase/middleware.ts), and
 * server actions POST to their own endpoint. Every admin mutation runs on the
 * SERVICE client, so RLS provides no defence-in-depth either — the in-action
 * role guard is the only real authorization.
 *
 * This test scans the source of every `'use server'` file under
 * `app/admin/(authed)` and fails if an exported action lacks a guard call, so a
 * newly-added unguarded action breaks CI instead of shipping.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ADMIN_AUTHED_DIR = join(process.cwd(), 'app/admin/(authed)')

/** Guard helpers that satisfy the requirement. */
const GUARD_CALLS = ['requireAdminRole(', 'checkAdminRole(']

/**
 * Actions that legitimately need no role guard.
 * `signOutAction` only ends the caller's own session — requiring a role to
 * sign out would trap a demoted admin in an unusable session.
 */
const EXEMPT = new Set(['signOutAction'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function exportedActionNames(source: string): string[] {
  return Array.from(source.matchAll(/export async function (\w+)\s*\(/g)).map((m) => m[1])
}

describe('admin server actions are authorized', () => {
  const serverActionFiles = walk(ADMIN_AUTHED_DIR).filter((file) => {
    const source = readFileSync(file, 'utf8')
    return /^['"]use server['"]/m.test(source)
  })

  it('finds the admin server-action files to check', () => {
    // Guards against the scan silently matching nothing (e.g. after a move).
    expect(serverActionFiles.length).toBeGreaterThanOrEqual(5)
  })

  it.each(serverActionFiles.map((f) => [f.replace(process.cwd() + '/', ''), f]))(
    '%s guards every exported action',
    (_label, file) => {
      const source = readFileSync(file, 'utf8')
      const unguarded = exportedActionNames(source).filter((name) => {
        if (EXEMPT.has(name)) return false
        // Body = from this export to the next top-level export (or EOF).
        const start = source.indexOf(`export async function ${name}`)
        const nextExport = source.indexOf('\nexport async function ', start + 1)
        const body = source.slice(start, nextExport === -1 ? undefined : nextExport)
        return !GUARD_CALLS.some((call) => body.includes(call))
      })

      expect(unguarded).toEqual([])
    }
  )
})
