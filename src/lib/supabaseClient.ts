import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserConfig } from '@/lib/supabaseEnv'

let browserClient: SupabaseClient | undefined

function getBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = getSupabaseBrowserConfig()
    browserClient = createClient(url, anonKey)
  }
  return browserClient
}

/**
 * Lazily initialised browser client. Missing env fails on first use with a
 * clear configuration error (no hardcoded fallback).
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    const client = getBrowserClient()
    const value = Reflect.get(client, property, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
