import type { Rule } from '@/types/rules'

/** Commercial calculation parameters distinct from GP cost-band rules. */
export interface PricingPolicy {
  /** VAT as a decimal fraction, e.g. 0.2 for 20%. */
  vatRate: number
  /** Discount applied only to the displayed full-bottle price when BTG, e.g. 0.05 for 5%. */
  btgBottleDiscount: number
  /** Commercial round increment for bottle prices, e.g. 1 for £1. */
  bottleRoundingIncrement: number
  /** Commercial round increment for pour prices, e.g. 0.5 for £0.50. */
  pourRoundingIncrement: number
}

export type SaleContext =
  | { kind: 'bottle'; applyBtgDiscount: boolean }
  | { kind: 'pour'; pourMl: number }

export type PricingErrorCode =
  | 'INVALID_COST'
  | 'INVALID_BOTTLE_SIZE'
  | 'INVALID_GP'
  | 'INVALID_POUR_VOLUME'
  | 'INVALID_POLICY'
  | 'EMPTY_RULES'
  | 'INVALID_RULE_SET'
  | 'NO_MATCHING_RULE'
  | 'AMBIGUOUS_RULE_MATCH'

export interface PricingError {
  code: PricingErrorCode
  message: string
}

export interface ResolveGpSuccess {
  ok: true
  referenceCost750ml: number
  targetGp: number
  matchedRule: Rule
}

export interface ResolveGpFailure {
  ok: false
  error: PricingError
  referenceCost750ml?: number
}

export type ResolveGpResult = ResolveGpSuccess | ResolveGpFailure

export interface PriceSaleSuccess {
  ok: true
  referenceCost750ml: number
  targetGp: number
  matchedRule: Rule | null
  rawBottlePrice: number
  rawSalePrice: number
  roundedSalePrice: number
  btgDiscountApplied: boolean
}

export interface PriceSaleFailure {
  ok: false
  error: PricingError
  referenceCost750ml?: number
}

export type PriceSaleResult = PriceSaleSuccess | PriceSaleFailure

export interface ResolveGpInput {
  actualCostExVat: number
  bottleSizeMl: number
  rules: Rule[]
}

export interface PriceSaleInput {
  actualCostExVat: number
  bottleSizeMl: number
  pricingPolicy: PricingPolicy
  saleContext: SaleContext
  /** When set, skip rule resolution and price with this GP. */
  gpOverride?: number
  rules?: Rule[]
}
