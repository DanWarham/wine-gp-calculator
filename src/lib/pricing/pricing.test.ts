import { describe, expect, it } from 'vitest'
import type { Rule } from '@/types/rules'
import {
  DEFAULT_PRICING_POLICY,
  priceSale,
  priceWithGp,
  rawBottleSellingPrice,
  resolveTargetGp,
  roundToIncrement,
  toReferenceCost750ml,
  validateRuleSetForPricing,
} from './index'

const bandRules: Rule[] = [
  { type: 'less_than', max: 10, gp: 75 },
  { type: 'between', min: 10, max: 25, start_gp: 75, end_gp: 65 },
  { type: 'greater_than', min: 25, gp: 65 },
]

describe('rawBottleSellingPrice / formula', () => {
  it('computes known cost + GP + VAT raw bottle price', () => {
    // cost 10, GP 70, VAT 20% → (10 * 1.2) / (1 - 0.7) = 12 / 0.3 = 40
    expect(rawBottleSellingPrice(10, 70, 0.2)).toBeCloseTo(40, 10)
  })

  it('applies GP to actual cost after normalised rule lookup', () => {
    // Magnum £220 → reference £110 → all_gp 50% applied to £220
    const result = priceSale({
      actualCostExVat: 220,
      bottleSizeMl: 1500,
      rules: [{ type: 'all_gp', gp: 50 }],
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.referenceCost750ml).toBeCloseTo(110, 10)
    expect(result.targetGp).toBe(50)
    expect(result.rawBottlePrice).toBeCloseTo(rawBottleSellingPrice(220, 50, 0.2), 10)
  })
})

describe('universal GP', () => {
  it('resolves all_gp', () => {
    const result = resolveTargetGp({
      actualCostExVat: 40,
      bottleSizeMl: 750,
      rules: [{ type: 'all_gp', gp: 68 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targetGp).toBe(68)
    expect(result.matchedRule.type).toBe('all_gp')
  })
})

describe('interpolation precision', () => {
  it('retains full precision at min, mid, and max of a between band', () => {
    const atMin = resolveTargetGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    const atMid = resolveTargetGp({
      actualCostExVat: 17.5,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    const atMax = resolveTargetGp({
      actualCostExVat: 25,
      bottleSizeMl: 750,
      rules: bandRules,
    })

    expect(atMin.ok && atMin.targetGp).toBe(75)
    expect(atMax.ok && atMax.targetGp).toBe(65)
    expect(atMid.ok).toBe(true)
    if (!atMid.ok) return
    // Midpoint of 10–25 with 75→65 is exactly 70; ensure no premature integer rounding elsewhere
    expect(atMid.targetGp).toBeCloseTo(70, 10)

    const mid12 = resolveTargetGp({
      actualCostExVat: 12,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    expect(mid12.ok).toBe(true)
    if (!mid12.ok) return
    // proportion = 2/15 → gp = 75 - (2/15)*10 = 75 - 1.333... = 73.333...
    expect(mid12.targetGp).toBeCloseTo(75 - (2 / 15) * 10, 10)
    expect(Number.isInteger(mid12.targetGp)).toBe(false)
  })
})

describe('shared boundaries', () => {
  it('assigns less_than / between / greater_than thresholds without gap or double-claim conflict', () => {
    const justBelow = resolveTargetGp({
      actualCostExVat: 9.999,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    const atBetweenMin = resolveTargetGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    const atBetweenMax = resolveTargetGp({
      actualCostExVat: 25,
      bottleSizeMl: 750,
      rules: bandRules,
    })
    const justAbove = resolveTargetGp({
      actualCostExVat: 25.0001,
      bottleSizeMl: 750,
      rules: bandRules,
    })

    expect(justBelow.ok && justBelow.targetGp).toBe(75)
    expect(atBetweenMin.ok && atBetweenMin.targetGp).toBe(75)
    expect(atBetweenMax.ok && atBetweenMax.targetGp).toBe(65)
    expect(justAbove.ok && justAbove.targetGp).toBe(65)
  })
})

describe('rule gaps', () => {
  it('fails explicitly when reference cost is uncovered', () => {
    const gapped: Rule[] = [
      { type: 'less_than', max: 10, gp: 75 },
      { type: 'greater_than', min: 10, gp: 65 },
    ]
    const result = resolveTargetGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: gapped,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NO_MATCHING_RULE')
  })

  it('does not silently fall back to 70', () => {
    const result = resolveTargetGp({
      actualCostExVat: 50,
      bottleSizeMl: 750,
      rules: [{ type: 'less_than', max: 10, gp: 75 }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NO_MATCHING_RULE')
  })
})

describe('overlaps', () => {
  it('rejects overlapping bands with conflicting coverage', () => {
    const overlapping: Rule[] = [
      { type: 'between', min: 0, max: 20, start_gp: 70, end_gp: 60 },
      { type: 'between', min: 10, max: 30, start_gp: 65, end_gp: 55 },
    ]
    const error = validateRuleSetForPricing(overlapping)
    expect(error?.code).toBe('INVALID_RULE_SET')
  })
})

describe('degenerate ranges', () => {
  it('rejects min === max between rules', () => {
    const error = validateRuleSetForPricing([
      { type: 'between', min: 10, max: 10, start_gp: 70, end_gp: 60 },
    ])
    expect(error?.code).toBe('INVALID_RULE_SET')
  })

  it('rejects min > max between rules', () => {
    const error = validateRuleSetForPricing([
      { type: 'between', min: 20, max: 10, start_gp: 70, end_gp: 60 },
    ])
    expect(error?.code).toBe('INVALID_RULE_SET')
  })
})

describe('GP validity', () => {
  it('accepts ordinary and 99.9% GP', () => {
    expect(
      priceWithGp({
        actualCostExVat: 10,
        bottleSizeMl: 750,
        gp: 70,
        pricingPolicy: DEFAULT_PRICING_POLICY,
        saleContext: { kind: 'bottle', applyBtgDiscount: false },
      }).ok
    ).toBe(true)

    const high = priceWithGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      gp: 99.9,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(high.ok).toBe(true)
    if (!high.ok) return
    expect(Number.isFinite(high.rawBottlePrice)).toBe(true)
  })

  it('rejects 100%, above 100, zero, and negative', () => {
    for (const gp of [100, 100.1, 0, -1]) {
      const result = priceWithGp({
        actualCostExVat: 10,
        bottleSizeMl: 750,
        gp,
        pricingPolicy: DEFAULT_PRICING_POLICY,
        saleContext: { kind: 'bottle', applyBtgDiscount: false },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_GP')
    }
  })
})

describe('bottle-size normalisation', () => {
  it('resolves 375ml@£50, 750ml@£100, 1500ml@£200 against the same £100 reference', () => {
    const rules: Rule[] = [
      { type: 'less_than', max: 100, gp: 70 },
      { type: 'greater_than', min: 100, gp: 60 },
    ]

    const cases = [
      { cost: 50, ml: 375 },
      { cost: 100, ml: 750 },
      { cost: 200, ml: 1500 },
    ]

    for (const c of cases) {
      expect(toReferenceCost750ml(c.cost, c.ml)).toBeCloseTo(100, 10)
      // Exactly £100 reference is a gap between less_than(<100) and greater_than(>100)
      const atExact = resolveTargetGp({
        actualCostExVat: c.cost,
        bottleSizeMl: c.ml,
        rules,
      })
      expect(atExact.ok).toBe(false)
    }

    // Just below £100 reference → 70; just above → 60
    const halfBelow = resolveTargetGp({
      actualCostExVat: 49.5,
      bottleSizeMl: 375,
      rules,
    })
    const magAbove = resolveTargetGp({
      actualCostExVat: 201,
      bottleSizeMl: 1500,
      rules,
    })
    expect(halfBelow.ok && halfBelow.targetGp).toBe(70)
    expect(magAbove.ok && magAbove.targetGp).toBe(60)
  })

  it('supports a non-standard custom bottle size', () => {
    // 1000ml @ £80 → reference = 80 * 750/1000 = 60
    const result = resolveTargetGp({
      actualCostExVat: 80,
      bottleSizeMl: 1000,
      rules: bandRules,
    })
    expect(toReferenceCost750ml(80, 1000)).toBeCloseTo(60, 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targetGp).toBe(65) // greater_than min 25
  })
})

describe('BTG semantics', () => {
  it('applies BTG discount only to the bottle line; pours use undiscounted basis', () => {
    const cost = 10
    const gp = 70
    const bottle = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    const btgBottle = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: true },
    })
    const pour = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'pour', pourMl: 175 },
    })

    expect(bottle.ok && btgBottle.ok && pour.ok).toBe(true)
    if (!bottle.ok || !btgBottle.ok || !pour.ok) return

    expect(btgBottle.rawSalePrice).toBeCloseTo(bottle.rawBottlePrice * 0.95, 10)
    expect(btgBottle.btgDiscountApplied).toBe(true)
    expect(pour.btgDiscountApplied).toBe(false)
    expect(pour.rawSalePrice).toBeCloseTo((bottle.rawBottlePrice / 750) * 175, 10)
  })
})

describe('volume scaling', () => {
  it('scales pour prices for several ml sizes from the same bottle basis', () => {
    const gp = 65
    const cost = 20
    const base = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(base.ok).toBe(true)
    if (!base.ok) return

    for (const ml of [125, 175, 250, 500]) {
      const pour = priceWithGp({
        actualCostExVat: cost,
        bottleSizeMl: 750,
        gp,
        pricingPolicy: DEFAULT_PRICING_POLICY,
        saleContext: { kind: 'pour', pourMl: ml },
      })
      expect(pour.ok).toBe(true)
      if (!pour.ok) return
      expect(pour.rawSalePrice).toBeCloseTo((base.rawBottlePrice / 750) * ml, 10)
    }
  })
})

describe('rounding', () => {
  it('rounds to £1 increments', () => {
    expect(roundToIncrement(82.4, 1)).toBe(82)
    expect(roundToIncrement(82.5, 1)).toBe(83)
  })

  it('rounds to £0.50 increments', () => {
    expect(roundToIncrement(12.24, 0.5)).toBe(12)
    expect(roundToIncrement(12.25, 0.5)).toBe(12.5)
    expect(roundToIncrement(12.74, 0.5)).toBe(12.5)
    expect(roundToIncrement(12.75, 0.5)).toBe(13)
  })
})

describe('manual GP override', () => {
  it('prices with override GP and skips rule-derived GP', () => {
    const result = priceSale({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: [{ type: 'all_gp', gp: 70 }],
      gpOverride: 60,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targetGp).toBe(60)
    expect(result.matchedRule).toBeNull()
    expect(result.rawBottlePrice).toBeCloseTo(rawBottleSellingPrice(10, 60, 0.2), 10)
  })

  it('rejects invalid override GP', () => {
    const result = priceSale({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      gpOverride: 100,
      pricingPolicy: DEFAULT_PRICING_POLICY,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_GP')
  })
})

describe('invalid bottle sizes', () => {
  it('rejects zero, negative, and non-finite volumes', () => {
    for (const ml of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = resolveTargetGp({
        actualCostExVat: 10,
        bottleSizeMl: ml,
        rules: [{ type: 'all_gp', gp: 70 }],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_BOTTLE_SIZE')
    }
  })
})

describe('empty rules', () => {
  it('fails rather than inventing a fallback GP', () => {
    const result = resolveTargetGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EMPTY_RULES')
  })
})
