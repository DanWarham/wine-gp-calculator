import type { Rule } from '@/types/rules'
import { validateRuleSetForPricing } from '@/lib/pricing'

/**
 * Small deterministic GP rule set for the local authenticated test account.
 * Shared-boundary bands covering all non-negative 750ml-equivalent costs.
 */
export const TEST_USER_GP_RULES: Rule[] = [
  { type: 'less_than', max: 10, gp: 75 },
  { type: 'between', min: 10, max: 25, start_gp: 75, end_gp: 65 },
  { type: 'greater_than', min: 25, gp: 65 },
]

export function assertTestUserGpRulesValid(): void {
  const error = validateRuleSetForPricing(TEST_USER_GP_RULES)
  if (error) {
    throw new Error(`TEST_USER_GP_RULES invalid: ${error.message}`)
  }
}
