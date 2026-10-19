import type { PricingPolicy } from './types'

/** Stage-2 defaults matching current commercial calculator behaviour. */
export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  vatRate: 0.2,
  btgBottleDiscount: 0.05,
  bottleRoundingIncrement: 1,
  pourRoundingIncrement: 0.5,
}

/** Canonical bottle volume for pricing-rule cost boundaries. */
export const RULE_REFERENCE_BOTTLE_ML = 750
