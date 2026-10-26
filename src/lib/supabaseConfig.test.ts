import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getSupabaseBrowserConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns url and anon key when both env vars are set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    const { getSupabaseBrowserConfig } = await import('./supabaseEnv')
    expect(getSupabaseBrowserConfig()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'test-anon-key',
    })
  })

  it('throws a clear error when either required env var is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    const { getSupabaseBrowserConfig } = await import('./supabaseEnv')
    expect(() => getSupabaseBrowserConfig()).toThrow(
      /Missing Supabase browser configuration/
    )
  })
})
