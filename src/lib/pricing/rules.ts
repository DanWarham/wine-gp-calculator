import type { Rule } from '@/types/rules'
import { RULE_REFERENCE_BOTTLE_ML } from './defaults'
import type { ResolveGpInput, ResolveGpResult } from './types'
import {
  gpFromCoveringRule,
  isValidNonNegativeCost,
  isValidPositiveMl,
  ruleCoversCost,
  validateRuleSetForPricing,
} from './validation'

/**
 * Convert an actual bottle acquisition cost to the 750ml-equivalent
 * reference cost used for GP rule boundary matching.
 */
export function toReferenceCost750ml(actualCostExVat: number, bottleSizeMl: number): number {
  return (actualCostExVat * RULE_REFERENCE_BOTTLE_ML) / bottleSizeMl
}

/**
 * Resolve target GP from rules using 750ml-equivalent reference cost.
 * Does not apply silent fallbacks.
 */
export function resolveTargetGp(input: ResolveGpInput): ResolveGpResult {
  const { actualCostExVat, bottleSizeMl, rules } = input

  if (!isValidNonNegativeCost(actualCostExVat)) {
    return {
      ok: false,
      error: { code: 'INVALID_COST', message: 'Acquisition cost must be a finite non-negative number.' },
    }
  }

  if (!isValidPositiveMl(bottleSizeMl)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_BOTTLE_SIZE',
        message: 'Bottle size must be a positive finite volume in ml.',
      },
    }
  }

  const structureError = validateRuleSetForPricing(rules)
  if (structureError) {
    return { ok: false, error: structureError }
  }

  const referenceCost750ml = toReferenceCost750ml(actualCostExVat, bottleSizeMl)

  const allGp = rules.find((r) => r.type === 'all_gp')
  if (allGp) {
    return {
      ok: true,
      referenceCost750ml,
      targetGp: allGp.gp,
      matchedRule: allGp,
    }
  }

  const matches = rules.filter((r) => ruleCoversCost(r, referenceCost750ml))
  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        code: 'NO_MATCHING_RULE',
        message: 'No pricing rule covers this 750ml-equivalent cost.',
      },
      referenceCost750ml,
    }
  }

  const gps = matches.map((r) => gpFromCoveringRule(r, referenceCost750ml))
  const firstGp = gps[0]
  if (gps.some((g) => Math.abs(g - firstGp) > 1e-9)) {
    return {
      ok: false,
      error: {
        code: 'AMBIGUOUS_RULE_MATCH',
        message: 'Multiple pricing rules match this cost with conflicting GP values.',
      },
      referenceCost750ml,
    }
  }

  return {
    ok: true,
    referenceCost750ml,
    targetGp: firstGp,
    matchedRule: matches[0],
  }
}

export type { Rule }
