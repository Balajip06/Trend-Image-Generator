import * as Sentry from '@sentry/nextjs'

/**
 * Error-aware unwrapping for admin Supabase reads.
 *
 * Admin pages uniformly wrote `const { data } = await supabase...`, discarding
 * `error`. Every failure therefore rendered as an EMPTY STATE — visually
 * identical to "there is no data yet". A permission change, a renamed column,
 * or a transient outage all showed "No entries yet" instead of an error, which
 * is why "the audit data is not getting fetched" looked like a data problem
 * rather than a failing query.
 *
 * `lib/trends/repository.ts` already does this correctly (Sentry breadcrumb +
 * honest empty); these helpers generalize that so every admin read behaves the
 * same way.
 */

export interface AdminReadResult<T> {
  rows: T[]
  /** Present only when the read FAILED. Empty rows with no error means "no data". */
  error: string | null
}

interface SupabaseishResult<T> {
  data: T[] | null
  error: { message: string; code?: string } | null
}

/**
 * Unwrap a list read, distinguishing failure from emptiness. Reports failures
 * to Sentry so an outage is visible in monitoring, and returns the message so
 * the page can render an error state rather than an empty one.
 */
export async function adminRead<T>(
  op: string,
  query: PromiseLike<SupabaseishResult<T>>
): Promise<AdminReadResult<T>> {
  try {
    const { data, error } = await query
    if (error) {
      Sentry.captureMessage(`admin read failed: ${op}`, {
        level: 'error',
        tags: { component: 'admin-read', op },
        extra: { code: error.code, message: error.message },
      })
      return { rows: [], error: error.message }
    }
    return { rows: data ?? [], error: null }
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: 'admin-read', op } })
    return { rows: [], error: err instanceof Error ? err.message : 'read failed' }
  }
}

/**
 * Single-row variant for `.maybeSingle()` reads. `row` is null both when the
 * row is genuinely absent and when the read failed — check `error` to tell
 * those apart.
 */
export async function adminReadOne<T = unknown>(
  op: string,
  query: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>
): Promise<{ row: T | null; error: string | null }> {
  try {
    const { data, error } = await query
    if (error) {
      Sentry.captureMessage(`admin read failed: ${op}`, {
        level: 'error',
        tags: { component: 'admin-read', op },
        extra: { code: error.code, message: error.message },
      })
      return { row: null, error: error.message }
    }
    return { row: data, error: null }
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: 'admin-read', op } })
    return { row: null, error: err instanceof Error ? err.message : 'read failed' }
  }
}
