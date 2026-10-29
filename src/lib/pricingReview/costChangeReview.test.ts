import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_POLICY,
  gpFromCostAndSellingPrice,
  priceSale,
  rawBottleSellingPrice,
} from '@/lib/pricing'
import { TEST_USER_GP_RULES } from '@/lib/testSupport/testGpRules'
import {
  calculateCostChangeItem,
  canCompleteReview,
  classifyAttention,
  detectCostChanges,
  resultingGpForProposedPrice,
  selectLatestAndPreviousImports,
  sortReviewItemsByPlu,
  type ReviewObservation,
} from './costChangeReview'

function obs(partial: Partial<ReviewObservation> & Pick<ReviewObservation, 'pricingItemId' | 'externalPlu'>): ReviewObservation {
  return {
    description: partial.description ?? `Wine ${partial.externalPlu}`,
    costExVat: partial.costExVat ?? 21,
    sellingPriceIncVat: partial.sellingPriceIncVat ?? 69,
    packageVolumeMl: partial.packageVolumeMl ?? 750,
    itemType: partial.itemType ?? 'full_bottle',
    includedForPricing: partial.includedForPricing ?? true,
    ...partial,
  }
}

describe('selectLatestAndPreviousImports', () => {
  it('selects newest as latest and next as previous', () => {
    const pair = selectLatestAndPreviousImports([
      { id: 'b', importedAt: '2026-10-02T00:00:00Z' },
      { id: 'a', importedAt: '2026-10-01T00:00:00Z' },
    ])
    expect(pair).toEqual({
      latest: { id: 'b', importedAt: '2026-10-02T00:00:00Z' },
      previous: { id: 'a', importedAt: '2026-10-01T00:00:00Z' },
    })
  })

  it('returns null when fewer than two imports exist', () => {
    expect(selectLatestAndPreviousImports([])).toBeNull()
    expect(
      selectLatestAndPreviousImports([{ id: 'a', importedAt: '2026-10-01T00:00:00Z' }])
    ).toBeNull()
  })
})

describe('detectCostChanges', () => {
  it('includes full bottles with changed cost that are valid for pricing', () => {
    const previous = [obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })]
    const current = [obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 23 })]
    const result = detectCostChanges(previous, current)
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0].previous.costExVat).toBe(21)
    expect(result.changed[0].current.costExVat).toBe(23)
  })

  it('excludes unchanged costs', () => {
    const previous = [obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })]
    const current = [obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })]
    expect(detectCostChanges(previous, current).changed).toHaveLength(0)
  })

  it('uses full bottles only', () => {
    const previous = [
      obs({
        pricingItemId: 'i1',
        externalPlu: '5000002',
        costExVat: 10,
        itemType: 'partial_serve',
        packageVolumeMl: 750,
      }),
    ]
    const current = [
      obs({
        pricingItemId: 'i1',
        externalPlu: '5000002',
        costExVat: 12,
        itemType: 'partial_serve',
        packageVolumeMl: 750,
      }),
    ]
    expect(detectCostChanges(previous, current).changed).toHaveLength(0)
  })

  it('excludes items not included for pricing', () => {
    const previous = [
      obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21, includedForPricing: false }),
    ]
    const current = [
      obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 23, includedForPricing: false }),
    ]
    expect(detectCostChanges(previous, current).changed).toHaveLength(0)
  })

  it('reports new and missing items separately', () => {
    const previous = [
      obs({ pricingItemId: 'gone', externalPlu: '5000009', costExVat: 20 }),
      obs({ pricingItemId: 'keep', externalPlu: '5000001', costExVat: 21 }),
    ]
    const current = [
      obs({ pricingItemId: 'keep', externalPlu: '5000001', costExVat: 21 }),
      obs({ pricingItemId: 'new', externalPlu: '5000008', costExVat: 22 }),
    ]
    const result = detectCostChanges(previous, current)
    expect(result.changed).toHaveLength(0)
    expect(result.presence.newItems.map((i) => i.externalPlu)).toEqual(['5000008'])
    expect(result.presence.missingItems.map((i) => i.externalPlu)).toEqual(['5000009'])
  })
})

describe('GP / recommended price semantics', () => {
  const rules = TEST_USER_GP_RULES
  const policy = DEFAULT_PRICING_POLICY

  it('old GP uses previous cost + CURRENT Micros selling price', () => {
    const previous = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 21.5,
      sellingPriceIncVat: 60,
    })
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 69,
    })

    const item = calculateCostChangeItem({
      previous,
      current,
      rules,
      pricingPolicy: policy,
      toleranceGpPoints: 1,
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return

    const expectedOld = gpFromCostAndSellingPrice(21.5, 69, policy.vatRate)
    const expectedCurrent = gpFromCostAndSellingPrice(23, 69, policy.vatRate)
    expect(item.oldGp).toBeCloseTo(expectedOld as number, 10)
    expect(item.currentGp).toBeCloseTo(expectedCurrent as number, 10)
    // Must ignore the previous import's selling price for Old GP.
    const wrongOld = gpFromCostAndSellingPrice(21.5, 60, policy.vatRate)
    expect(item.oldGp).not.toBeCloseTo(wrongOld as number, 5)
  })

  it('recommended price uses captured config + current cost/bottle size', () => {
    const previous = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      packageVolumeMl: 750,
      sellingPriceIncVat: 69,
    })
    const item = calculateCostChangeItem({
      previous,
      current,
      rules,
      pricingPolicy: policy,
      toleranceGpPoints: 1,
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return

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
  })

  it('proposed-price GP uses current cost + proposed selling price', () => {
    const gp = resultingGpForProposedPrice(23, 70, 0.2)
    const expected = gpFromCostAndSellingPrice(23, 70, 0.2)
    expect(gp).toBeCloseTo(expected as number, 10)
    // Sanity against inverse of raw bottle formula
    const reconstituted = rawBottleSellingPrice(23, gp as number, 0.2)
    expect(reconstituted).toBeCloseTo(70, 8)
  })
})

describe('tolerance / attention', () => {
  it('requires attention strictly below target minus tolerance', () => {
    expect(classifyAttention(62, 64, 1)).toBe('requires_attention') // −2.0 < −1
    expect(classifyAttention(63, 64, 1)).toBe('no_action_required') // −1.0 boundary
    expect(classifyAttention(63.1, 64, 1)).toBe('no_action_required')
    expect(classifyAttention(64, 64, 1)).toBe('no_action_required')
    expect(classifyAttention(65, 64, 1)).toBe('no_action_required')
  })

  it('applies tolerance on calculated items', () => {
    // Craft numbers so current GP is known relative to target.
    // cost 23, price chosen so GP is just under / at boundary.
    const previous = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 20 })
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 69,
    })

    const tight = calculateCostChangeItem({
      previous,
      current,
      rules: TEST_USER_GP_RULES,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      toleranceGpPoints: 0,
    })
    const loose = calculateCostChangeItem({
      previous,
      current,
      rules: TEST_USER_GP_RULES,
      pricingPolicy: DEFAULT_PRICING_POLICY,
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
})

describe('previous unresolved actions', () => {
  it('flags previous Change Price when Micros price has not caught up', () => {
    const previous = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 69,
    })
    const item = calculateCostChangeItem({
      previous,
      current,
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

  it('does not flag Change Price when Micros already reflects the proposed price', () => {
    const previous = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })
    const current = obs({
      pricingItemId: 'i1',
      externalPlu: '5000001',
      costExVat: 23,
      sellingPriceIncVat: 72,
    })
    const item = calculateCostChangeItem({
      previous,
      current,
      rules: TEST_USER_GP_RULES,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      toleranceGpPoints: 1,
      previousDecisions: [
        { pricingItemId: 'i1', decision: 'change_price', proposedPriceIncVat: 72 },
      ],
    })
    expect('ok' in item && item.ok === false).toBe(false)
    if ('ok' in item) return
    expect(item.previousChangePricePending).toBe(false)
  })

  it('flags previous De-list while the PLU remains in the latest dataset', () => {
    const previous = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 21 })
    const current = obs({ pricingItemId: 'i1', externalPlu: '5000001', costExVat: 23 })
    const item = calculateCostChangeItem({
      previous,
      current,
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

describe('completion requirements', () => {
  it('blocks completion while Requires Attention rows lack decisions', () => {
    expect(
      canCompleteReview([
        { systemStatus: 'requires_attention', decision: null },
        { systemStatus: 'no_action_required', decision: null },
      ])
    ).toBe(false)
  })

  it('allows completion when attention rows are decided and auto rows are untouched', () => {
    expect(
      canCompleteReview([
        { systemStatus: 'requires_attention', decision: 'change_price' },
        { systemStatus: 'requires_attention', decision: 'delist' },
        { systemStatus: 'requires_attention', decision: 'no_action' },
        { systemStatus: 'no_action_required', decision: null },
      ])
    ).toBe(true)
  })
})

describe('sorting / user isolation helpers', () => {
  it('sorts by PLU ascending', () => {
    const sorted = sortReviewItemsByPlu([
      { externalPlu: '5000010' },
      { externalPlu: '5000002' },
      { externalPlu: '5000001' },
    ])
    expect(sorted.map((r) => r.externalPlu)).toEqual(['5000001', '5000002', '5000010'])
  })
})
