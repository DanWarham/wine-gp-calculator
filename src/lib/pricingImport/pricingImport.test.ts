import { describe, expect, it } from 'vitest'
import { parseCsv, decodeCsvBuffer } from '@/lib/pricingImport/csv'
import {
  filterWineRecipes,
  isLimeWoodWinePlu,
  parseFnbShopRecipeDetail,
} from '@/lib/pricingImport/fnbshop/parseRecipeDetail'
import {
  buildMicrosWineIndex,
  isMainMenuLevelZero,
  isMicrosRcItem,
  isStructuralHeadingName,
  parseMicrosReports,
} from '@/lib/pricingImport/micros/parseMenuItemReports'
import { buildLimeWoodPricingImport } from '@/lib/pricingImport/limeWoodImport'
import { selectPreviousCompletedImport } from '@/lib/pricingImport/previousImport'
import { classifyServe, parsePackageVolumeMl, parseVolumeMl } from '@/lib/pricingImport/volumes'
import {
  buildFnbShopRecipeDetailXlsx,
  buildMicrosCsvs,
  standardFixtureSet,
} from '@/lib/pricingImport/fixtures/buildFixtures'

describe('volume parsing', () => {
  it('extracts recipe and package volumes including non-750 sizes', () => {
    expect(parseVolumeMl('750 ML')).toBe(750)
    expect(parseVolumeMl('12.5 ML')).toBe(12.5)
    expect(parseVolumeMl('75 ML')).toBe(75)
    expect(parsePackageVolumeMl('Guiraud, Btl750 ML (2001)')).toBe(750)
    expect(parsePackageVolumeMl('Wine, Btl50 CL')).toBe(500)
    expect(parsePackageVolumeMl('Wine, Btl375 ML')).toBe(375)
    expect(parsePackageVolumeMl('Wine, Btl1500 ML')).toBe(1500)
    expect(parsePackageVolumeMl('Wine, Btl3000 ML')).toBe(3000)
    expect(parsePackageVolumeMl('Wine, Bag5000 ML')).toBe(5000)
  })

  it('classifies full bottle vs partial serve without assuming 750ml', () => {
    expect(classifyServe(750, 750).itemType).toBe('full_bottle')
    expect(classifyServe(500, 500).itemType).toBe('full_bottle')
    expect(classifyServe(1500, 1500).itemType).toBe('full_bottle')
    expect(classifyServe(175, 750).itemType).toBe('partial_serve')
    expect(classifyServe(75, 375).itemType).toBe('partial_serve')
    expect(classifyServe(null, 750).itemType).toBeNull()
    expect(classifyServe(900, 750).itemType).toBeNull()
  })
})

describe('FnbShop Recipe Detail parsing', () => {
  it('extracts PLUs and filters the Lime Wood wine range', async () => {
    const fixtures = await standardFixtureSet()
    const parsed = await parseFnbShopRecipeDetail(fixtures.fnbshop)
    const plus = parsed.recipes.map((r) => r.plu)
    expect(plus).toContain('5000001')
    expect(plus).toContain('1050053')

    const wine = filterWineRecipes(parsed.recipes)
    expect(wine.every((r) => isLimeWoodWinePlu(r.plu))).toBe(true)
    expect(wine.map((r) => r.plu)).not.toContain('1050053')
    expect(wine).toHaveLength(6)

    const full = wine.find((r) => r.plu === '5000001')!
    expect(full.ingredients[0].packageVolumeMl).toBe(750)
    expect(full.ingredients[0].recipeVolumeMl).toBe(750)
    expect(full.costExVat).toBe(21)
  })
})

describe('Micros three-report join', () => {
  it('resolves Master → Definition → Price by PLU', async () => {
    const fixtures = await standardFixtureSet()
    const reports = parseMicrosReports({
      master: fixtures.master,
      definition: fixtures.definition,
      price: fixtures.price,
    })
    const index = buildMicrosWineIndex(reports)
    expect(index.linkStructureOk).toBe(true)
    const alpha = index.byPlu.get('5000001')!
    expect(alpha).toHaveLength(1)
    expect(alpha[0].sellingPriceIncVat).toBe(65)
    expect(alpha[0].description).toBe('Alpha Full Btl')
  })

  it('recognises headings, RC items, and Main Menu Level 0', () => {
    expect(isStructuralHeadingName('***WINE HEADING***')).toBe(true)
    expect(isMicrosRcItem('RC House Red')).toBe(true)
    expect(isMicrosRcItem('Grace House Red')).toBe(false)
    expect(isMainMenuLevelZero('00000000')).toBe(true)
    expect(isMainMenuLevelZero('0')).toBe(true)
    expect(isMainMenuLevelZero('11111111')).toBe(false)
  })
})

describe('Lime Wood import rules', () => {
  it('uses FnbShop cost authority and Micros selling-price authority', async () => {
    const fixtures = await standardFixtureSet()
    const built = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(built.validation.ok).toBe(true)
    if (!built.validation.ok || !built.observations) throw new Error('expected ok')

    const alpha = built.observations.find((o) => o.externalPlu === '5000001')!
    expect(alpha.costExVat).toBe(21)
    expect(alpha.sellingPriceIncVat).toBe(65)
    expect(alpha.fnbshopSellingPriceIncVat).toBe(60)
    expect(alpha.fnbshopDescription).toBe('Alpha Full Bottle')
    expect(alpha.microsDescription).toBe('Alpha Full Btl')
    expect(alpha.includedForPricing).toBe(true)
  })

  it('tolerates description mismatch and includes Main Menu Level 0 FnbShop items', async () => {
    const fixtures = await standardFixtureSet()
    const built = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(built.validation.ok).toBe(true)
    if (!built.validation.ok || !built.observations) throw new Error('expected ok')

    const alpha = built.observations.find((o) => o.externalPlu === '5000001')!
    expect(alpha.fnbshopDescription).not.toBe(alpha.microsDescription)
    expect(
      built.validation.issues.some(
        (i) => i.externalPlu === '5000001' && i.severity === 'item_exception'
      )
    ).toBe(false)

    const zeta = built.observations.find((o) => o.externalPlu === '5000006')!
    expect(zeta.microsMainMenuLevel).toBe('00000000')
    expect(zeta.includedForPricing).toBe(true)
  })

  it('ignores Micros-only level 0 and RC; records active Micros-only as informational', async () => {
    const fixtures = await standardFixtureSet()
    const built = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(built.validation.ok).toBe(true)
    if (!built.validation.ok) throw new Error('expected ok')

    expect(built.validation.summary.ignoredMicrosOnlyCount).toBeGreaterThanOrEqual(3)
    const activeIssue = built.validation.issues.find(
      (i) => i.externalPlu === '5000103' && i.issueType === 'micros_only_active'
    )
    expect(activeIssue?.severity).toBe('informational')
    expect(built.observations?.some((o) => o.externalPlu === '5000103')).toBe(false)
    expect(built.observations?.some((o) => o.externalPlu === '5000101')).toBe(false)
    expect(built.observations?.some((o) => o.externalPlu === '5000102')).toBe(false)
  })

  it('creates item exceptions for missing Micros match and zero cost', async () => {
    const fixtures = await standardFixtureSet()
    const built = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(built.validation.ok).toBe(true)
    if (!built.validation.ok || !built.observations) throw new Error('expected ok')

    const missing = built.observations.find((o) => o.externalPlu === '5000004')!
    expect(missing.includedForPricing).toBe(false)
    expect(
      built.validation.issues.some(
        (i) => i.externalPlu === '5000004' && i.issueType === 'missing_micros_match'
      )
    ).toBe(true)

    const zero = built.observations.find((o) => o.externalPlu === '5000003')!
    expect(zero.includedForPricing).toBe(false)
    expect(
      built.validation.issues.some(
        (i) => i.externalPlu === '5000003' && i.issueType === 'invalid_cost'
      )
    ).toBe(true)

    expect(built.commitPayload).toBeTruthy()
    expect(built.validation.summary.excludedExceptionCount).toBeGreaterThanOrEqual(2)
    expect(built.validation.summary.matchedCount).toBeGreaterThanOrEqual(3)
  })

  it('blocks structurally unrecognisable source files', async () => {
    const fixtures = await standardFixtureSet()
    const blocked = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: new TextEncoder().encode('not-an-xlsx'),
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(blocked.validation.ok).toBe(false)
    if (blocked.validation.ok) throw new Error('expected blocked')
    expect(blocked.validation.blocked).toBe(true)

    const badMaster = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: new TextEncoder().encode('Nope,Wrong\n1,2\n'),
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(badMaster.validation.ok).toBe(false)
  })

  it('classifies full bottles and partial serves in summary counts', async () => {
    const fixtures = await standardFixtureSet()
    const built = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })
    expect(built.validation.ok).toBe(true)
    if (!built.validation.ok) throw new Error('expected ok')
    expect(built.validation.summary.fullBottleCount).toBeGreaterThanOrEqual(4)
    expect(built.validation.summary.partialServeCount).toBe(1)
  })
})

describe('immutable consecutive imports foundation', () => {
  it('selects the previous completed import for the same user only', () => {
    const rows = [
      {
        id: 'a',
        userId: 'user-1',
        importedAt: '2026-08-01T00:00:00.000Z',
        status: 'completed' as const,
      },
      {
        id: 'b',
        userId: 'user-1',
        importedAt: '2026-09-01T00:00:00.000Z',
        status: 'completed' as const,
      },
      {
        id: 'c',
        userId: 'user-1',
        importedAt: '2026-10-01T00:00:00.000Z',
        status: 'completed' as const,
      },
      {
        id: 'other',
        userId: 'user-2',
        importedAt: '2026-09-15T00:00:00.000Z',
        status: 'completed' as const,
      },
    ]

    expect(selectPreviousCompletedImport(rows, 'c')?.id).toBe('b')
    expect(selectPreviousCompletedImport(rows, 'b')?.id).toBe('a')
    expect(selectPreviousCompletedImport(rows, 'a')).toBeNull()
    expect(selectPreviousCompletedImport(rows, 'other')?.id).not.toBe('c')
    expect(selectPreviousCompletedImport(rows, 'other')).toBeNull()
  })

  it('keeps observations independent across successive builds (no overwrite model)', async () => {
    const fixtures = await standardFixtureSet()
    const first = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: fixtures.fnbshop,
      microsMenuItemMaster: fixtures.master,
      microsMenuItemDefinition: fixtures.definition,
      microsMenuItemPrice: fixtures.price,
      filenames: fixtures.filenames,
    })

    const raisedCost = await buildFnbShopRecipeDetailXlsx([
      {
        plu: '5000001',
        name: 'Alpha Full Bottle',
        cost: 23,
        sell: 60,
        ingredientName: 'Alpha Wine, Btl750 ML',
        measurement: '750 ML',
      },
    ])
    const micros = buildMicrosCsvs({
      masters: [{ id: '100', objectNumber: '5000001', name: 'Alpha Full Btl' }],
      definitions: [
        { id: '1000', masterId: '100', firstName: 'Alpha Full Btl', mainMenuLevel: '11111111' },
      ],
      prices: [{ id: '2000', defId: '1000', price: '65' }],
    })
    const second = await buildLimeWoodPricingImport({
      fnbshopRecipeDetail: raisedCost,
      microsMenuItemMaster: micros.master,
      microsMenuItemDefinition: micros.definition,
      microsMenuItemPrice: micros.price,
      filenames: fixtures.filenames,
    })

    expect(first.observations?.find((o) => o.externalPlu === '5000001')?.costExVat).toBe(21)
    expect(second.observations?.find((o) => o.externalPlu === '5000001')?.costExVat).toBe(23)
  })
})

describe('csv decoding', () => {
  it('parses Micros-shaped CSV and accepts windows-1252 pound signs', () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('Id,MenuItemName\n1,'),
      0xa3, // £ in cp1252
      ...new TextEncoder().encode('95 Wine\n'),
    ])
    const text = decodeCsvBuffer(bytes)
    const { rows } = parseCsv(text)
    expect(rows[0].MenuItemName).toContain('95 Wine')
  })
})

describe('user isolation boundary (model)', () => {
  it('scopes previous-import selection by user_id so users cannot see each other history', () => {
    const imports = [
      {
        id: 'u1-oct',
        userId: 'user-1',
        importedAt: '2026-10-01T00:00:00.000Z',
        status: 'completed' as const,
      },
      {
        id: 'u2-sep',
        userId: 'user-2',
        importedAt: '2026-09-01T00:00:00.000Z',
        status: 'completed' as const,
      },
    ]
    expect(selectPreviousCompletedImport(imports, 'u1-oct')).toBeNull()
  })
})
