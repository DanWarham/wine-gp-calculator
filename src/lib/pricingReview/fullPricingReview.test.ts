import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_POLICY,
  gpFromCostAndSellingPrice,
  priceSale,
} from '@/lib/pricing'
import { TEST_USER_GP_RULES } from '@/lib/testSupport/testGpRules'
import { canCompleteReview, type ReviewObservation } from './costChangeReview'
import {
  calculateFullReviewItem,
  selectFullReviewObservations,
  selectLatestCompletedImport,
} from './fullPricingReview'
import { resultingGpForProposedPrice } from './costChangeReview'
import { sortReviewItemsByPlu } from './costChangeReview'

function obs(
  partial: Partial<ReviewObservation> & Pick<ReviewObservation, 'pricingItemId' | 'externalPlu'>
): ReviewObservation {
  return {
    description: partial.description ?? `Wine ${partial.externalPlu}`,
    costExVat: partial.costExVat ?? 23,
    sellingPriceIncVat: partial.sellingPriceIncVat ?? 69,
    packageVolumeMl: partial.packageVolumeMl ?? 750,
    itemType: partial.itemType ?? 'full_bottle',
    includedForPricing: partial.includedForPricing ?? true,
    ...partial,
  }
}

describe('selectLatestCompletedImport', () => {
  it('selects the newest completed import', () => {
    expect(
      selectLatestCompletedImport([
        { id: 'b', importedAt: '2026-10-02T00:00:00Z' },
        { id: 'a', importedAt: '2026-10-01T00:00:00Z' },
      ])
    ).toEqual({ id: 'b', importedAt: '2026-10-02T00:00:00Z' })
  })

  it('returns null when no imports exist', () => {
    expect(selectLatestCompletedImport([])).toBeNull()
  })
})

describe('selectFullReviewObservations', () => {
  it('includes eligible full bottles only', () => {
    const selected = selectFullReviewObservations([
      obs({ pricingItemId: 'ok', externalPlu: '5000001' }),
      obs({
        pricingItemId: 'partial',
        externalPlu: '5000002',
        itemType: 'partial_serve',
      }),
      obs({
        pricingItemId: 'excluded',
        externalPlu: '5000003',
        includedForPricing: false,
      }),
      obs({
        pricingItemId: 'no-price',
        externalPlu: '5000004',
        sellingPriceIncVat: null,
      }),
    ])
    expect(selected.map((o) => o.externalPlu)).toEqual(['5000001'])
  })

  it('retains every eligible bottle for datasets larger than 1000 rows', () => {
    const observations = Array.from({ length: 1105 }, (_, i) =>
      obs({
        pricingItemId: `item-${i}`,
        externalPlu: String(5000000 + i),
        includedForPricing: i !== 3,
        itemType: i === 4 ? 'partial_serve' : 'full_bottle',
      })
    )
    const selected = selectFullReviewObservations(observations)
    // 1105 − 1 excluded − 1 partial = 1103
    expect(selected).toHaveLength(1103)
    expect(selected.some((o) => o.externalPlu === '5000003')).toBe(false)
    expect(selected.some((o) => o.externalPlu === '5000004')).toBe(false)
  })
})

describe('Full Review calculations', () => {
  const rules = TEST_USER_GP_RULES
  const policy = DEFAULT_PRICING_POLICY

  it('calculates current GP, target GP, and recommended price from current observation', () => {
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 69,
      packageVolumeMl: 750,
    })
    const item = calculateFullReviewItem({
      current,
      rules,
      pricingPolicy: policy,
      toleranceGpPoints: 1,
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return

    const expectedGp = gpFromCostAndSellingPrice(23, 69, policy.vatRate)
    expect(item.currentGp).toBeCloseTo(expectedGp as number, 10)

    const priced = priceSale({
      actualCostExVat: 23,
      bottleSizeMl: 750,
      rules,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(priced.ok).toBe(true)
    if (!priced.ok) return
    expect(item.targetGp).toBeCloseTo(priced.targetGp, 10)
    expect(item.recommendedPriceIncVat).toBe(priced.roundedSalePrice)
    expect(item.currentGpVsTargetPoints).toBeCloseTo(item.currentGp - item.targetGp, 10)
  })

  it('marks Requires Attention when current GP is below target minus tolerance', () => {
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 69,
    })
    const tight = calculateFullReviewItem({
      current,
      rules,
      pricingPolicy: policy,
      toleranceGpPoints: 0,
    })
    const loose = calculateFullReviewItem({
      current,
      rules,
      pricingPolicy: policy,
      toleranceGpPoints: 50,
    })
    expect('ok' in tight && tight.ok === false).toBe(false)
    expect('ok' in loose && loose.ok === false).toBe(false)
    if ('ok' in tight || 'ok' in loose) return

    expect(loose.systemStatus).toBe('no_action_required')
    if (tight.currentGp < tight.targetGp) {
      expect(tight.systemStatus).toBe('requires_attention')
    }
  })

  it('computes proposed-price GP from current cost + proposed selling price', () => {
    const gp = resultingGpForProposedPrice(23, 72, 0.2)
    const expected = gpFromCostAndSellingPrice(23, 72, 0.2)
    expect(gp).toBeCloseTo(expected as number, 10)
  })
})

describe('previous unresolved decisions across review types', () => {
  it('flags previous Change Price from any completed review type when Micros has not caught up', () => {
    const item = calculateFullReviewItem({
      current: obs({
        pricingItemId: 'i1',
        externalPlu: '5000001',
        sellingPriceIncVat: 69,
      }),
      rules: TEST_USER_GP_RULES,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      toleranceGpPoints: 1,
      previousDecisions: [
        { pricingItemId: 'i1', decision: 'change_price', proposedPriceIncVat: 72 },
      ],
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return
    expect(item.previousChangePricePending).toBe(true)
    expect(item.previousProposedPriceIncVat).toBe(72)
  })

  it('flags previous De-list while the PLU remains in the latest dataset', () => {
    const item = calculateFullReviewItem({
      current: obs({ pricingItemId: 'i1', externalPlu: '5000001' }),
      rules: TEST_USER_GP_RULES,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      toleranceGpPoints: 1,
      previousDecisions: [{ pricingItemId: 'i1', decision: 'delist', proposedPriceIncVat: null }],
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return
    expect(item.previousDelistPending).toBe(true)
  })
})

describe('completion / sorting', () => {
  it('uses the same completion rules as Cost Change Review', () => {
    expect(
      canCompleteReview([
        { systemStatus: 'requires_attention', decision: null },
        { systemStatus: 'no_action_required', decision: null },
      ])
    ).toBe(false)
    expect(
      canCompleteReview([
        { systemStatus: 'requires_attention', decision: 'change_price' },
        { systemStatus: 'no_action_required', decision: null },
      ])
    ).toBe(true)
  })

  it('sorts Full Review rows by PLU ascending', () => {
    const sorted = sortReviewItemsByPlu([
      { externalPlu: '5000010' },
      { externalPlu: '5000002' },
      { externalPlu: '5000001' },
    ])
    expect(sorted.map((r) => r.externalPlu)).toEqual(['5000001', '5000002', '5000010'])
  })
})
