/**
 * One-shot local test-account initialisation.
 * Not part of default `npm test` (see vitest.provision.config.ts).
 *
 * Run: npm run test:provision-user
 */
import { describe, expect, it } from 'vitest'
import { listServingSizes } from '@/lib/servingSizeStore'
import { DEFAULT_SERVING_SIZE_DEFINITIONS } from '@/lib/servingSizeDefaults'
import {
  isDefaultPricingPolicy,
  provisionTestUserAccount,
  readTestUserCredentials,
  summarizeServingSizes,
  TEST_USER_GP_RULES,
} from '@/lib/testSupport'
import { supabase } from '@/lib/supabaseClient'

describe('local authenticated test-user provisioning', () => {
  it('provisions Main Pricing, Serving Sizes, and deterministic GP rules', async () => {
    const credentials = readTestUserCredentials()
    if (!credentials) {
      throw new Error(
        'Set TEST_USER_EMAIL and TEST_USER_PASSWORD in git-ignored .env.test.local before provisioning.'
      )
    }

    const result = await provisionTestUserAccount()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.configuration.name).toBe('Main Pricing')
    expect(result.configuration.isCurrent).toBe(true)
    expect(result.configuration.status).toBe('active')
    expect(isDefaultPricingPolicy(result.configuration.pricingPolicy)).toBe(true)
    expect(result.servingSizeCount).toBe(DEFAULT_SERVING_SIZE_DEFINITIONS.length)
    expect(result.rules).toEqual(TEST_USER_GP_RULES)

    // Re-verify serving sizes under a fresh sign-in for the report.
    const { data: auth, error } = await supabase.auth.signInWithPassword(credentials)
    expect(error).toBeNull()
    expect(auth.user?.id).toBe(result.userId)

    const sizes = await listServingSizes(result.userId)
    expect(sizes.ok).toBe(true)
    if (!sizes.ok) throw new Error(sizes.error)

    const byKey = (row: { category: string; label: string; volumeMl: number }) =>
      `${row.category}|${row.label}|${row.volumeMl}`
    expect(new Set(summarizeServingSizes(sizes.data).map(byKey))).toEqual(
      new Set(
        DEFAULT_SERVING_SIZE_DEFINITIONS.map((d) =>
          byKey({ category: d.category, label: d.label, volumeMl: d.volumeMl })
        )
      )
    )
    expect(sizes.data.every((r) => r.enabled)).toBe(true)

    await supabase.auth.signOut()

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          email: result.email,
          userId: result.userId,
          initiallyEmptyRules: result.initiallyEmptyRules,
          configuration: {
            id: result.configuration.id,
            name: result.configuration.name,
            isCurrent: result.configuration.isCurrent,
            status: result.configuration.status,
            pricingPolicy: result.configuration.pricingPolicy,
            ruleCount: result.rules.length,
          },
          servingSizeCount: result.servingSizeCount,
          rules: result.rules,
        },
        null,
        2
      )
    )
  }, 60_000)
})
