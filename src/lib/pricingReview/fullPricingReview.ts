/**
 * Pure Full Pricing Review domain (Stage 6C).
 * Evaluates the latest completed import under a captured Current Pricing snapshot.
 */

import {
  gpFromCostAndSellingPrice,
  priceSale,
  type PricingPolicy,
} from '@/lib/pricing'
import type { Rule } from '@/types/rules'
import type { PricingReviewSystemStatus } from '@/types/pricingReviews'
import {
  classifyAttention,
  type PreviousReviewDecisionHint,
  type ReviewObservation,
} from '@/lib/pricingReview/costChangeReview'

const PRICE_EPSILON = 1e-6

export interface FullReviewCalculationInput {
  current: ReviewObservation
  rules: Rule[]
  pricingPolicy: PricingPolicy
  toleranceGpPoints: number
  previousDecisions?: PreviousReviewDecisionHint[]
}

export interface FullReviewCalculatedItem {
  pricingItemId: string
  externalPlu: string
  description: string | null
  bottleSizeMl: number
  currentCostExVat: number
  currentSellingPriceIncVat: number
  currentGp: number
  targetGp: number
  currentGpVsTargetPoints: number
  recommendedPriceIncVat: number
  systemStatus: PricingReviewSystemStatus
  previousChangePricePending: boolean
  previousProposedPriceIncVat: number | null
  previousDelistPending: boolean
}

function isFullBottleEligible(obs: ReviewObservation): boolean {
  return (
    obs.itemType === 'full_bottle' &&
    obs.includedForPricing &&
    obs.costExVat != null &&
    Number.isFinite(obs.costExVat) &&
    obs.sellingPriceIncVat != null &&
    Number.isFinite(obs.sellingPriceIncVat) &&
    obs.sellingPriceIncVat > 0 &&
    obs.packageVolumeMl != null &&
    Number.isFinite(obs.packageVolumeMl) &&
    obs.packageVolumeMl > 0
  )
}

function pricesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_EPSILON
}

/** Select eligible full-bottle observations for a Full Pricing Review. */
export function selectFullReviewObservations(
  observations: ReviewObservation[]
): ReviewObservation[] {
  return observations.filter(isFullBottleEligible)
}

export function selectLatestCompletedImport<T extends { id: string; importedAt: string }>(
  completedImportsNewestFirst: T[]
): T | null {
  if (completedImportsNewestFirst.length === 0) return null
  return completedImportsNewestFirst[0]
}

/**
 * Build calculated Full Pricing Review fields for one eligible bottle.
 */
export function calculateFullReviewItem(
  input: FullReviewCalculationInput
): FullReviewCalculatedItem | { ok: false; error: string } {
  const { current, rules, pricingPolicy, toleranceGpPoints, previousDecisions } = input

  if (!isFullBottleEligible(current)) {
    return { ok: false, error: 'Observation is not an eligible full-bottle pricing row.' }
  }

  const currentCost = current.costExVat as number
  const currentPrice = current.sellingPriceIncVat as number
  const bottleSizeMl = current.packageVolumeMl as number

  const currentGp = gpFromCostAndSellingPrice(currentCost, currentPrice, pricingPolicy.vatRate)
  if (currentGp == null) {
    return { ok: false, error: 'Unable to calculate GP from cost and current selling price.' }
  }

  const priced = priceSale({
    actualCostExVat: currentCost,
    bottleSizeMl,
    rules,
    pricingPolicy,
    saleContext: { kind: 'bottle', applyBtgDiscount: false },
  })

  if (!priced.ok) {
    return { ok: false, error: priced.error.message }
  }

  const targetGp = priced.targetGp
  const recommendedPriceIncVat = priced.roundedSalePrice
  const systemStatus = classifyAttention(currentGp, targetGp, toleranceGpPoints)

  let previousChangePricePending = false
  let previousProposedPriceIncVat: number | null = null
  let previousDelistPending = false

  const hints = (previousDecisions ?? []).filter((d) => d.pricingItemId === current.pricingItemId)
  for (const hint of hints) {
    if (hint.decision === 'change_price' && hint.proposedPriceIncVat != null) {
      if (!pricesEqual(hint.proposedPriceIncVat, currentPrice)) {
        previousChangePricePending = true
        previousProposedPriceIncVat = hint.proposedPriceIncVat
      }
    }
    if (hint.decision === 'delist') {
      previousDelistPending = true
    }
  }

  return {
    pricingItemId: current.pricingItemId,
    externalPlu: current.externalPlu,
    description: current.description,
    bottleSizeMl,
    currentCostExVat: currentCost,
    currentSellingPriceIncVat: currentPrice,
    currentGp,
    targetGp,
    currentGpVsTargetPoints: currentGp - targetGp,
    recommendedPriceIncVat,
    systemStatus,
    previousChangePricePending,
    previousProposedPriceIncVat,
    previousDelistPending,
  }
}
