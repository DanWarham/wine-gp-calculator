import { supabase } from '@/lib/supabaseClient'
import { fetchAllPagedRows } from '@/lib/supabasePagedSelect'
import {
  calculateCostChangeItem,
  canCompleteReview,
  detectCostChanges,
  reclassifyItemStatus,
  resultingGpForProposedPrice,
  selectLatestAndPreviousImports,
  sortReviewItemsByPlu,
  type PreviousReviewDecisionHint,
  type ReviewObservation,
} from '@/lib/pricingReview/costChangeReview'
import {
  calculateFullReviewItem,
  selectFullReviewObservations,
  selectLatestCompletedImport,
} from '@/lib/pricingReview/fullPricingReview'
import {
  buildActionDocument,
  type ActionDocument,
} from '@/lib/pricingReview/actionDocument'
import {
  capturePricingConfigurationSnapshot,
  getOrCreateCurrentPricingConfiguration,
  rowToSnapshot,
  type PricingConfigurationSnapshotRow,
} from '@/lib/pricingConfigurationStore'
import {
  getPreviousCompletedPricingDataImport,
  listPricingDataImports,
} from '@/lib/pricingDataImportStore'

/** Batch size for append_pricing_review_items (keeps RPC payloads manageable). */
const REVIEW_ITEM_APPEND_BATCH = 200
import type {
  PricingReview,
  PricingReviewDecision,
  PricingReviewItem,
  PricingReviewListItem,
  PricingReviewPresenceSummary,
  PricingReviewStatus,
  PricingReviewSystemStatus,
  PricingReviewType,
  PricingReviewWithItems,
} from '@/types/pricingReviews'
import { DEFAULT_PRICING_REVIEW_TOLERANCE_GP_POINTS } from '@/types/pricingReviews'

export type PricingReviewStoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

interface PricingReviewRow {
  id: string
  user_id: string
  review_type: string
  current_import_id: string
  previous_import_id: string | null
  pricing_configuration_snapshot_id: string
  tolerance_gp_points: number | string
  status: string
  presence_summary: unknown
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface PricingReviewItemRow {
  id: string
  review_id: string
  user_id: string
  pricing_item_id: string
  external_plu: string
  description: string | null
  bottle_size_ml: number | string
  previous_cost_ex_vat: number | string
  current_cost_ex_vat: number | string
  current_selling_price_inc_vat: number | string
  old_gp: number | string
  current_gp: number | string
  target_gp: number | string
  recommended_price_inc_vat: number | string
  system_status: string
  decision: string | null
  proposed_price_inc_vat: number | string | null
  resulting_gp: number | string | null
  previous_change_price_pending: boolean
  previous_proposed_price_inc_vat: number | string | null
  previous_delist_pending: boolean
  created_at: string
  updated_at: string
}

interface ObservationRow {
  pricing_item_id: string
  external_plu: string
  fnbshop_description: string | null
  micros_description: string | null
  cost_ex_vat: number | string | null
  selling_price_inc_vat: number | string | null
  package_volume_ml: number | string | null
  item_type: string | null
  included_for_pricing: boolean
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function parsePresenceSummary(raw: unknown): PricingReviewPresenceSummary {
  const empty: PricingReviewPresenceSummary = { newItems: [], missingItems: [] }
  if (!raw || typeof raw !== 'object') return empty
  const obj = raw as Record<string, unknown>
  const mapItems = (list: unknown) => {
    if (!Array.isArray(list)) return []
    return list.map((item) => {
      const row = item as Record<string, unknown>
      return {
        pricingItemId: String(row.pricingItemId ?? row.pricing_item_id ?? ''),
        externalPlu: String(row.externalPlu ?? row.external_plu ?? ''),
        description: (row.description as string | null) ?? null,
        costExVat: toNumberOrNull(row.costExVat as number | string | null ?? row.cost_ex_vat as number | string | null),
        sellingPriceIncVat: toNumberOrNull(
          row.sellingPriceIncVat as number | string | null ??
            row.selling_price_inc_vat as number | string | null
        ),
      }
    })
  }
  return {
    newItems: mapItems(obj.newItems ?? obj.new_items),
    missingItems: mapItems(obj.missingItems ?? obj.missing_items),
  }
}

function isSystemStatus(value: string): value is PricingReviewSystemStatus {
  return value === 'requires_attention' || value === 'no_action_required'
}

function isDecision(value: string | null): value is PricingReviewDecision | null {
  return (
    value == null ||
    value === 'change_price' ||
    value === 'delist' ||
    value === 'no_action'
  )
}

function isReviewType(value: string): value is PricingReviewType {
  return value === 'cost_change' || value === 'full'
}

function rowToReview(row: PricingReviewRow): PricingReview {
  if (!isReviewType(row.review_type)) {
    throw new Error(`Unsupported review type: ${row.review_type}`)
  }
  if (row.status !== 'draft' && row.status !== 'completed') {
    throw new Error(`Invalid review status: ${row.status}`)
  }
  if (row.review_type === 'cost_change' && row.previous_import_id == null) {
    throw new Error('Cost Change Review is missing previous_import_id.')
  }
  if (row.review_type === 'full' && row.previous_import_id != null) {
    throw new Error('Full Pricing Review must not have previous_import_id.')
  }
  return {
    id: row.id,
    reviewType: row.review_type,
    currentImportId: row.current_import_id,
    previousImportId: row.previous_import_id,
    pricingConfigurationSnapshotId: row.pricing_configuration_snapshot_id,
    toleranceGpPoints: toNumber(row.tolerance_gp_points),
    status: row.status,
    presenceSummary: parsePresenceSummary(row.presence_summary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function rowToReviewItem(row: PricingReviewItemRow): PricingReviewItem {
  if (!isSystemStatus(row.system_status)) {
    throw new Error(`Invalid system status: ${row.system_status}`)
  }
  if (!isDecision(row.decision)) {
    throw new Error(`Invalid decision: ${row.decision}`)
  }
  return {
    id: row.id,
    reviewId: row.review_id,
    pricingItemId: row.pricing_item_id,
    externalPlu: row.external_plu,
    description: row.description,
    bottleSizeMl: toNumber(row.bottle_size_ml),
    previousCostExVat: toNumber(row.previous_cost_ex_vat),
    currentCostExVat: toNumber(row.current_cost_ex_vat),
    currentSellingPriceIncVat: toNumber(row.current_selling_price_inc_vat),
    oldGp: toNumber(row.old_gp),
    currentGp: toNumber(row.current_gp),
    targetGp: toNumber(row.target_gp),
    recommendedPriceIncVat: toNumber(row.recommended_price_inc_vat),
    systemStatus: row.system_status,
    decision: row.decision,
    proposedPriceIncVat: toNumberOrNull(row.proposed_price_inc_vat),
    resultingGp: toNumberOrNull(row.resulting_gp),
    previousChangePricePending: row.previous_change_price_pending,
    previousProposedPriceIncVat: toNumberOrNull(row.previous_proposed_price_inc_vat),
    previousDelistPending: row.previous_delist_pending,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function observationFromRow(row: ObservationRow): ReviewObservation {
  return {
    pricingItemId: row.pricing_item_id,
    externalPlu: row.external_plu,
    description: row.fnbshop_description ?? row.micros_description,
    costExVat: toNumberOrNull(row.cost_ex_vat),
    sellingPriceIncVat: toNumberOrNull(row.selling_price_inc_vat),
    packageVolumeMl: toNumberOrNull(row.package_volume_ml),
    itemType:
      row.item_type === 'full_bottle' || row.item_type === 'partial_serve'
        ? row.item_type
        : null,
    includedForPricing: Boolean(row.included_for_pricing),
  }
}

async function loadObservations(
  importId: string,
  userId: string
): Promise<PricingReviewStoreResult<ReviewObservation[]>> {
  // Paginate past PostgREST max_rows (1000) — silent truncation caused ~999 Full Reviews.
  const paged = await fetchAllPagedRows<ObservationRow>((from, to) =>
    supabase
      .from('pricing_observations')
      .select(
        'pricing_item_id, external_plu, fnbshop_description, micros_description, cost_ex_vat, selling_price_inc_vat, package_volume_ml, item_type, included_for_pricing'
      )
      .eq('import_id', importId)
      .eq('user_id', userId)
      .order('external_plu', { ascending: true })
      .range(from, to)
  )

  if (!paged.ok) return paged
  return {
    ok: true,
    data: paged.data.map(observationFromRow),
  }
}

async function loadReviewItemRows(
  reviewId: string,
  userId: string
): Promise<PricingReviewStoreResult<PricingReviewItemRow[]>> {
  const paged = await fetchAllPagedRows<PricingReviewItemRow>((from, to) =>
    supabase
      .from('pricing_review_items')
      .select('*')
      .eq('review_id', reviewId)
      .eq('user_id', userId)
      .order('external_plu', { ascending: true })
      .range(from, to)
  )
  return paged
}

async function appendReviewItemBatches(
  reviewId: string,
  items: Record<string, unknown>[]
): Promise<PricingReviewStoreResult<{ inserted: number }>> {
  let inserted = 0
  for (let i = 0; i < items.length; i += REVIEW_ITEM_APPEND_BATCH) {
    const batch = items.slice(i, i + REVIEW_ITEM_APPEND_BATCH)
    const { data, error } = await supabase.rpc('append_pricing_review_items', {
      p_review_id: reviewId,
      p_items: batch,
    })
    if (error) return { ok: false, error: error.message }
    inserted += Number((data as { inserted?: number } | null)?.inserted ?? batch.length)
  }
  return { ok: true, data: { inserted } }
}

async function loadPreviousCompletedDecisions(
  userId: string,
  beforeCreatedAt: string
): Promise<PricingReviewStoreResult<PreviousReviewDecisionHint[]>> {
  // Include both cost_change and full completed reviews — unresolved actions
  // apply across review types.
  const { data: reviews, error: reviewError } = await supabase
    .from('pricing_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .in('review_type', ['cost_change', 'full'])
    .lt('created_at', beforeCreatedAt)
    .order('created_at', { ascending: false })

  if (reviewError) return { ok: false, error: reviewError.message }
  const reviewIds = (reviews ?? []).map((r) => r.id as string)
  if (reviewIds.length === 0) return { ok: true, data: [] }

  const pagedItems = await fetchAllPagedRows<{
    pricing_item_id: string
    decision: string
    proposed_price_inc_vat: number | string | null
    review_id: string
  }>((from, to) =>
    supabase
      .from('pricing_review_items')
      .select('pricing_item_id, decision, proposed_price_inc_vat, review_id')
      .eq('user_id', userId)
      .in('review_id', reviewIds)
      .in('decision', ['change_price', 'delist'])
      .range(from, to)
  )

  if (!pagedItems.ok) return pagedItems

  // Prefer the most recent completed decision per pricing item.
  const latestByItem = new Map<string, PreviousReviewDecisionHint>()
  const reviewOrder = new Map(reviewIds.map((id, index) => [id, index]))
  const ordered = [...pagedItems.data].sort(
    (a, b) => (reviewOrder.get(a.review_id) ?? 9999) - (reviewOrder.get(b.review_id) ?? 9999)
  )

  for (const row of ordered) {
    if (latestByItem.has(row.pricing_item_id)) continue
    if (row.decision !== 'change_price' && row.decision !== 'delist') continue
    latestByItem.set(row.pricing_item_id, {
      pricingItemId: row.pricing_item_id,
      decision: row.decision,
      proposedPriceIncVat: toNumberOrNull(row.proposed_price_inc_vat),
    })
  }

  return { ok: true, data: [...latestByItem.values()] }
}

export async function listPricingReviews(
  userId: string
): Promise<PricingReviewStoreResult<PricingReviewListItem[]>> {
  const { data, error } = await supabase
    .from('pricing_reviews')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }

  const reviews = (data ?? []) as PricingReviewRow[]
  if (reviews.length === 0) return { ok: true, data: [] }

  const itemRowsPaged = await fetchAllPagedRows<{
    review_id: string
    system_status: string
    decision: string | null
  }>((from, to) =>
    supabase
      .from('pricing_review_items')
      .select('review_id, system_status, decision')
      .eq('user_id', userId)
      .in(
        'review_id',
        reviews.map((r) => r.id)
      )
      .range(from, to)
  )

  if (!itemRowsPaged.ok) return itemRowsPaged
  const itemRows = itemRowsPaged.data

  const stats = new Map<
    string,
    { itemCount: number; requiresAttentionCount: number; undecidedAttentionCount: number }
  >()
  for (const row of itemRows) {
    const reviewId = row.review_id
    const current = stats.get(reviewId) ?? {
      itemCount: 0,
      requiresAttentionCount: 0,
      undecidedAttentionCount: 0,
    }
    current.itemCount += 1
    if (row.system_status === 'requires_attention') {
      current.requiresAttentionCount += 1
      if (row.decision == null) current.undecidedAttentionCount += 1
    }
    stats.set(reviewId, current)
  }

  return {
    ok: true,
    data: reviews.map((row) => {
      const review = rowToReview(row)
      const s = stats.get(review.id) ?? {
        itemCount: 0,
        requiresAttentionCount: 0,
        undecidedAttentionCount: 0,
      }
      return {
        id: review.id,
        reviewType: review.reviewType,
        status: review.status,
        currentImportId: review.currentImportId,
        previousImportId: review.previousImportId,
        toleranceGpPoints: review.toleranceGpPoints,
        createdAt: review.createdAt,
        completedAt: review.completedAt,
        ...s,
      }
    }),
  }
}

export async function getPricingReview(
  reviewId: string,
  userId: string
): Promise<PricingReviewStoreResult<PricingReviewWithItems>> {
  const { data, error } = await supabase
    .from('pricing_reviews')
    .select('*')
    .eq('id', reviewId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Pricing review not found.' }

  const review = rowToReview(data as PricingReviewRow)

  const itemsLoaded = await loadReviewItemRows(reviewId, userId)
  if (!itemsLoaded.ok) return itemsLoaded

  const { data: snapshotRow, error: snapshotError } = await supabase
    .from('pricing_configuration_snapshots')
    .select('*')
    .eq('id', review.pricingConfigurationSnapshotId)
    .eq('user_id', userId)
    .maybeSingle()

  if (snapshotError) return { ok: false, error: snapshotError.message }

  return {
    ok: true,
    data: {
      ...review,
      items: sortReviewItemsByPlu(itemsLoaded.data.map(rowToReviewItem)),
      snapshot: snapshotRow
        ? rowToSnapshot(snapshotRow as PricingConfigurationSnapshotRow)
        : null,
    },
  }
}

export async function findExistingDraftForImports(
  userId: string,
  currentImportId: string,
  previousImportId: string
): Promise<PricingReviewStoreResult<PricingReview | null>> {
  const { data, error } = await supabase
    .from('pricing_reviews')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .eq('review_type', 'cost_change')
    .eq('current_import_id', currentImportId)
    .eq('previous_import_id', previousImportId)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true, data: null }
  return { ok: true, data: rowToReview(data as PricingReviewRow) }
}

export async function findExistingDraftFullReview(
  userId: string,
  currentImportId: string
): Promise<PricingReviewStoreResult<PricingReview | null>> {
  const { data, error } = await supabase
    .from('pricing_reviews')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .eq('review_type', 'full')
    .eq('current_import_id', currentImportId)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true, data: null }
  return { ok: true, data: rowToReview(data as PricingReviewRow) }
}

/**
 * Create a Cost Change Review from the latest two completed imports and Current Pricing.
 */
export async function createCostChangeReview(
  userId: string,
  options?: { toleranceGpPoints?: number }
): Promise<
  PricingReviewStoreResult<{
    reviewId: string
    reusedExistingDraft: boolean
    insufficientImports?: boolean
  }>
> {
  const listed = await listPricingDataImports(userId)
  if (!listed.ok) return { ok: false, error: listed.error }

  const pair = selectLatestAndPreviousImports(listed.data)
  if (!pair) {
    return {
      ok: true,
      data: {
        reviewId: '',
        reusedExistingDraft: false,
        insufficientImports: true,
      },
    }
  }

  const previousCheck = await getPreviousCompletedPricingDataImport(pair.latest.id)
  if (!previousCheck.ok) return { ok: false, error: previousCheck.error }
  if (!previousCheck.data || previousCheck.data.id !== pair.previous.id) {
    return {
      ok: false,
      error: 'Could not resolve the previous completed import for the latest import.',
    }
  }

  const existing = await findExistingDraftForImports(
    userId,
    pair.latest.id,
    pair.previous.id
  )
  if (!existing.ok) return { ok: false, error: existing.error }
  if (existing.data) {
    return {
      ok: true,
      data: { reviewId: existing.data.id, reusedExistingDraft: true },
    }
  }

  const current = await getOrCreateCurrentPricingConfiguration(userId)
  if (!current.ok) return { ok: false, error: current.error }
  if (current.data.rules.length === 0) {
    return {
      ok: false,
      error: 'Current Pricing must have a valid GP rule set before creating a Cost Change Review.',
    }
  }

  const snapshot = await capturePricingConfigurationSnapshot(current.data.id)
  if (!snapshot.ok) return { ok: false, error: snapshot.error }

  const previousObs = await loadObservations(pair.previous.id, userId)
  if (!previousObs.ok) return { ok: false, error: previousObs.error }
  const currentObs = await loadObservations(pair.latest.id, userId)
  if (!currentObs.ok) return { ok: false, error: currentObs.error }

  const detected = detectCostChanges(previousObs.data, currentObs.data)
  const previousDecisions = await loadPreviousCompletedDecisions(
    userId,
    new Date().toISOString()
  )
  if (!previousDecisions.ok) return { ok: false, error: previousDecisions.error }

  const tolerance =
    options?.toleranceGpPoints ?? DEFAULT_PRICING_REVIEW_TOLERANCE_GP_POINTS

  const calculatedItems = []
  for (const pairObs of detected.changed) {
    const calculated = calculateCostChangeItem({
      previous: pairObs.previous,
      current: pairObs.current,
      rules: snapshot.data.rules,
      pricingPolicy: snapshot.data.pricingPolicy,
      toleranceGpPoints: tolerance,
      previousDecisions: previousDecisions.data,
    })
    if ('ok' in calculated && calculated.ok === false) {
      return { ok: false, error: calculated.error }
    }
    calculatedItems.push(calculated as Exclude<typeof calculated, { ok: false; error: string }>)
  }

  const sorted = sortReviewItemsByPlu(calculatedItems)

  const itemPayloads = sorted.map((item) => ({
    pricing_item_id: item.pricingItemId,
    external_plu: item.externalPlu,
    description: item.description ?? '',
    bottle_size_ml: String(item.bottleSizeMl),
    previous_cost_ex_vat: String(item.previousCostExVat),
    current_cost_ex_vat: String(item.currentCostExVat),
    current_selling_price_inc_vat: String(item.currentSellingPriceIncVat),
    old_gp: String(item.oldGp),
    current_gp: String(item.currentGp),
    target_gp: String(item.targetGp),
    recommended_price_inc_vat: String(item.recommendedPriceIncVat),
    system_status: item.systemStatus,
    decision: '',
    proposed_price_inc_vat: '',
    resulting_gp: '',
    previous_change_price_pending: item.previousChangePricePending,
    previous_proposed_price_inc_vat:
      item.previousProposedPriceIncVat == null
        ? ''
        : String(item.previousProposedPriceIncVat),
    previous_delist_pending: item.previousDelistPending,
  }))

  // Create draft shell first, then append items in pages (avoids PostgREST/payload caps).
  const payload = {
    review_type: 'cost_change',
    current_import_id: pair.latest.id,
    previous_import_id: pair.previous.id,
    pricing_configuration_snapshot_id: snapshot.data.id,
    tolerance_gp_points: tolerance,
    presence_summary: {
      new_items: detected.presence.newItems.map((item) => ({
        pricing_item_id: item.pricingItemId,
        external_plu: item.externalPlu,
        description: item.description,
        cost_ex_vat: item.costExVat,
        selling_price_inc_vat: item.sellingPriceIncVat,
      })),
      missing_items: detected.presence.missingItems.map((item) => ({
        pricing_item_id: item.pricingItemId,
        external_plu: item.externalPlu,
        description: item.description,
        cost_ex_vat: item.costExVat,
        selling_price_inc_vat: item.sellingPriceIncVat,
      })),
    },
    items: [],
  }

  const { data, error } = await supabase.rpc('commit_cost_change_review', {
    p_payload: payload,
  })

  if (error) return { ok: false, error: error.message }

  const result = data as { review_id: string }
  const appended = await appendReviewItemBatches(result.review_id, itemPayloads)
  if (!appended.ok) return { ok: false, error: appended.error }

  return {
    ok: true,
    data: { reviewId: result.review_id, reusedExistingDraft: false },
  }
}

/**
 * Create a Full Pricing Review from the latest completed import and Current Pricing.
 */
export async function createFullPricingReview(
  userId: string,
  options?: { toleranceGpPoints?: number }
): Promise<
  PricingReviewStoreResult<{
    reviewId: string
    reusedExistingDraft: boolean
    insufficientImports?: boolean
  }>
> {
  const listed = await listPricingDataImports(userId)
  if (!listed.ok) return { ok: false, error: listed.error }

  const latest = selectLatestCompletedImport(listed.data)
  if (!latest) {
    return {
      ok: true,
      data: {
        reviewId: '',
        reusedExistingDraft: false,
        insufficientImports: true,
      },
    }
  }

  const existing = await findExistingDraftFullReview(userId, latest.id)
  if (!existing.ok) return { ok: false, error: existing.error }
  if (existing.data) {
    return {
      ok: true,
      data: { reviewId: existing.data.id, reusedExistingDraft: true },
    }
  }

  const current = await getOrCreateCurrentPricingConfiguration(userId)
  if (!current.ok) return { ok: false, error: current.error }
  if (current.data.rules.length === 0) {
    return {
      ok: false,
      error: 'Current Pricing must have a valid GP rule set before creating a Full Pricing Review.',
    }
  }

  const snapshot = await capturePricingConfigurationSnapshot(current.data.id)
  if (!snapshot.ok) return { ok: false, error: snapshot.error }

  const currentObs = await loadObservations(latest.id, userId)
  if (!currentObs.ok) return { ok: false, error: currentObs.error }

  const eligible = selectFullReviewObservations(currentObs.data)
  const previousDecisions = await loadPreviousCompletedDecisions(
    userId,
    new Date().toISOString()
  )
  if (!previousDecisions.ok) return { ok: false, error: previousDecisions.error }

  const tolerance =
    options?.toleranceGpPoints ?? DEFAULT_PRICING_REVIEW_TOLERANCE_GP_POINTS

  const calculatedItems = []
  for (const observation of eligible) {
    const calculated = calculateFullReviewItem({
      current: observation,
      rules: snapshot.data.rules,
      pricingPolicy: snapshot.data.pricingPolicy,
      toleranceGpPoints: tolerance,
      previousDecisions: previousDecisions.data,
    })
    if ('ok' in calculated && calculated.ok === false) {
      return { ok: false, error: calculated.error }
    }
    calculatedItems.push(calculated as Exclude<typeof calculated, { ok: false; error: string }>)
  }

  const sorted = sortReviewItemsByPlu(calculatedItems)

  const itemPayloads = sorted.map((item) => ({
    pricing_item_id: item.pricingItemId,
    external_plu: item.externalPlu,
    description: item.description ?? '',
    bottle_size_ml: String(item.bottleSizeMl),
    current_cost_ex_vat: String(item.currentCostExVat),
    current_selling_price_inc_vat: String(item.currentSellingPriceIncVat),
    current_gp: String(item.currentGp),
    target_gp: String(item.targetGp),
    recommended_price_inc_vat: String(item.recommendedPriceIncVat),
    system_status: item.systemStatus,
    decision: '',
    proposed_price_inc_vat: '',
    resulting_gp: '',
    previous_change_price_pending: item.previousChangePricePending,
    previous_proposed_price_inc_vat:
      item.previousProposedPriceIncVat == null
        ? ''
        : String(item.previousProposedPriceIncVat),
    previous_delist_pending: item.previousDelistPending,
  }))

  const payload = {
    review_type: 'full',
    current_import_id: latest.id,
    pricing_configuration_snapshot_id: snapshot.data.id,
    tolerance_gp_points: tolerance,
    presence_summary: { new_items: [], missing_items: [] },
    items: [],
  }

  const { data, error } = await supabase.rpc('commit_full_pricing_review', {
    p_payload: payload,
  })

  if (error) return { ok: false, error: error.message }

  const result = data as { review_id: string }
  const appended = await appendReviewItemBatches(result.review_id, itemPayloads)
  if (!appended.ok) return { ok: false, error: appended.error }

  return {
    ok: true,
    data: { reviewId: result.review_id, reusedExistingDraft: false },
  }
}

export async function getPricingReviewActionDocument(
  reviewId: string,
  userId: string
): Promise<PricingReviewStoreResult<ActionDocument>> {
  const loaded = await getPricingReview(reviewId, userId)
  if (!loaded.ok) return { ok: false, error: loaded.error }

  const review = loaded.data
  if (review.status !== 'completed') {
    return { ok: false, error: 'Only completed reviews can generate an Action Document.' }
  }

  const { data: importRow, error: importError } = await supabase
    .from('pricing_data_imports')
    .select('imported_at')
    .eq('id', review.currentImportId)
    .eq('user_id', userId)
    .maybeSingle()

  if (importError) return { ok: false, error: importError.message }

  const built = buildActionDocument({
    reviewType: review.reviewType,
    reviewDate: review.completedAt ?? review.createdAt,
    pricingDataImportDate: (importRow?.imported_at as string | undefined) ?? null,
    configurationName: review.snapshot?.sourceConfigurationName ?? null,
    items: review.items,
    status: review.status,
  })

  if ('ok' in built && built.ok === false) {
    return { ok: false, error: built.error }
  }

  return { ok: true, data: built as ActionDocument }
}

export async function updateReviewTolerance(
  reviewId: string,
  userId: string,
  toleranceGpPoints: number
): Promise<PricingReviewStoreResult<PricingReviewWithItems>> {
  if (!Number.isFinite(toleranceGpPoints) || toleranceGpPoints < 0) {
    return { ok: false, error: 'Tolerance must be a non-negative number.' }
  }

  const loaded = await getPricingReview(reviewId, userId)
  if (!loaded.ok) return loaded
  if (loaded.data.status !== 'draft') {
    return { ok: false, error: 'Tolerance can only be changed on draft reviews.' }
  }

  const now = new Date().toISOString()
  const { error: reviewError } = await supabase
    .from('pricing_reviews')
    .update({
      tolerance_gp_points: toleranceGpPoints,
      updated_at: now,
    })
    .eq('id', reviewId)
    .eq('user_id', userId)
    .eq('status', 'draft')

  if (reviewError) return { ok: false, error: reviewError.message }

  for (const item of loaded.data.items) {
    const systemStatus = reclassifyItemStatus(
      item.currentGp,
      item.targetGp,
      toleranceGpPoints
    )
    const clearDecision = systemStatus === 'no_action_required'
    const { error: itemError } = await supabase
      .from('pricing_review_items')
      .update({
        system_status: systemStatus,
        decision: clearDecision ? null : item.decision,
        proposed_price_inc_vat: clearDecision
          ? null
          : item.decision === 'change_price'
            ? item.proposedPriceIncVat
            : null,
        resulting_gp: clearDecision
          ? null
          : item.decision === 'change_price'
            ? item.resultingGp
            : null,
        updated_at: now,
      })
      .eq('id', item.id)
      .eq('user_id', userId)

    if (itemError) return { ok: false, error: itemError.message }
  }

  return getPricingReview(reviewId, userId)
}

export async function saveReviewItemDecision(
  reviewId: string,
  itemId: string,
  userId: string,
  input: {
    decision: PricingReviewDecision | null
    proposedPriceIncVat?: number | null
  }
): Promise<PricingReviewStoreResult<PricingReviewItem>> {
  const loaded = await getPricingReview(reviewId, userId)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (loaded.data.status !== 'draft') {
    return { ok: false, error: 'Decisions can only be changed on draft reviews.' }
  }

  const item = loaded.data.items.find((row) => row.id === itemId)
  if (!item) return { ok: false, error: 'Review item not found.' }

  if (item.systemStatus === 'no_action_required' && input.decision != null) {
    return {
      ok: false,
      error: 'No Action Required rows do not need a manual decision.',
    }
  }

  let proposedPriceIncVat: number | null = null
  let resultingGp: number | null = null

  if (input.decision === 'change_price') {
    const proposed =
      input.proposedPriceIncVat ?? item.proposedPriceIncVat ?? item.recommendedPriceIncVat
    if (proposed == null || !(proposed > 0)) {
      return { ok: false, error: 'Proposed price must be a positive number.' }
    }
    const vatRate = loaded.data.snapshot?.pricingPolicy.vatRate
    if (vatRate == null) {
      return { ok: false, error: 'Pricing configuration snapshot is required for Change Price.' }
    }
    const gp = resultingGpForProposedPrice(item.currentCostExVat, proposed, vatRate)
    if (gp == null) {
      return { ok: false, error: 'Unable to calculate resulting GP for the proposed price.' }
    }
    proposedPriceIncVat = proposed
    resultingGp = gp
  } else if (input.decision === 'delist' || input.decision === 'no_action') {
    proposedPriceIncVat = null
    resultingGp = null
  } else {
    proposedPriceIncVat = null
    resultingGp = null
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('pricing_review_items')
    .update({
      decision: input.decision,
      proposed_price_inc_vat: proposedPriceIncVat,
      resulting_gp: resultingGp,
      updated_at: now,
    })
    .eq('id', itemId)
    .eq('review_id', reviewId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Failed to save decision.' }
  }

  // Touch parent review updated_at for draft persistence visibility.
  await supabase
    .from('pricing_reviews')
    .update({ updated_at: now })
    .eq('id', reviewId)
    .eq('user_id', userId)
    .eq('status', 'draft')

  return { ok: true, data: rowToReviewItem(data as PricingReviewItemRow) }
}

export async function completePricingReview(
  reviewId: string,
  userId: string
): Promise<PricingReviewStoreResult<{ reviewId: string; status: PricingReviewStatus; completedAt: string }>> {
  const loaded = await getPricingReview(reviewId, userId)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (loaded.data.status !== 'draft') {
    return { ok: false, error: 'Only draft reviews can be completed.' }
  }
  if (!canCompleteReview(loaded.data.items)) {
    return {
      ok: false,
      error: 'All Requires Attention rows must have a decision before completion.',
    }
  }

  const { data, error } = await supabase.rpc('complete_pricing_review', {
    p_review_id: reviewId,
  })

  if (error) return { ok: false, error: error.message }

  const result = data as { review_id: string; status: string; completed_at: string }
  return {
    ok: true,
    data: {
      reviewId: result.review_id,
      status: result.status as PricingReviewStatus,
      completedAt: result.completed_at,
    },
  }
}

export { canCompleteReview, resultingGpForProposedPrice }
