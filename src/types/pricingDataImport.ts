/** Canonical pricing data import domain types (Stage 6A). */

export type PricingItemType = 'full_bottle' | 'partial_serve'

export type PricingImportIssueSeverity = 'item_exception' | 'informational'

export type PricingImportIssueType =
  | 'missing_micros_match'
  | 'missing_micros_price'
  | 'ambiguous_micros_price'
  | 'invalid_cost'
  | 'unresolved_package_size'
  | 'duplicate_plu'
  | 'micros_only_active'
  | 'structural_source_failure'

export interface PricingImportSummary {
  fnbshopWineRecipeCount: number
  fullBottleCount: number
  partialServeCount: number
  matchedCount: number
  excludedExceptionCount: number
  ignoredMicrosOnlyCount: number
  informationalIssueCount: number
}

export interface PricingImportIssue {
  externalPlu: string | null
  severity: PricingImportIssueSeverity
  issueType: PricingImportIssueType | string
  message: string
}

export interface PricingObservationDraft {
  externalPlu: string
  fnbshopDescription: string | null
  microsDescription: string | null
  costExVat: number | null
  sellingPriceIncVat: number | null
  fnbshopSellingPriceIncVat: number | null
  recipeVolumeMl: number | null
  packageVolumeMl: number | null
  itemType: PricingItemType | null
  microsMainMenuLevel: string | null
  ingredientDescription: string | null
  includedForPricing: boolean
}

export interface PricingDataImportResult {
  importId: string
  importedAt: string
  status: 'completed'
  sourceFilenames: Record<string, string>
  summary: PricingImportSummary
  issues: PricingImportIssue[]
}

export interface PricingDataImportPreview {
  ok: true
  sourceFilenames: Record<string, string>
  summary: PricingImportSummary
  issues: PricingImportIssue[]
  /** Observations prepared for persistence (not yet saved). */
  observationCount: number
}

export interface PricingDataImportBlocked {
  ok: false
  blocked: true
  message: string
  issues: PricingImportIssue[]
}

export type PricingDataImportValidation =
  | PricingDataImportPreview
  | PricingDataImportBlocked

export interface PricingDataImportRow {
  id: string
  user_id: string
  imported_at: string
  status: string
  source_system: string
  source_filenames: Record<string, string>
  fnbshop_wine_recipe_count: number
  full_bottle_count: number
  partial_serve_count: number
  matched_count: number
  excluded_exception_count: number
  ignored_micros_only_count: number
  informational_issue_count: number
}
