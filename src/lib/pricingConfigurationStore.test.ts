import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_POLICY,
  priceWithGp,
  resolveTargetGp,
  validatePricingPolicy,
  validateRuleSetForPricing,
} from '@/lib/pricing'
import {
  BLANK_PRICING_CONFIGURATION_DEFAULTS,
  isConfigurationFinanciallyComplete,
  normalizeConfigurationName,
  percentToRate,
  rateToPercent,
  rowToPricingConfiguration,
  rowToPricingPolicy,
  sortPricingConfigurations,
  validateConfigurationName,
  type PricingConfigurationRow,
} from '@/lib/pricingConfigurationStore'
import type { PricingConfiguration } from '@/types/pricingConfigurations'
import type { Rule } from '@/types/rules'

const sampleRules: Rule[] = [
  { type: 'less_than', max: 10, gp: 75 },
  { type: 'between', min: 10, max: 25, start_gp: 75, end_gp: 65 },
  { type: 'greater_than', min: 25, gp: 65 },
]

function makeConfig(
  partial: Partial<PricingConfiguration> & Pick<PricingConfiguration, 'id' | 'name'>
): PricingConfiguration {
  return {
    isCurrent: false,
    status: 'active',
    rules: sampleRules,
    pricingPolicy: { ...DEFAULT_PRICING_POLICY },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('configuration name validation', () => {
  it('rejects empty / whitespace-only names', () => {
    expect(validateConfigurationName('')).toBeTruthy()
    expect(validateConfigurationName('   ')).toBeTruthy()
    expect(normalizeConfigurationName('  Main Pricing  ')).toBe('Main Pricing')
    expect(validateConfigurationName('Main Pricing')).toBeNull()
  })
})

describe('blank defaults', () => {
  it('starts with empty rules and standard policy', () => {
    expect(BLANK_PRICING_CONFIGURATION_DEFAULTS.rules).toEqual([])
    expect(BLANK_PRICING_CONFIGURATION_DEFAULTS.pricingPolicy).toEqual(DEFAULT_PRICING_POLICY)
    expect(validatePricingPolicy(BLANK_PRICING_CONFIGURATION_DEFAULTS.pricingPolicy)).toBeNull()
    expect(
      validateRuleSetForPricing(BLANK_PRICING_CONFIGURATION_DEFAULTS.rules)
    ).not.toBeNull()
  })
})

describe('financial completeness', () => {
  it('rejects blank rules and accepts a valid rule set + policy', () => {
    expect(
      isConfigurationFinanciallyComplete({
        rules: [],
        pricingPolicy: DEFAULT_PRICING_POLICY,
      })
    ).toBe(false)
    expect(
      isConfigurationFinanciallyComplete({
        rules: sampleRules,
        pricingPolicy: DEFAULT_PRICING_POLICY,
      })
    ).toBe(true)
    expect(
      isConfigurationFinanciallyComplete({
        rules: sampleRules,
        pricingPolicy: { ...DEFAULT_PRICING_POLICY, btgBottleDiscount: 1 },
      })
    ).toBe(false)
  })
})

describe('sortPricingConfigurations', () => {
  it('places Current first among active, archived after active', () => {
    const sorted = sortPricingConfigurations([
      makeConfig({ id: 'a', name: 'Zebra', status: 'archived' }),
      makeConfig({ id: 'b', name: 'Beta' }),
      makeConfig({ id: 'c', name: 'Alpha', isCurrent: true }),
      makeConfig({ id: 'd', name: 'Gamma' }),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'd', 'a'])
  })
})

describe('row mapping / migration shape', () => {
  it('maps configuration rows including numeric strings', () => {
    const row: PricingConfigurationRow = {
      id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000002',
      name: 'Main Pricing',
      is_current: true,
      status: 'active',
      rules: sampleRules,
      vat_rate: '0.20',
      btg_bottle_discount: '0.05',
      bottle_rounding_increment: '1.00',
      pour_rounding_increment: '0.50',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const config = rowToPricingConfiguration(row)
    expect(config.name).toBe('Main Pricing')
    expect(config.isCurrent).toBe(true)
    expect(config.status).toBe('active')
    expect(config.rules).toEqual(sampleRules)
    expect(config.pricingPolicy).toEqual(DEFAULT_PRICING_POLICY)
    expect(rowToPricingPolicy(row)).toEqual(DEFAULT_PRICING_POLICY)
  })
})

describe('percent ↔ rate conversion', () => {
  it('round-trips representative UI percentages', () => {
    for (const pct of [0, 5, 5.5, 20]) {
      expect(rateToPercent(percentToRate(pct))).toBeCloseTo(pct, 10)
    }
  })
})

describe('calculator always uses Current configuration contents', () => {
  it('prices from Current rules+policy and ignores an alternative with different GP', () => {
    const current = makeConfig({
      id: 'current',
      name: 'Main Pricing',
      isCurrent: true,
      rules: [{ type: 'all_gp', gp: 70 }],
    })
    const alternative = makeConfig({
      id: 'alt',
      name: 'Higher GP',
      rules: [{ type: 'all_gp', gp: 80 }],
      pricingPolicy: { ...DEFAULT_PRICING_POLICY, vatRate: 0 },
    })

    // Calculator selects Current only (no picker).
    const selected = [current, alternative].find((c) => c.isCurrent)
    expect(selected?.id).toBe('current')

    const resolved = resolveTargetGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      rules: selected!.rules,
    })
    expect(resolved.ok && resolved.targetGp).toBe(70)

    const priced = priceWithGp({
      actualCostExVat: 10,
      bottleSizeMl: 750,
      gp: 70,
      pricingPolicy: selected!.pricingPolicy,
      saleContext: { kind: 'bottle', applyBtgDiscount: false },
    })
    expect(priced.ok).toBe(true)
    if (!priced.ok) return
    // VAT 20%, GP 70% → raw 40, rounded to £1
    expect(priced.roundedSalePrice).toBe(40)
  })
})

describe('duplicate / copy semantics (pure)', () => {
  it('copies rules and policy but not current/archived status', () => {
    const source = makeConfig({
      id: 'src',
      name: 'Source',
      isCurrent: true,
      status: 'active',
    })
    const copy: PricingConfiguration = {
      ...source,
      id: 'copy',
      name: 'Copy',
      isCurrent: false,
      status: 'active',
      rules: structuredClone(source.rules),
      pricingPolicy: { ...source.pricingPolicy },
    }
    expect(copy.isCurrent).toBe(false)
    expect(copy.status).toBe('active')
    expect(copy.rules).toEqual(source.rules)
    expect(copy.pricingPolicy).toEqual(source.pricingPolicy)
    expect(copy.id).not.toBe(source.id)
  })
})

describe('serving sizes remain independent of configurations', () => {
  it('configuration shape has no serving-size fields', () => {
    const config = makeConfig({ id: 'x', name: 'Main Pricing', isCurrent: true })
    expect('servingSizes' in config).toBe(false)
    expect(Object.keys(config).sort()).toEqual(
      [
        'createdAt',
        'id',
        'isCurrent',
        'name',
        'pricingPolicy',
        'rules',
        'status',
        'updatedAt',
      ].sort()
    )
  })
})

describe('migrated Main Pricing financial regression fixtures', () => {
  it('representative engine paths remain stable with default policy', () => {
    const policy = DEFAULT_PRICING_POLICY
    const cases: Array<{
      cost: number
      ml: number
      gp: number
      btg?: boolean
      pourMl?: number
    }> = [
      { cost: 10, ml: 750, gp: 70 },
      { cost: 5, ml: 375, gp: 75 },
      { cost: 20, ml: 1500, gp: 65 },
      { cost: 12, ml: 1000, gp: 68 },
      { cost: 10, ml: 750, gp: 70, btg: true },
      { cost: 10, ml: 750, gp: 70, pourMl: 175 },
    ]

    for (const c of cases) {
      const result = priceWithGp({
        actualCostExVat: c.cost,
        bottleSizeMl: c.ml,
        gp: c.gp,
        pricingPolicy: policy,
        saleContext:
          c.pourMl != null
            ? { kind: 'pour', pourMl: c.pourMl }
            : { kind: 'bottle', applyBtgDiscount: Boolean(c.btg) },
      })
      expect(result.ok).toBe(true)
    }

    const mid = resolveTargetGp({
      actualCostExVat: 17.5,
      bottleSizeMl: 750,
      rules: sampleRules,
    })
    expect(mid.ok && mid.targetGp).toBeCloseTo(70, 10)
  })
})
