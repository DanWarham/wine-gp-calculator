import { supabase } from '@/lib/supabaseClient'
import {
  DEFAULT_PRICING_POLICY,
  validatePricingPolicy,
  type PricingPolicy,
} from '@/lib/pricing'
import { seedDefaultServingSizes } from '@/lib/servingSizeStore'

/** Row shape returned by PostgREST for public.pricing_policy. */
export interface PricingPolicyRow {
  id: string
  user_id: string
  vat_rate: number | string
  btg_bottle_discount: number | string
  bottle_rounding_increment: number | string
  pour_rounding_increment: number | string
  created_at: string
  updated_at: string
}

export type PricingPolicyLoadResult =
  | { ok: true; policy: PricingPolicy; row: PricingPolicyRow }
  | { ok: false; error: string }

export type PricingPolicySaveResult =
  | { ok: true; policy: PricingPolicy; row: PricingPolicyRow }
  | { ok: false; error: string }

/** UI percent (e.g. 20) → domain/DB rate (e.g. 0.2). */
export function percentToRate(percent: number): number {
  return percent / 100
}

/** Domain/DB rate (e.g. 0.2) → UI percent (e.g. 20). */
export function rateToPercent(rate: number): number {
  return rate * 100
}

function toNumber(value: number | string): number {
  if (typeof value === 'number') return value
  return Number(value)
}

export function rowToPricingPolicy(row: PricingPolicyRow): PricingPolicy {
  return {
    vatRate: toNumber(row.vat_rate),
    btgBottleDiscount: toNumber(row.btg_bottle_discount),
    bottleRoundingIncrement: toNumber(row.bottle_rounding_increment),
    pourRoundingIncrement: toNumber(row.pour_rounding_increment),
  }
}

function mapPostgrestError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.code === '23505') {
    return 'A pricing policy already exists for this user.'
  }
  if (error.code === '23514') {
    return 'Pricing policy values failed database validation.'
  }
  return error.message || fallback
}

/**
 * Load the authenticated user's pricing policy, creating a default row if none exists.
 * Relies on DB column defaults for product defaults (aligned with DEFAULT_PRICING_POLICY).
 * Does not fall back to in-memory defaults on failure.
 *
 * First-time policy creation also seeds default Serving Sizes (conflict-safe).
 * An existing policy must never trigger Serving Size reseeding — an intentionally
 * empty serving-size configuration stays empty.
 */
export async function getOrCreatePricingPolicy(userId: string): Promise<PricingPolicyLoadResult> {
  const { data: existing, error: selectError } = await supabase
    .from('pricing_policy')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (selectError) {
    return {
      ok: false,
      error: mapPostgrestError(selectError, 'Failed to load pricing policy.'),
    }
  }

  if (existing) {
    const policy = rowToPricingPolicy(existing as PricingPolicyRow)
    const validation = validatePricingPolicy(policy)
    if (validation) {
      return { ok: false, error: validation.message }
    }
    return { ok: true, policy, row: existing as PricingPolicyRow }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('pricing_policy')
    .insert([{ user_id: userId }])
    .select('*')
    .single()

  if (!insertError && inserted) {
    const seed = await seedDefaultServingSizes(userId)
    if (!seed.ok) {
      return { ok: false, error: seed.error }
    }

    const policy = rowToPricingPolicy(inserted as PricingPolicyRow)
    const validation = validatePricingPolicy(policy)
    if (validation) {
      return { ok: false, error: validation.message }
    }
    return { ok: true, policy, row: inserted as PricingPolicyRow }
  }

  // Concurrent first-use: unique violation → re-select the winner's row.
  // Do not seed serving sizes here — the winning session owns first-use seeding.
  if (insertError?.code === '23505') {
    const { data: raced, error: raceSelectError } = await supabase
      .from('pricing_policy')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (raceSelectError || !raced) {
      return {
        ok: false,
        error: mapPostgrestError(raceSelectError, 'Failed to load pricing policy after concurrent create.'),
      }
    }

    const policy = rowToPricingPolicy(raced as PricingPolicyRow)
    const validation = validatePricingPolicy(policy)
    if (validation) {
      return { ok: false, error: validation.message }
    }
    return { ok: true, policy, row: raced as PricingPolicyRow }
  }

  return {
    ok: false,
    error: mapPostgrestError(insertError, 'Failed to create default pricing policy.'),
  }
}

/** Persist an updated policy for the owning user. Sets updated_at explicitly. */
export async function savePricingPolicy(
  userId: string,
  policy: PricingPolicy
): Promise<PricingPolicySaveResult> {
  const validation = validatePricingPolicy(policy)
  if (validation) {
    return { ok: false, error: validation.message }
  }

  const { data, error } = await supabase
    .from('pricing_policy')
    .update({
      vat_rate: policy.vatRate,
      btg_bottle_discount: policy.btgBottleDiscount,
      bottle_rounding_increment: policy.bottleRoundingIncrement,
      pour_rounding_increment: policy.pourRoundingIncrement,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: mapPostgrestError(error, 'Failed to save pricing policy.'),
    }
  }

  return {
    ok: true,
    policy: rowToPricingPolicy(data as PricingPolicyRow),
    row: data as PricingPolicyRow,
  }
}

/** Exported for tests/docs — product defaults used when DB inserts with column defaults only. */
export const PROVISIONING_DEFAULTS = DEFAULT_PRICING_POLICY
