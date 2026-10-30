/**
 * Fetch all matching rows past PostgREST max_rows (commonly 1000).
 * Uses .range() pagination rather than raising the server max_rows limit.
 */

export const SUPABASE_PAGE_SIZE = 500

type PageResult<T> = {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Exhaustively page a PostgREST select. `buildPage` must apply filters/order
 * then `.range(from, to)` and return the awaited result.
 */
export async function fetchAllPagedRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<{ ok: true; data: T[] } | { ok: false; error: string }> {
  const rows: T[] = []
  let from = 0

  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await buildPage(from, to)
    if (error) return { ok: false, error: error.message }
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    from += pageSize
  }

  return { ok: true, data: rows }
}
