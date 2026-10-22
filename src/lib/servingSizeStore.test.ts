import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_POLICY,
  priceWithGp,
  rawBottleSellingPrice,
  roundToIncrement,
} from '@/lib/pricing'
import { DEFAULT_SERVING_SIZE_DEFINITIONS } from '@/lib/servingSizeDefaults'
import {
  sortServingSizes,
  servingSizesForCalculator,
  validateServingSizeFields,
} from '@/lib/servingSizeStore'
import type { ServingSize } from '@/types/servingSizes'

function size(
  partial: Partial<ServingSize> & Pick<ServingSize, 'id' | 'category' | 'label' | 'volumeMl'>
): ServingSize {
  return {
    enabled: true,
    displayOrder: 10,
    ...partial,
  }
}

describe('default serving size definitions', () => {
  it('matches pre-Stage-3C dry / sparkling / sweet volumes and order', () => {
    const byCategory = {
      dry: DEFAULT_SERVING_SIZE_DEFINITIONS.filter((d) => d.category === 'dry'),
      sparkling: DEFAULT_SERVING_SIZE_DEFINITIONS.filter((d) => d.category === 'sparkling'),
      sweet_fortified: DEFAULT_SERVING_SIZE_DEFINITIONS.filter(
        (d) => d.category === 'sweet_fortified'
      ),
    }

    expect(byCategory.dry.map((d) => d.volumeMl)).toEqual([125, 175, 250, 500])
    expect(byCategory.dry.map((d) => d.label)).toEqual([
      'Small glass',
      'Medium glass',
      'Large glass',
      'Carafe',
    ])
    expect(byCategory.dry.map((d) => d.displayOrder)).toEqual([10, 20, 30, 40])

    expect(byCategory.sparkling.map((d) => [d.label, d.volumeMl])).toEqual([
      ['Coravin glass', 125],
      ['Standard glass', 150],
    ])

    expect(byCategory.sweet_fortified.map((d) => [d.label, d.volumeMl])).toEqual([
      ['Small glass', 75],
    ])

    expect(DEFAULT_SERVING_SIZE_DEFINITIONS.every((d) => d.volumeMl > 0)).toBe(true)
  })

  it('does not include a Bottle row in defaults', () => {
    expect(
      DEFAULT_SERVING_SIZE_DEFINITIONS.some((d) => /bottle/i.test(d.label))
    ).toBe(false)
  })
})

describe('serving size field validation', () => {
  it('rejects blank label, non-positive / fractional volume, and invalid category', () => {
    expect(
      validateServingSizeFields({ category: 'dry', label: '   ', volumeMl: 100 })
    ).not.toBeNull()
    expect(
      validateServingSizeFields({ category: 'dry', label: 'Glass', volumeMl: 0 })
    ).not.toBeNull()
    expect(
      validateServingSizeFields({ category: 'dry', label: 'Glass', volumeMl: -1 })
    ).not.toBeNull()
    expect(
      validateServingSizeFields({ category: 'dry', label: 'Glass', volumeMl: 12.5 })
    ).not.toBeNull()
    expect(
      validateServingSizeFields({ category: 'red', label: 'Glass', volumeMl: 100 })
    ).not.toBeNull()
  })

  it('accepts a valid integer volume and label', () => {
    expect(
      validateServingSizeFields({ category: 'dry', label: 'Tasting glass', volumeMl: 100 })
    ).toBeNull()
  })
})

describe('ordering and filtering helpers', () => {
  const rows: ServingSize[] = [
    size({ id: 'b', category: 'dry', label: 'Large', volumeMl: 250, displayOrder: 30, enabled: true }),
    size({ id: 'a', category: 'dry', label: 'Small', volumeMl: 125, displayOrder: 10, enabled: false }),
    size({ id: 'c', category: 'dry', label: 'Medium', volumeMl: 175, displayOrder: 20, enabled: true }),
    size({
      id: 's',
      category: 'sparkling',
      label: 'Standard glass',
      volumeMl: 150,
      displayOrder: 20,
      enabled: true,
    }),
    size({
      id: 'tie2',
      category: 'dry',
      label: 'Zed',
      volumeMl: 50,
      displayOrder: 20,
      enabled: true,
    }),
    size({
      id: 'tie1',
      category: 'dry',
      label: 'Alpha',
      volumeMl: 60,
      displayOrder: 20,
      enabled: true,
    }),
  ]

  it('sorts by display_order then label then id', () => {
    const sorted = sortServingSizes(rows.filter((r) => r.category === 'dry'))
    expect(sorted.map((r) => r.id)).toEqual(['a', 'tie1', 'c', 'tie2', 'b'])
  })

  it('filters to enabled rows for the selected category only', () => {
    const dry = servingSizesForCalculator(rows, 'dry')
    expect(dry.map((r) => r.label)).toEqual(['Alpha', 'Medium', 'Zed', 'Large'])
    expect(dry.every((r) => r.enabled && r.category === 'dry')).toBe(true)

    const sparkling = servingSizesForCalculator(rows, 'sparkling')
    expect(sparkling.map((r) => r.volumeMl)).toEqual([150])
  })

  it('returns an empty list for a configured category with no enabled rows (no hardcoded fallback)', () => {
    const onlyDisabled = [
      size({
        id: 'x',
        category: 'sweet_fortified',
        label: 'Small glass',
        volumeMl: 75,
        enabled: false,
        displayOrder: 10,
      }),
    ]
    expect(servingSizesForCalculator(onlyDisabled, 'sweet_fortified')).toEqual([])
    expect(servingSizesForCalculator([], 'dry')).toEqual([])
  })
})

describe('provisioning invariants (documented behaviour)', () => {
  it('treats an empty serving list as a valid configured state (no auto-fallback sizes)', () => {
    // listServingSizes returns whatever is persisted — including [].
    // seedDefaultServingSizes is only invoked from first-time Pricing Policy creation,
    // never merely because the serving list is empty.
    expect(servingSizesForCalculator([], 'dry')).toEqual([])
    expect(servingSizesForCalculator([], 'sparkling')).toEqual([])
    expect(servingSizesForCalculator([], 'sweet_fortified')).toEqual([])
  })
})

describe('custom serving pricing through the engine', () => {
  it('prices a 100ml serving from the undiscounted bottle basis', () => {
    // cost £100, GP 50%, VAT 20% → bottle raw = (100 * 1.2) / 0.5 = 240
    const policy = { ...DEFAULT_PRICING_POLICY, pourRoundingIncrement: 0.5 }
    const bottle = priceWithGp({
      actualCostExVat: 100,
      bottleSizeMl: 750,
      gp: 50,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(bottle.ok).toBe(true)
    if (!bottle.ok) return
    expect(bottle.rawBottlePrice).toBeCloseTo(rawBottleSellingPrice(100, 50, 0.2), 10)
    expect(bottle.rawBottlePrice).toBeCloseTo(240, 10)

    const pour = priceWithGp({
      actualCostExVat: 100,
      bottleSizeMl: 750,
      gp: 50,
      pricingPolicy: policy,
      saleContext: { kind: 'pour', pourMl: 100 },
    })
    expect(pour.ok).toBe(true)
    if (!pour.ok) return
    expect(pour.rawSalePrice).toBeCloseTo(32, 10)
    expect(pour.roundedSalePrice).toBe(roundToIncrement(32, 0.5))
  })

  it('keeps custom pour on undiscounted basis when BTG bottle discount applies', () => {
    const policy = { ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 0.05 }
    const btgBottle = priceWithGp({
      actualCostExVat: 100,
      bottleSizeMl: 750,
      gp: 50,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: true },
    })
    const pour = priceWithGp({
      actualCostExVat: 100,
      bottleSizeMl: 750,
      gp: 50,
      pricingPolicy: policy,
      saleContext: { kind: 'pour', pourMl: 100 },
    })
    expect(btgBottle.ok && pour.ok).toBe(true)
    if (!btgBottle.ok || !pour.ok) return
    expect(btgBottle.rawSalePrice).toBeCloseTo(240 * 0.95, 10)
    expect(pour.rawSalePrice).toBeCloseTo(32, 10)
    expect(pour.btgDiscountApplied).toBe(false)
  })
})
