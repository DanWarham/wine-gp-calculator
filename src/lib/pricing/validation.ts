import type {
  AllGpRule,
  BetweenRule,
  GreaterThanRule,
  LessThanRule,
  Rule,
} from '@/types/rules'
import type { PricingError, PricingPolicy } from './types'

/** Margin GP used in the selling-price formula must be strictly between 0 and 100. */
export function isValidGp(gp: number): boolean {
  return typeof gp === 'number' && Number.isFinite(gp) && gp > 0 && gp < 100
}

export function isValidPositiveMl(ml: number): boolean {
  return typeof ml === 'number' && Number.isFinite(ml) && ml > 0
}

export function isValidNonNegativeCost(cost: number): boolean {
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
}

export function validatePricingPolicy(policy: PricingPolicy): PricingError | null {
  if (!Number.isFinite(policy.vatRate) || policy.vatRate < 0) {
    return { code: 'INVALID_POLICY', message: 'VAT rate must be a non-negative finite number.' }
  }
  if (
    !Number.isFinite(policy.btgBottleDiscount) ||
    policy.btgBottleDiscount < 0 ||
    policy.btgBottleDiscount >= 1
  ) {
    return {
      code: 'INVALID_POLICY',
      message: 'BTG bottle discount must be a finite fraction in [0, 1).',
    }
  }
  if (!(policy.bottleRoundingIncrement > 0) || !Number.isFinite(policy.bottleRoundingIncrement)) {
    return {
      code: 'INVALID_POLICY',
      message: 'Bottle rounding increment must be a positive finite number.',
    }
  }
  if (!(policy.pourRoundingIncrement > 0) || !Number.isFinite(policy.pourRoundingIncrement)) {
    return {
      code: 'INVALID_POLICY',
      message: 'Pour rounding increment must be a positive finite number.',
    }
  }
  return null
}

function ruleGpValues(rule: Rule): number[] {
  switch (rule.type) {
    case 'all_gp':
    case 'less_than':
    case 'greater_than':
      return [rule.gp]
    case 'between':
      return [rule.start_gp, rule.end_gp]
  }
}

/** Whether a band rule covers a reference cost under shared-boundary semantics. */
export function ruleCoversCost(rule: Rule, cost: number): boolean {
  switch (rule.type) {
    case 'all_gp':
      return true
    case 'less_than':
      return cost < rule.max
    case 'greater_than':
      return cost > rule.min
    case 'between':
      return cost >= rule.min && cost <= rule.max
  }
}

/** GP implied by a covering rule at a given cost (caller must ensure coverage). */
export function gpFromCoveringRule(rule: Rule, cost: number): number {
  switch (rule.type) {
    case 'all_gp':
    case 'less_than':
    case 'greater_than':
      return rule.gp
    case 'between': {
      const span = rule.max - rule.min
      const proportion = (cost - rule.min) / span
      return rule.start_gp - proportion * (rule.start_gp - rule.end_gp)
    }
  }
}

function openIntervalOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return Math.min(aEnd, bEnd) > Math.max(aStart, bStart)
}

function bandOpenInterval(
  rule: LessThanRule | BetweenRule | GreaterThanRule
): { start: number; end: number } {
  if (rule.type === 'less_than') {
    return { start: Number.NEGATIVE_INFINITY, end: rule.max }
  }
  if (rule.type === 'greater_than') {
    return { start: rule.min, end: Number.POSITIVE_INFINITY }
  }
  // Between is closed; treat open conflict as interior (min, max).
  return { start: rule.min, end: rule.max }
}

/**
 * Structural validation required for safe calculation.
 * Gaps are allowed here and fail at resolve time; ambiguous overlaps are rejected.
 */
export function validateRuleSetForPricing(rules: Rule[]): PricingError | null {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { code: 'EMPTY_RULES', message: 'At least one pricing rule is required.' }
  }

  for (const rule of rules) {
    for (const gp of ruleGpValues(rule)) {
      if (!isValidGp(gp)) {
        return {
          code: 'INVALID_RULE_SET',
          message: 'All rule GP values must satisfy 0 < GP < 100.',
        }
      }
    }

    if (rule.type === 'between' && !(rule.min < rule.max)) {
      return {
        code: 'INVALID_RULE_SET',
        message: 'Between rules require min < max.',
      }
    }

    if (rule.type === 'less_than' && !(Number.isFinite(rule.max) && rule.max >= 0)) {
      return {
        code: 'INVALID_RULE_SET',
        message: 'Less-than rules require a finite non-negative max.',
      }
    }

    if (rule.type === 'greater_than' && !(Number.isFinite(rule.min) && rule.min >= 0)) {
      return {
        code: 'INVALID_RULE_SET',
        message: 'Greater-than rules require a finite non-negative min.',
      }
    }
  }

  const allGpRules = rules.filter((r): r is AllGpRule => r.type === 'all_gp')
  if (allGpRules.length > 1) {
    return {
      code: 'INVALID_RULE_SET',
      message: 'At most one universal GP rule is allowed.',
    }
  }

  if (allGpRules.length === 1) {
    return null
  }

  const bandRules = rules.filter(
    (r): r is LessThanRule | BetweenRule | GreaterThanRule => r.type !== 'all_gp'
  )

  for (let i = 0; i < bandRules.length; i++) {
    for (let j = i + 1; j < bandRules.length; j++) {
      const a = bandRules[i]
      const b = bandRules[j]
      const A = bandOpenInterval(a)
      const B = bandOpenInterval(b)

      // Interior open-interval overlap is always ambiguous ownership.
      if (openIntervalOverlap(A.start, A.end, B.start, B.end)) {
        // Exclusive less_than / greater_than touching midpoints handled by openIntervalOverlap.
        // Between interiors overlapping anything → conflict.
        return {
          code: 'INVALID_RULE_SET',
          message: 'Pricing rules have ambiguous overlapping cost ranges.',
        }
      }

      // Shared single boundary point: both closed betweens touching at an edge is OK
      // (same point owned by both closed ends) only if GP agrees; otherwise reject.
      if (a.type === 'between' && b.type === 'between') {
        const shared =
          a.max === b.min || a.min === b.max ? (a.max === b.min ? a.max : a.min) : null
        if (shared !== null) {
          const ga = gpFromCoveringRule(a, shared)
          const gb = gpFromCoveringRule(b, shared)
          if (Math.abs(ga - gb) > 1e-9) {
            return {
              code: 'INVALID_RULE_SET',
              message: 'Pricing rules overlap with conflicting GP values at a shared boundary.',
            }
          }
        }
      }
    }
  }

  return null
}
