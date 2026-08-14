import * as Sentry from '@sentry/nextjs'

/**
 * Page through an analytics query instead of silently truncating.
 *
 * THE PROBLEM: PostgREST caps rows per response (`max_rows = 1000` in
 * supabase/config.toml). None of the analytics fetchers paginated, and a capped
 * response is a SUCCESS — `error` is null and `data` just stops early. So every
 * unbounded scan (cohort retention over 112 days, the funnel, active-user
 * counts, margin) silently computed on the first 1000 rows and reported the
 * wrong number with total confidence. It gets worse exactly as volume grows,
 * i.e. precisely when the numbers start mattering.
 *
 * This pages with `.range()` until a short page arrives, and stops at a hard
 * ceiling so a runaway query can't pull the whole table into Node. Hitting that
 * ceiling is reported both to Sentry and to the caller, so the UI can say the
 * figure is partial rather than pretending it is exact.
 */

/** Must not exceed PostgREST's `max_rows`, or pages come back short and paging stops early. */
const PAGE_SIZE = 1000

/**
 * Hard ceiling per query. Above this the aggregate belongs in SQL, not Node —
 * the cap keeps a pathological range from OOMing the server.
 */
const DEFAULT_MAX_ROWS = 50_000

export interface PagedResult<T> {
  rows: T[]
  /** True when the ceiling was hit and rows are incomplete. */
  truncated: boolean
  /** Set when the read failed outright (distinct from an empty table). */
  error: string | null
}

interface RangeQuery<T> {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: { message: string; code?: string } | null
  }>
}

/**
 * @param op        label for Sentry breadcrumbs
 * @param buildQuery called per page; must return a fresh builder (they are
 *                   single-use once awaited)
 */
export async function fetchAllPaged<T>(
  op: string,
  buildQuery: () => RangeQuery<T>,
  maxRows: number = DEFAULT_MAX_ROWS
): Promise<PagedResult<T>> {
  const rows: T[] = []
  let from = 0

  try {
    for (;;) {
      const to = Math.min(from + PAGE_SIZE, maxRows) - 1
      if (to < from) break

      const { data, error } = await buildQuery().range(from, to)
      if (error) {
        Sentry.captureMessage(`analytics paged read failed: ${op}`, {
          level: 'warning',
          tags: { component: 'analytics-paged', op },
          extra: { code: error.code, message: error.message, from, to },
        })
        return { rows, truncated: false, error: error.message }
      }

      const page = data ?? []
      rows.push(...page)

      // A short page means we reached the end of the result set.
      if (page.length < to - from + 1) break

      from = to + 1
      if (from >= maxRows) {
        Sentry.captureMessage(`analytics read hit the row ceiling: ${op}`, {
          level: 'warning',
          tags: { component: 'analytics-paged', op },
          extra: { maxRows },
        })
        return { rows, truncated: true, error: null }
      }
    }
    return { rows, truncated: false, error: null }
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: 'analytics-paged', op } })
    return { rows, truncated: false, error: err instanceof Error ? err.message : 'read failed' }
  }
}
