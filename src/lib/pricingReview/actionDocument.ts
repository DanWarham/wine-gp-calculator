/**
 * Action Document builders for completed Pricing Reviews (Stage 6C).
 * Operational checklist — not an analytical report.
 */

import { sortReviewItemsByPlu } from '@/lib/pricingReview/costChangeReview'
import type {
  PricingReviewDecision,
  PricingReviewItem,
  PricingReviewType,
} from '@/types/pricingReviews'

export interface ActionDocumentPriceChange {
  plu: string
  wine: string
  currentPriceIncVat: number
  proposedPriceIncVat: number
  checklist: ['Update Micros', 'Update Wine List']
}

export interface ActionDocumentDelist {
  plu: string
  wine: string
  currentPriceIncVat: number
  checklist: ['Archive on FnbShop', 'Archive on Micros', 'Remove from Wine List']
}

export interface ActionDocumentSummary {
  priceChangeCount: number
  delistCount: number
  noActionCount: number
}

export interface ActionDocument {
  reviewType: PricingReviewType
  reviewDate: string
  pricingDataImportDate: string | null
  configurationName: string | null
  summary: ActionDocumentSummary
  priceChanges: ActionDocumentPriceChange[]
  delists: ActionDocumentDelist[]
  hasActionableDecisions: boolean
}

export interface BuildActionDocumentInput {
  reviewType: PricingReviewType
  reviewDate: string
  pricingDataImportDate: string | null
  configurationName: string | null
  items: Array<
    Pick<
      PricingReviewItem,
      | 'externalPlu'
      | 'description'
      | 'currentSellingPriceIncVat'
      | 'decision'
      | 'proposedPriceIncVat'
      | 'systemStatus'
    >
  >
  /** Only completed reviews may produce the final action document. */
  status: 'draft' | 'completed'
}

const PRICE_CHANGE_CHECKLIST = ['Update Micros', 'Update Wine List'] as const
const DELIST_CHECKLIST = [
  'Archive on FnbShop',
  'Archive on Micros',
  'Remove from Wine List',
] as const

function wineLabel(description: string | null, plu: string): string {
  const trimmed = description?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : `PLU ${plu}`
}

function countDecision(
  items: BuildActionDocumentInput['items'],
  decision: PricingReviewDecision
): number {
  return items.filter((item) => item.decision === decision).length
}

/**
 * Build printable action-document data from a completed review.
 * Explicit No Action decisions are summarised but omitted from working sections.
 * Automatic No Action Required rows (null decision) are not counted as no-action decisions.
 */
export function buildActionDocument(
  input: BuildActionDocumentInput
): ActionDocument | { ok: false; error: string } {
  if (input.status !== 'completed') {
    return { ok: false, error: 'Only completed reviews can generate an Action Document.' }
  }

  const sorted = sortReviewItemsByPlu(input.items)

  const priceChanges: ActionDocumentPriceChange[] = []
  for (const item of sorted) {
    if (item.decision !== 'change_price') continue
    if (item.proposedPriceIncVat == null || !(item.proposedPriceIncVat > 0)) {
      return {
        ok: false,
        error: `Change Price row PLU ${item.externalPlu} is missing a proposed price.`,
      }
    }
    priceChanges.push({
      plu: item.externalPlu,
      wine: wineLabel(item.description, item.externalPlu),
      currentPriceIncVat: item.currentSellingPriceIncVat,
      proposedPriceIncVat: item.proposedPriceIncVat,
      checklist: [...PRICE_CHANGE_CHECKLIST],
    })
  }

  const delists: ActionDocumentDelist[] = sorted
    .filter((item) => item.decision === 'delist')
    .map((item) => ({
      plu: item.externalPlu,
      wine: wineLabel(item.description, item.externalPlu),
      currentPriceIncVat: item.currentSellingPriceIncVat,
      checklist: [...DELIST_CHECKLIST],
    }))

  const summary: ActionDocumentSummary = {
    priceChangeCount: priceChanges.length,
    delistCount: delists.length,
    noActionCount: countDecision(sorted, 'no_action'),
  }

  return {
    reviewType: input.reviewType,
    reviewDate: input.reviewDate,
    pricingDataImportDate: input.pricingDataImportDate,
    configurationName: input.configurationName,
    summary,
    priceChanges,
    delists,
    hasActionableDecisions: priceChanges.length > 0 || delists.length > 0,
  }
}

export function reviewTypeLabel(reviewType: PricingReviewType): string {
  if (reviewType === 'cost_change') return 'Cost Change Review'
  return 'Full Pricing Review'
}
