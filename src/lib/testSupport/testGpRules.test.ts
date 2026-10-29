import { describe, expect, it } from 'vitest'
import { validateRuleSetForPricing } from '@/lib/pricing'
import { assertTestUserGpRulesValid, TEST_USER_GP_RULES } from '@/lib/testSupport/testGpRules'
import { hasTestUserCredentials, readTestUserCredentials } from '@/lib/testSupport/testUserCredentials'

describe('TEST_USER_GP_RULES', () => {
  it('is a valid calculation rule set', () => {
    expect(validateRuleSetForPricing(TEST_USER_GP_RULES)).toBeNull()
    expect(() => assertTestUserGpRulesValid()).not.toThrow()
  })

  it('covers common calculator bands without universal-only shortcut', () => {
    expect(TEST_USER_GP_RULES.map((r) => r.type)).toEqual([
      'less_than',
      'between',
      'greater_than',
    ])
  })
})

describe('test user credentials helper', () => {
  it('does not throw when credentials are absent', () => {
    // Unit suite must remain runnable without .env.test.local.
    // Presence depends on the local machine; only assert the API is safe.
    const value = readTestUserCredentials()
    expect(value === null || (typeof value.email === 'string' && typeof value.password === 'string')).toBe(
      true
    )
    expect(typeof hasTestUserCredentials()).toBe('boolean')
  })
})
