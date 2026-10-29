import {
  FnbShopParseError,
  filterWineRecipes,
  parseFnbShopRecipeDetail,
  type FnbShopRecipe,
} from '@/lib/pricingImport/fnbshop/parseRecipeDetail'
import {
  buildMicrosWineIndex,
  isMainMenuLevelActiveLooking,
  isMainMenuLevelZero,
  isMicrosRcItem,
  isStructuralHeadingName,
  MicrosParseError,
  parseMicrosReports,
  type MicrosResolvedItem,
} from '@/lib/pricingImport/micros/parseMenuItemReports'
import { classifyServe } from '@/lib/pricingImport/volumes'
import type {
  PricingDataImportValidation,
  PricingImportIssue,
  PricingImportSummary,
  PricingObservationDraft,
} from '@/types/pricingDataImport'

export interface LimeWoodImportFiles {
  fnbshopRecipeDetail: ArrayBuffer | Buffer | Uint8Array
  microsMenuItemMaster: ArrayBuffer | Buffer | Uint8Array
  microsMenuItemDefinition: ArrayBuffer | Buffer | Uint8Array
  microsMenuItemPrice: ArrayBuffer | Buffer | Uint8Array
  filenames: {
    fnbshopRecipeDetail: string
    microsMenuItemMaster: string
    microsMenuItemDefinition: string
    microsMenuItemPrice: string
  }
}

export interface LimeWoodImportBuild {
  validation: PricingDataImportValidation
  /** Present when validation.ok — used by commit path. */
  observations?: PricingObservationDraft[]
  commitPayload?: {
    source_system: string
    source_filenames: Record<string, string>
    summary: Record<string, number>
    observations: Record<string, unknown>[]
    issues: Record<string, unknown>[]
  }
}

function blocked(message: string, extra: PricingImportIssue[] = []): LimeWoodImportBuild {
  return {
    validation: {
      ok: false,
      blocked: true,
      message,
      issues: [
        {
          externalPlu: null,
          severity: 'item_exception',
          issueType: 'structural_source_failure',
          message,
        },
        ...extra,
      ],
    },
  }
}

function isValidCost(cost: number | null): cost is number {
  return cost != null && Number.isFinite(cost) && cost > 0
}

function pickMicrosMatch(
  matches: MicrosResolvedItem[] | undefined
): {
  match: MicrosResolvedItem | null
  ambiguous: boolean
} {
  if (!matches || matches.length === 0) return { match: null, ambiguous: false }
  if (matches.length > 1) return { match: null, ambiguous: true }
  const match = matches[0]
  if (match.priceAmbiguous) return { match, ambiguous: true }
  return { match, ambiguous: false }
}

/**
 * Build a Lime Wood V1 canonical import preview (and commit payload) from the four source files.
 * Source-specific parsing stays here; persisted shape is canonical.
 */
export async function buildLimeWoodPricingImport(
  files: LimeWoodImportFiles
): Promise<LimeWoodImportBuild> {
  let wineRecipes: FnbShopRecipe[]
  try {
    const parsed = await parseFnbShopRecipeDetail(files.fnbshopRecipeDetail)
    wineRecipes = filterWineRecipes(parsed.recipes)
  } catch (err) {
    const message =
      err instanceof FnbShopParseError
        ? err.message
        : 'Failed to parse FnbShop Recipe Detail file.'
    return blocked(message)
  }

  let microsIndex: ReturnType<typeof buildMicrosWineIndex>
  try {
    const reports = parseMicrosReports({
      master: files.microsMenuItemMaster,
      definition: files.microsMenuItemDefinition,
      price: files.microsMenuItemPrice,
    })
    microsIndex = buildMicrosWineIndex(reports)
  } catch (err) {
    const message =
      err instanceof MicrosParseError ? err.message : 'Failed to parse Micros menu item reports.'
    return blocked(message)
  }

  if (!microsIndex.linkStructureOk) {
    return blocked(
      microsIndex.linkStructureMessage ??
        'Required Micros link structure is unavailable.'
    )
  }

  const issues: PricingImportIssue[] = []
  const observations: PricingObservationDraft[] = []

  // Duplicate FnbShop wine PLUs → unresolved ambiguity for those PLUs
  const pluCounts = new Map<string, number>()
  for (const r of wineRecipes) {
    pluCounts.set(r.plu, (pluCounts.get(r.plu) ?? 0) + 1)
  }
  const duplicatePlus = new Set(
    [...pluCounts.entries()].filter(([, n]) => n > 1).map(([plu]) => plu)
  )

  let fullBottleCount = 0
  let partialServeCount = 0
  let matchedCount = 0
  let excludedExceptionCount = 0

  for (const recipe of wineRecipes) {
    const ingredient = recipe.ingredients[0] ?? null
    const classification = classifyServe(
      ingredient?.recipeVolumeMl ?? null,
      ingredient?.packageVolumeMl ?? null
    )

    if (classification.itemType === 'full_bottle') fullBottleCount++
    if (classification.itemType === 'partial_serve') partialServeCount++

    const exceptionMessages: string[] = []
    let included = true

    if (duplicatePlus.has(recipe.plu)) {
      included = false
      exceptionMessages.push(
        `Duplicate FnbShop wine PLU ${recipe.plu} causes unresolved ambiguity.`
      )
      issues.push({
        externalPlu: recipe.plu,
        severity: 'item_exception',
        issueType: 'duplicate_plu',
        message: `Duplicate FnbShop wine PLU ${recipe.plu} causes unresolved ambiguity.`,
      })
    }

    if (classification.itemType == null) {
      included = false
      exceptionMessages.push(classification.reason)
      issues.push({
        externalPlu: recipe.plu,
        severity: 'item_exception',
        issueType: 'unresolved_package_size',
        message: classification.reason,
      })
    }

    if (!isValidCost(recipe.costExVat)) {
      included = false
      exceptionMessages.push('Cost Price is zero, missing, or invalid.')
      issues.push({
        externalPlu: recipe.plu,
        severity: 'item_exception',
        issueType: 'invalid_cost',
        message: `PLU ${recipe.plu}: Cost Price is zero, missing, or invalid.`,
      })
    }

    const { match, ambiguous } = pickMicrosMatch(microsIndex.byPlu.get(recipe.plu))

    if (!match) {
      included = false
      if (ambiguous) {
        exceptionMessages.push('Micros price/definition match is ambiguous.')
        issues.push({
          externalPlu: recipe.plu,
          severity: 'item_exception',
          issueType: 'ambiguous_micros_price',
          message: `PLU ${recipe.plu}: Micros price/definition match is ambiguous.`,
        })
      } else {
        exceptionMessages.push('No Micros Menu Item Master match for this PLU.')
        issues.push({
          externalPlu: recipe.plu,
          severity: 'item_exception',
          issueType: 'missing_micros_match',
          message: `PLU ${recipe.plu}: No Micros Menu Item Master match for this PLU.`,
        })
      }
    } else if (ambiguous || match.priceAmbiguous) {
      included = false
      exceptionMessages.push('Micros selling price is ambiguous.')
      issues.push({
        externalPlu: recipe.plu,
        severity: 'item_exception',
        issueType: 'ambiguous_micros_price',
        message: `PLU ${recipe.plu}: Micros selling price is ambiguous.`,
      })
    } else if (match.missingPrice || match.sellingPriceIncVat == null) {
      included = false
      exceptionMessages.push('Micros selling price is missing or invalid.')
      issues.push({
        externalPlu: recipe.plu,
        severity: 'item_exception',
        issueType: 'missing_micros_price',
        message: `PLU ${recipe.plu}: Micros selling price is missing or invalid.`,
      })
    }

    // Description / FnbShop selling-price / Main Menu Level 0 mismatches are tolerated
    // (no issue raised; FnbShop-present items remain in the dataset when otherwise valid).

    if (included) matchedCount++
    else excludedExceptionCount++

    observations.push({
      externalPlu: recipe.plu,
      fnbshopDescription: recipe.description,
      microsDescription: match?.description ?? null,
      costExVat: recipe.costExVat,
      sellingPriceIncVat: match?.sellingPriceIncVat ?? null,
      fnbshopSellingPriceIncVat: recipe.sellingPriceIncVat,
      recipeVolumeMl: classification.recipeVolumeMl,
      packageVolumeMl: classification.packageVolumeMl,
      itemType: classification.itemType,
      microsMainMenuLevel: match?.mainMenuLevel ?? null,
      ingredientDescription: ingredient?.description ?? null,
      includedForPricing: included,
    })
  }

  // Micros-only wine-range handling
  let ignoredMicrosOnlyCount = 0
  let informationalIssueCount = 0
  const fnbPlus = new Set(wineRecipes.map((r) => r.plu))

  for (const [plu, matches] of microsIndex.byPlu.entries()) {
    if (fnbPlus.has(plu)) continue
    for (const item of matches) {
      const name = item.description || ''
      if (isStructuralHeadingName(name)) {
        ignoredMicrosOnlyCount++
        continue
      }
      if (isMicrosRcItem(name)) {
        ignoredMicrosOnlyCount++
        continue
      }
      if (isMainMenuLevelZero(item.mainMenuLevel)) {
        ignoredMicrosOnlyCount++
        continue
      }
      if (isMainMenuLevelActiveLooking(item.mainMenuLevel)) {
        informationalIssueCount++
        issues.push({
          externalPlu: plu,
          severity: 'informational',
          issueType: 'micros_only_active',
          message: `Micros-only PLU ${plu} (${name}) has active-looking Main Menu Level ${item.mainMenuLevel} and was not included automatically.`,
        })
        continue
      }
      // Other unexpected levels: treat as ignored with an informational note
      ignoredMicrosOnlyCount++
      informationalIssueCount++
      issues.push({
        externalPlu: plu,
        severity: 'informational',
        issueType: 'micros_only_active',
        message: `Micros-only PLU ${plu} (${name}) with Main Menu Level ${item.mainMenuLevel || '(empty)'} was not included automatically.`,
      })
    }
  }

  const summary: PricingImportSummary = {
    fnbshopWineRecipeCount: wineRecipes.length,
    fullBottleCount,
    partialServeCount,
    matchedCount,
    excludedExceptionCount,
    ignoredMicrosOnlyCount,
    informationalIssueCount,
  }

  const sourceFilenames = {
    fnbshop_recipe_detail: files.filenames.fnbshopRecipeDetail,
    micros_menu_item_master: files.filenames.microsMenuItemMaster,
    micros_menu_item_definition: files.filenames.microsMenuItemDefinition,
    micros_menu_item_price: files.filenames.microsMenuItemPrice,
  }

  const commitPayload = {
    source_system: 'lime_wood_v1',
    source_filenames: sourceFilenames,
    summary: {
      fnbshop_wine_recipe_count: summary.fnbshopWineRecipeCount,
      full_bottle_count: summary.fullBottleCount,
      partial_serve_count: summary.partialServeCount,
      matched_count: summary.matchedCount,
      excluded_exception_count: summary.excludedExceptionCount,
      ignored_micros_only_count: summary.ignoredMicrosOnlyCount,
      informational_issue_count: summary.informationalIssueCount,
    },
    observations: observations.map((o) => ({
      external_plu: o.externalPlu,
      fnbshop_description: o.fnbshopDescription,
      micros_description: o.microsDescription,
      cost_ex_vat: o.costExVat == null ? '' : String(o.costExVat),
      selling_price_inc_vat: o.sellingPriceIncVat == null ? '' : String(o.sellingPriceIncVat),
      fnbshop_selling_price_inc_vat:
        o.fnbshopSellingPriceIncVat == null ? '' : String(o.fnbshopSellingPriceIncVat),
      recipe_volume_ml: o.recipeVolumeMl == null ? '' : String(o.recipeVolumeMl),
      package_volume_ml: o.packageVolumeMl == null ? '' : String(o.packageVolumeMl),
      item_type: o.itemType ?? '',
      micros_main_menu_level: o.microsMainMenuLevel ?? '',
      ingredient_description: o.ingredientDescription,
      included_for_pricing: o.includedForPricing,
    })),
    issues: issues.map((issue) => ({
      external_plu: issue.externalPlu,
      severity: issue.severity,
      issue_type: issue.issueType,
      message: issue.message,
    })),
  }

  return {
    validation: {
      ok: true,
      sourceFilenames,
      summary,
      issues,
      observationCount: observations.length,
    },
    observations,
    commitPayload,
  }
}
