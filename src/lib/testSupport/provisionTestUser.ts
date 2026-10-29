import { supabase } from '@/lib/supabaseClient'
import {
  getOrCreateCurrentPricingConfiguration,
  listPricingConfigurations,
  updatePricingConfiguration,
} from '@/lib/pricingConfigurationStore'
import { listServingSizes } from '@/lib/servingSizeStore'
import { DEFAULT_SERVING_SIZE_DEFINITIONS } from '@/lib/servingSizeDefaults'
import { DEFAULT_PRICING_POLICY } from '@/lib/pricing'
import type { PricingConfiguration } from '@/types/pricingConfigurations'
import type { Rule } from '@/types/rules'
import type { ServingSize } from '@/types/servingSizes'
import { assertTestUserGpRulesValid, TEST_USER_GP_RULES } from '@/lib/testSupport/testGpRules'
import {
  requireTestUserCredentials,
  type TestUserCredentials,
} from '@/lib/testSupport/testUserCredentials'

export type ProvisionTestUserResult =
  | {
      ok: true
      userId: string
      email: string
      configuration: PricingConfiguration
      initiallyEmptyRules: boolean
      servingSizeCount: number
      expectedDefaultServingSizeCount: number
      rules: Rule[]
    }
  | { ok: false; error: string }

/**
 * Sign in as the local test user using normal Auth password login.
 * Uses the shared browser/anon Supabase client (no service-role).
 */
export async function signInAsTestUser(
  credentials?: TestUserCredentials
): Promise<{ ok: true; userId: string; email: string } | { ok: false; error: string }> {
  const { email, password } = credentials ?? requireTestUserCredentials()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? 'Sign-in failed.' }
  }
  return { ok: true, userId: data.user.id, email }
}

/**
 * Initialise the local authenticated test account via normal app behaviour:
 * 1. sign in
 * 2. ensure Current Pricing Configuration (Main Pricing + default policy + Serving Sizes on first use)
 * 3. confirm first-use rules are empty when applicable
 * 4. save the deterministic TEST_USER_GP_RULES set
 *
 * Safe to re-run: re-applies the deterministic rule set if already provisioned.
 */
export async function provisionTestUserAccount(): Promise<ProvisionTestUserResult> {
  assertTestUserGpRulesValid()

  const signedIn = await signInAsTestUser()
  if (!signedIn.ok) return signedIn

  const ensured = await getOrCreateCurrentPricingConfiguration(signedIn.userId)
  if (!ensured.ok) {
    await supabase.auth.signOut()
    return { ok: false, error: ensured.error }
  }

  const initiallyEmptyRules = ensured.data.rules.length === 0

  if (ensured.data.name !== 'Main Pricing' || !ensured.data.isCurrent) {
    await supabase.auth.signOut()
    return {
      ok: false,
      error: `Expected Current configuration named Main Pricing; got name=${ensured.data.name} isCurrent=${ensured.data.isCurrent}.`,
    }
  }

  const sizes = await listServingSizes(signedIn.userId)
  if (!sizes.ok) {
    await supabase.auth.signOut()
    return { ok: false, error: sizes.error }
  }

  if (sizes.data.length === 0) {
    await supabase.auth.signOut()
    return {
      ok: false,
      error: 'Serving Sizes were empty after ensure; first-use seeding did not run or failed.',
    }
  }

  const listed = await listPricingConfigurations(signedIn.userId)
  if (!listed.ok) {
    await supabase.auth.signOut()
    return { ok: false, error: listed.error }
  }

  const saved = await updatePricingConfiguration(
    signedIn.userId,
    ensured.data.id,
    {
      name: ensured.data.name,
      rules: TEST_USER_GP_RULES,
      pricingPolicy: ensured.data.pricingPolicy,
    },
    listed.data
  )

  if (!saved.ok) {
    await supabase.auth.signOut()
    return { ok: false, error: saved.error }
  }

  await supabase.auth.signOut()

  return {
    ok: true,
    userId: signedIn.userId,
    email: signedIn.email,
    configuration: saved.data,
    initiallyEmptyRules,
    servingSizeCount: sizes.data.length,
    expectedDefaultServingSizeCount: DEFAULT_SERVING_SIZE_DEFINITIONS.length,
    rules: saved.data.rules,
  }
}

export function summarizeServingSizes(rows: ServingSize[]): Array<{
  category: string
  label: string
  volumeMl: number
  enabled: boolean
}> {
  return rows.map((r) => ({
    category: r.category,
    label: r.label,
    volumeMl: r.volumeMl,
    enabled: r.enabled,
  }))
}

export function isDefaultPricingPolicy(
  policy: PricingConfiguration['pricingPolicy']
): boolean {
  return (
    policy.vatRate === DEFAULT_PRICING_POLICY.vatRate &&
    policy.btgBottleDiscount === DEFAULT_PRICING_POLICY.btgBottleDiscount &&
    policy.bottleRoundingIncrement === DEFAULT_PRICING_POLICY.bottleRoundingIncrement &&
    policy.pourRoundingIncrement === DEFAULT_PRICING_POLICY.pourRoundingIncrement
  )
}
