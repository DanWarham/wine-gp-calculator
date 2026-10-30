/**
 * Pure Cost Change Review domain (Stage 6B).
 * Calculates cost/GP impact using Current Pricing; no new pricing maths.
 */

import {
  gpFromCostAndSellingPrice,
  priceSale,
  type PricingPolicy,
} from '@/lib/pricing'
import type { Rule } from '@/types/rules'
import type {
  PricingReviewDecision,
  PricingReviewPresenceItem,
  PricingReviewPresenceSummary,
  PricingReviewSystemStatus,
} from '@/types/pricingReviews'

export interface ReviewObservation {
  pricingItemId: string
  externalPlu: string
  description: string | null
  costExVat: number | null
  sellingPriceIncVat: number | null
  packageVolumeMl: number | null
  itemType: 'full_bottle' | 'partial_serve' | null
  includedForPricing: boolean
}

export interface PreviousReviewDecisionHint {
  pricingItemId: string
  decision: PricingReviewDecision
  proposedPriceIncVat: number | null
}

export interface CostChangeCalculationInput {
  previous: ReviewObservation
  current: ReviewObservation
  rules: Rule[]
  pricingPolicy: PricingPolicy
  toleranceGpPoints: number
  previousDecisions?: PreviousReviewDecisionHint[]
}

export interface CostChangeCalculatedItem {
  pricingItemId: string
  externalPlu: string
  description: string | null
  bottleSizeMl: number
  previousCostExVat: number
  currentCostExVat: number
  costChangeAbsolute: number
  costChangePercent: number | null
  currentSellingPriceIncVat: number
  oldGp: number
  currentGp: number
  gpChangePoints: number
  targetGp: number
  currentGpVsTargetPoints: number
  recommendedPriceIncVat: number
  systemStatus: PricingReviewSystemStatus
  previousChangePricePending: boolean
  previousProposedPriceIncVat: number | null
  previousDelistPending: boolean
}

export interface CostChangeDetectionResult {
  changed: Array<{ previous: ReviewObservation; current: ReviewObservation }>
  presence: PricingReviewPresenceSummary
}

const COST_EPSILON = 1e-9
const PRICE_EPSILON = 1e-6

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

function costsDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > COST_EPSILON
}

function pricesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_EPSILON
}

function toPresenceItem(obs: ReviewObservation): PricingReviewPresenceItem {
  return {
    pricingItemId: obs.pricingItemId,
    externalPlu: obs.externalPlu,
    description: obs.description,
    costExVat: obs.costExVat,
    sellingPriceIncVat: obs.sellingPriceIncVat,
  }
}

/**
 * Detect cost-changed full bottles and separately report new / missing items.
 * Matching is by persistent pricing_item_id.
 */
export function detectCostChanges(
  previousObservations: ReviewObservation[],
  currentObservations: ReviewObservation[]
): CostChangeDetectionResult {
  const previousByItem = new Map(previousObservations.map((o) => [o.pricingItemId, o]))
  const currentByItem = new Map(currentObservations.map((o) => [o.pricingItemId, o]))

  const changed: CostChangeDetectionResult['changed'] = []
  const newItems: PricingReviewPresenceItem[] = []
  const missingItems: PricingReviewPresenceItem[] = []

  for (const current of currentObservations) {
    const previous = previousByItem.get(current.pricingItemId)
    if (!previous) {
      if (current.itemType === 'full_bottle') {
        newItems.push(toPresenceItem(current))
      }
      continue
    }

    if (!isFullBottleEligible(previous) || !isFullBottleEligible(current)) {
      continue
    }

    if (
      previous.costExVat != null &&
      current.costExVat != null &&
      costsDiffer(previous.costExVat, current.costExVat)
    ) {
      changed.push({ previous, current })
    }
  }

  for (const previous of previousObservations) {
    if (!currentByItem.has(previous.pricingItemId) && previous.itemType === 'full_bottle') {
      missingItems.push(toPresenceItem(previous))
    }
  }

  newItems.sort((a, b) => a.externalPlu.localeCompare(b.externalPlu))
  missingItems.sort((a, b) => a.externalPlu.localeCompare(b.externalPlu))

  return {
    changed,
    presence: { newItems, missingItems },
  }
}

export function classifyAttention(
  currentGp: number,
  targetGp: number,
  toleranceGpPoints: number
): PricingReviewSystemStatus {
  if (currentGp < targetGp - toleranceGpPoints) {
    return 'requires_attention'
  }
  return 'no_action_required'
}

export function resultingGpForProposedPrice(
  currentCostExVat: number,
  proposedPriceIncVat: number,
  vatRate: number
): number | null {
  return gpFromCostAndSellingPrice(currentCostExVat, proposedPriceIncVat, vatRate)
}

/**
 * Build calculated Cost Change Review fields for one matched pair.
 */
export function calculateCostChangeItem(
  input: CostChangeCalculationInput
): CostChangeCalculatedItem | { ok: false; error: string } {
  const { previous, current, rules, pricingPolicy, toleranceGpPoints, previousDecisions } = input

  if (!isFullBottleEligible(previous) || !isFullBottleEligible(current)) {
    return { ok: false, error: 'Observations are not eligible full-bottle pricing rows.' }
  }

  const previousCost = previous.costExVat as number
  const currentCost = current.costExVat as number
  const currentPrice = current.sellingPriceIncVat as number
  const bottleSizeMl = current.packageVolumeMl as number

  if (!costsDiffer(previousCost, currentCost)) {
    return { ok: false, error: 'Cost has not changed.' }
  }

  const oldGp = gpFromCostAndSellingPrice(previousCost, currentPrice, pricingPolicy.vatRate)
  const currentGp = gpFromCostAndSellingPrice(currentCost, currentPrice, pricingPolicy.vatRate)
  if (oldGp == null || currentGp == null) {
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

  const costChangeAbsolute = currentCost - previousCost
  const costChangePercent =
    Math.abs(previousCost) > COST_EPSILON ? (costChangeAbsolute / previousCost) * 100 : null

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
      // Still present in the latest FnbShop-led dataset → delist pending.
      previousDelistPending = true
    }
  }

  return {
    pricingItemId: current.pricingItemId,
    externalPlu: current.externalPlu,
    description: current.description ?? previous.description,
    bottleSizeMl,
    previousCostExVat: previousCost,
    currentCostExVat: currentCost,
    costChangeAbsolute,
    costChangePercent,
    currentSellingPriceIncVat: currentPrice,
    oldGp,
    currentGp,
    gpChangePoints: currentGp - oldGp,
    targetGp,
    currentGpVsTargetPoints: currentGp - targetGp,
    recommendedPriceIncVat,
    systemStatus,
    previousChangePricePending,
    previousProposedPriceIncVat,
    previousDelistPending,
  }
}

export function reclassifyItemStatus(
  currentGp: number,
  targetGp: number,
  toleranceGpPoints: number
): PricingReviewSystemStatus {
  return classifyAttention(currentGp, targetGp, toleranceGpPoints)
}

export function canCompleteReview(
  items: Array<{ systemStatus: PricingReviewSystemStatus; decision: PricingReviewDecision | null }>
): boolean {
  return items.every(
    (item) => item.systemStatus !== 'requires_attention' || item.decision != null
  )
}

export function sortReviewItemsByPlu<T extends { externalPlu: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.externalPlu.localeCompare(b.externalPlu, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

/**
 * Cost Change pair: latest import overall, previous = latest import from the
 * previous available data month (not merely previous upload timestamp).
 */
export function selectLatestAndPreviousImports<
  T extends { id: string; importedAt: string; dataMonth: string },
>(completedImports: T[]): { latest: T; previous: T } | null {
  if (completedImports.length === 0) return null

  const sorted = [...completedImports].sort((a, b) => {
    const monthCmp = b.dataMonth.localeCompare(a.dataMonth)
    if (monthCmp !== 0) return monthCmp
    return b.importedAt.localeCompare(a.importedAt)
  })

  const latest = sorted[0]
  const previous = sorted.find((row) => row.dataMonth < latest.dataMonth)
  if (!previous) return null
  return { latest, previous }
}
