import { describe, expect, it, vi } from 'vitest'
import { fetchAllPagedRows, SUPABASE_PAGE_SIZE } from './supabasePagedSelect'

describe('fetchAllPagedRows', () => {
  it('aggregates multiple pages past a 1000-row PostgREST-style cap', async () => {
    const total = 1100
    const pageSize = 500
    const buildPage = vi.fn(async (from: number, to: number) => {
      const chunk: Array<{ id: number }> = []
      for (let i = from; i <= Math.min(to, total - 1); i++) {
        chunk.push({ id: i })
      }
      return { data: chunk, error: null }
    })

    const result = await fetchAllPagedRows(buildPage, pageSize)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(1100)
    expect(result.data[0].id).toBe(0)
    expect(result.data[1099].id).toBe(1099)
    expect(buildPage).toHaveBeenCalledTimes(3)
    expect(buildPage).toHaveBeenNthCalledWith(1, 0, 499)
    expect(buildPage).toHaveBeenNthCalledWith(2, 500, 999)
    expect(buildPage).toHaveBeenNthCalledWith(3, 1000, 1499)
  })

  it('stops after a short final page', async () => {
    const buildPage = vi.fn(async (from: number) => {
      if (from === 0) {
        return {
          data: Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => ({ id: i })),
          error: null,
        }
      }
      return { data: [{ id: SUPABASE_PAGE_SIZE }], error: null }
    })

    const result = await fetchAllPagedRows(buildPage)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(SUPABASE_PAGE_SIZE + 1)
    expect(buildPage).toHaveBeenCalledTimes(2)
  })

  it('propagates page errors', async () => {
    const result = await fetchAllPagedRows(async () => ({
      data: null,
      error: { message: 'boom' },
    }))
    expect(result).toEqual({ ok: false, error: 'boom' })
  })
})
