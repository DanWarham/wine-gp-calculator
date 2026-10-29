/** Canonical Pricing Review domain types (Stage 6B Cost Change Review). */

import type { PricingConfigurationSnapshot } from '@/types/pricingConfigurations'

export type PricingReviewType = 'cost_change'

export type PricingReviewStatus = 'draft' | 'completed'

export type PricingReviewSystemStatus = 'requires_attention' | 'no_action_required'

export type PricingReviewDecision = 'change_price' | 'delist' | 'no_action'

export const DEFAULT_COST_CHANGE_TOLERANCE_GP_POINTS = 1.0

export interface PricingReviewPresenceItem {
  pricingItemId: string
  externalPlu: string
  description: string | null
  costExVat: number | null
  sellingPriceIncVat: number | null
}

export interface PricingReviewPresenceSummary {
  newItems: PricingReviewPresenceItem[]
  missingItems: PricingReviewPresenceItem[]
}

export interface PricingReviewItem {
  id: string
  reviewId: string
  pricingItemId: string
  externalPlu: string
  description: string | null
  bottleSizeMl: number
  previousCostExVat: number
  currentCostExVat: number
  currentSellingPriceIncVat: number
  oldGp: number
  currentGp: number
  targetGp: number
  recommendedPriceIncVat: number
  systemStatus: PricingReviewSystemStatus
  decision: PricingReviewDecision | null
  proposedPriceIncVat: number | null
  resultingGp: number | null
  previousChangePricePending: boolean
  previousProposedPriceIncVat: number | null
  previousDelistPending: boolean
  createdAt: string
  updatedAt: string
}

export interface PricingReview {
  id: string
  reviewType: PricingReviewType
  currentImportId: string
  previousImportId: string
  pricingConfigurationSnapshotId: string
  toleranceGpPoints: number
  status: PricingReviewStatus
  presenceSummary: PricingReviewPresenceSummary
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface PricingReviewWithItems extends PricingReview {
  items: PricingReviewItem[]
  snapshot: PricingConfigurationSnapshot | null
}

export interface PricingReviewListItem {
  id: string
  reviewType: PricingReviewType
  status: PricingReviewStatus
  currentImportId: string
  previousImportId: string
  toleranceGpPoints: number
  createdAt: string
  completedAt: string | null
  itemCount: number
  requiresAttentionCount: number
  undecidedAttentionCount: number
}
