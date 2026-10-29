import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserConfig } from '@/lib/supabaseEnv'

/**
 * Authenticated Supabase client for trusted Next.js server routes.
 * Uses the caller's JWT so auth.uid() / RLS / SECURITY DEFINER RPCs work.
 * Never accepts or embeds the service-role key.
 */
export function createAuthenticatedSupabaseClient(accessToken: string): SupabaseClient {
  const { url, anonKey } = getSupabaseBrowserConfig()
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

export async function requireAuthenticatedUser(request: Request): Promise<
  | { ok: true; token: string; userId: string; supabase: SupabaseClient }
  | { ok: false; status: number; error: string }
> {
  const token = getBearerToken(request)
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required.' }
  }

  const supabase = createAuthenticatedSupabaseClient(token)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Authentication required.' }
  }

  return { ok: true, token, userId: data.user.id, supabase }
}
