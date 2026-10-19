import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_POLICY,
  priceWithGp,
  rawBottleSellingPrice,
  roundToIncrement,
  validatePricingPolicy,
  type PricingPolicy,
} from '@/lib/pricing'
import { percentToRate, rateToPercent, rowToPricingPolicy } from '@/lib/pricingPolicyStore'

describe('percent ↔ rate conversion', () => {
  it('maps common UI percentages to domain rates', () => {
    expect(percentToRate(20)).toBeCloseTo(0.2, 10)
    expect(percentToRate(5)).toBeCloseTo(0.05, 10)
    expect(percentToRate(5.5)).toBeCloseTo(0.055, 10)
    expect(percentToRate(0)).toBe(0)
  })

  it('maps domain rates back to UI percentages', () => {
    expect(rateToPercent(0.2)).toBeCloseTo(20, 10)
    expect(rateToPercent(0.05)).toBeCloseTo(5, 10)
    expect(rateToPercent(0)).toBe(0)
  })

  it('round-trips without drift for representative values', () => {
    for (const pct of [0, 5, 5.5, 20, 0.25]) {
      expect(rateToPercent(percentToRate(pct))).toBeCloseTo(pct, 10)
    }
  })
})

describe('rowToPricingPolicy mapping', () => {
  it('coerces numeric strings from PostgREST numeric columns', () => {
    const policy = rowToPricingPolicy({
      id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000002',
      vat_rate: '0.20',
      btg_bottle_discount: '0.05',
      bottle_rounding_increment: '1.00',
      pour_rounding_increment: '0.50',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    expect(policy).toEqual(DEFAULT_PRICING_POLICY)
  })
})

describe('configurable VAT policy', () => {
  it('changes raw bottle price when VAT rate changes', () => {
    const cost = 10
    const gp = 70
    const vatZero = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: { ...DEFAULT_PRICING_POLICY, vatRate: 0 },
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    const vatTwenty = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: { ...DEFAULT_PRICING_POLICY, vatRate: 0.2 },
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(vatZero.ok && vatTwenty.ok).toBe(true)
    if (!vatZero.ok || !vatTwenty.ok) return
    expect(vatZero.rawBottlePrice).toBeCloseTo(rawBottleSellingPrice(cost, gp, 0), 10)
    expect(vatTwenty.rawBottlePrice).toBeCloseTo(rawBottleSellingPrice(cost, gp, 0.2), 10)
    expect(vatTwenty.rawBottlePrice).toBeGreaterThan(vatZero.rawBottlePrice)
  })
})

describe('configurable BTG bottle discount', () => {
  const cost = 10
  const gp = 70

  it('uses 5% default on bottle only; pours stay undiscounted', () => {
    const policy = DEFAULT_PRICING_POLICY
    const bottle = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: true },
    })
    const pour = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'pour', pourMl: 175 },
    })
    const undiscounted = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(bottle.ok && pour.ok && undiscounted.ok).toBe(true)
    if (!bottle.ok || !pour.ok || !undiscounted.ok) return
    expect(bottle.rawSalePrice).toBeCloseTo(undiscounted.rawBottlePrice * 0.95, 10)
    expect(pour.rawSalePrice).toBeCloseTo((undiscounted.rawBottlePrice / 750) * 175, 10)
  })

  it('supports 0% BTG discount', () => {
    const policy: PricingPolicy = { ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 0 }
    const bottle = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: true },
    })
    const undiscounted = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(bottle.ok && undiscounted.ok).toBe(true)
    if (!bottle.ok || !undiscounted.ok) return
    expect(bottle.rawSalePrice).toBeCloseTo(undiscounted.rawBottlePrice, 10)
    expect(bottle.btgDiscountApplied).toBe(true)
  })

  it('supports a custom valid BTG percentage on bottle only', () => {
    const policy: PricingPolicy = { ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 0.1 }
    const bottle = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: true },
    })
    const pour = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'pour', pourMl: 125 },
    })
    const undiscounted = priceWithGp({
      actualCostExVat: cost,
      bottleSizeMl: 750,
      gp,
      pricingPolicy: policy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(bottle.ok && pour.ok && undiscounted.ok).toBe(true)
    if (!bottle.ok || !pour.ok || !undiscounted.ok) return
    expect(bottle.rawSalePrice).toBeCloseTo(undiscounted.rawBottlePrice * 0.9, 10)
    expect(pour.rawSalePrice).toBeCloseTo((undiscounted.rawBottlePrice / 750) * 125, 10)
  })
})

describe('configurable bottle rounding', () => {
  const cost = 10
  const gp = 70
  // raw = 40 with default VAT/GP; choose cost/gp that leaves fractional raw after discount-free bottle
  const raw = rawBottleSellingPrice(cost, gp, 0.2) // 40 exactly — use nudge via different cost
  const fractionalCost = 11.37
  const fractionalGp = 68

  it('rounds bottle prices for presets and a custom increment', () => {
    const increments = [0.01, 0.5, 1, 5, 2]
    for (const bottleRoundingIncrement of increments) {
      const result = priceWithGp({
        actualCostExVat: fractionalCost,
        bottleSizeMl: 750,
        gp: fractionalGp,
        pricingPolicy: { ...DEFAULT_PRICING_POLICY, bottleRoundingIncrement },
        saleContext: { kind: 'bottle', applyBtgDiscount: false },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.roundedSalePrice).toBe(
        roundToIncrement(result.rawSalePrice, bottleRoundingIncrement)
      )
    }
    expect(raw).toBeCloseTo(40, 10)
  })
})

describe('configurable pour rounding', () => {
  it('rounds pour prices for presets and a custom increment', () => {
    const increments = [0.1, 0.25, 0.5, 1, 0.05]
    for (const pourRoundingIncrement of increments) {
      const result = priceWithGp({
        actualCostExVat: 18.5,
        bottleSizeMl: 750,
        gp: 67,
        pricingPolicy: { ...DEFAULT_PRICING_POLICY, pourRoundingIncrement },
        saleContext: { kind: 'pour', pourMl: 175 },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.roundedSalePrice).toBe(
        roundToIncrement(result.rawSalePrice, pourRoundingIncrement)
      )
    }
  })
})

describe('invalid pricing policy rejection', () => {
  it('rejects negative VAT, negative BTG, BTG >= 100%, and non-positive rounding', () => {
    expect(validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, vatRate: -0.01 })).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, btgBottleDiscount: -0.01 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 1 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 1.5 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, bottleRoundingIncrement: 0 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, bottleRoundingIncrement: -1 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, pourRoundingIncrement: 0 })
    ).not.toBeNull()
    expect(
      validatePricingPolicy({ ...DEFAULT_PRICING_POLICY, pourRoundingIncrement: -0.5 })
    ).not.toBeNull()
  })

  it('priceWithGp returns INVALID_POLICY for invalid policies', () => {
    const result = priceWithGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      gp: 70,
      pricingPolicy: { ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 1 },
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_POLICY')
  })

  it('accepts the product default policy', () => {
    expect(validatePricingPolicy(DEFAULT_PRICING_POLICY)).toBeNull()
  })
})
