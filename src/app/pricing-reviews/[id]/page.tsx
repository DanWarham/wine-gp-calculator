'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  CostChangeReviewTable,
  type ReviewDecisionFilter,
  type ReviewWorkingFilter,
} from '@/components/pricing/CostChangeReviewTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toast-provider'
import { reviewTypeLabel } from '@/lib/pricingReview/actionDocument'
import { canCompleteReview } from '@/lib/pricingReview/costChangeReview'
import {
  completePricingReview,
  getPricingReview,
  saveReviewItemDecision,
  updateReviewTolerance,
} from '@/lib/pricingReviewStore'
import { supabase } from '@/lib/supabaseClient'
import type { PricingReviewDecision, PricingReviewWithItems } from '@/types/pricingReviews'

export default function PricingReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const reviewId = params.id
  const router = useRouter()
  const { showToast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [review, setReview] = useState<PricingReviewWithItems | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [workingFilter, setWorkingFilter] = useState<ReviewWorkingFilter>('requires_attention')
  const [decisionFilter, setDecisionFilter] = useState<ReviewDecisionFilter>('all')
  const [search, setSearch] = useState('')
  const [toleranceInput, setToleranceInput] = useState('1')

  const load = useCallback(
    async (uid: string, id: string) => {
      const result = await getPricingReview(id, uid)
      if (!result.ok) {
        setError(result.error)
        setReview(null)
        return
      }
      setReview(result.data)
      setToleranceInput(String(result.data.toleranceGpPoints))
      setError(null)
    },
    []
  )

  useEffect(() => {
    const boot = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/welcome')
        return
      }
      setUserId(session.user.id)
      await load(session.user.id, reviewId)
      setLoading(false)
    }
    void boot()
  }, [load, reviewId, router])

  const undecidedCount = useMemo(
    () =>
      review?.items.filter(
        (item) => item.systemStatus === 'requires_attention' && item.decision == null
      ).length ?? 0,
    [review]
  )

  const onDecision = async (
    itemId: string,
    decision: PricingReviewDecision | null,
    proposedPriceIncVat?: number | null
  ) => {
    if (!userId || !review || review.status !== 'draft') return
    setBusyItemId(itemId)
    const saved = await saveReviewItemDecision(review.id, itemId, userId, {
      decision,
      proposedPriceIncVat,
    })
    setBusyItemId(null)
    if (!saved.ok) {
      showToast(saved.error)
      return
    }
    await load(userId, review.id)
  }

  const onSaveTolerance = async () => {
    if (!userId || !review || review.status !== 'draft') return
    const value = Number(toleranceInput)
    if (!Number.isFinite(value) || value < 0) {
      showToast('Tolerance must be a non-negative number.')
      return
    }
    setBusy(true)
    const updated = await updateReviewTolerance(review.id, userId, value)
    setBusy(false)
    if (!updated.ok) {
      showToast(updated.error)
      return
    }
    setReview(updated.data)
    showToast('Tolerance updated.')
  }

  const onComplete = async () => {
    if (!userId || !review) return
    if (!canCompleteReview(review.items)) {
      showToast('All Requires Attention rows must have a decision before completion.')
      return
    }
    setBusy(true)
    const completed = await completePricingReview(review.id, userId)
    setBusy(false)
    if (!completed.ok) {
      showToast(completed.error)
      return
    }
    showToast('Review completed.')
    await load(userId, review.id)
  }

  if (loading) {
    return (
      <div className="p-6">
        <AppNav active="pricing-reviews" />
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <AppNav active="pricing-reviews" />
        <p className="text-sm text-red-600">{error ?? 'Review not found.'}</p>
        <Button variant="outline" onClick={() => router.push('/pricing-reviews')}>
          Back to reviews
        </Button>
      </div>
    )
  }

  const readOnly = review.status === 'completed'
  const vatRate = review.snapshot?.pricingPolicy.vatRate ?? 0.2
  const isFull = review.reviewType === 'full'
  const workingFilters: Array<[ReviewWorkingFilter, string]> = isFull
    ? [
        ['requires_attention', 'Requires Attention'],
        ['all_wines', 'All Wines'],
      ]
    : [
        ['requires_attention', 'Requires Attention'],
        ['all_changes', 'All Changes'],
        ['cost_increases', 'Cost Increases'],
        ['cost_decreases', 'Cost Decreases'],
      ]

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <AppNav active="pricing-reviews" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button
            variant="outline"
            size="sm"
            className="mb-2"
            onClick={() => router.push('/pricing-reviews')}
          >
            ← Reviews
          </Button>
          <h1 className="text-2xl font-semibold">{reviewTypeLabel(review.reviewType)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Status: <span className="capitalize">{review.status}</span>
            {' · '}
            Tolerance {review.toleranceGpPoints} GP pts
            {review.snapshot
              ? ` · Config: ${review.snapshot.sourceConfigurationName}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          {readOnly && (
            <Button
              variant="outline"
              onClick={() => router.push(`/pricing-reviews/${review.id}/actions`)}
            >
              Print Action Document
            </Button>
          )}
          {!readOnly && (
            <>
              <label className="text-xs text-muted-foreground">
                Tolerance (GP pts)
                <Input
                  className="mt-1 h-8 w-24"
                  type="number"
                  min="0"
                  step="0.1"
                  value={toleranceInput}
                  onChange={(e) => setToleranceInput(e.target.value)}
                />
              </label>
              <Button variant="outline" disabled={busy} onClick={onSaveTolerance}>
                Update tolerance
              </Button>
              <Button
                disabled={busy || undecidedCount > 0}
                onClick={onComplete}
                title={
                  undecidedCount > 0
                    ? `${undecidedCount} Requires Attention row(s) still undecided`
                    : undefined
                }
              >
                Complete review
              </Button>
            </>
          )}
        </div>
      </div>

      {!isFull &&
        (review.presenceSummary.newItems.length > 0 ||
          review.presenceSummary.missingItems.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Presence changes</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p className="text-muted-foreground">
                These are reported separately and are not ordinary cost-change rows.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="font-medium mb-1">
                    New in latest import ({review.presenceSummary.newItems.length})
                  </div>
                  <ul className="text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                    {review.presenceSummary.newItems.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.presenceSummary.newItems.map((item) => (
                        <li key={item.pricingItemId}>
                          PLU {item.externalPlu}
                          {item.description ? ` — ${item.description}` : ''}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <div className="font-medium mb-1">
                    Missing from latest import ({review.presenceSummary.missingItems.length})
                  </div>
                  <ul className="text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                    {review.presenceSummary.missingItems.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.presenceSummary.missingItems.map((item) => (
                        <li key={item.pricingItemId}>
                          PLU {item.externalPlu}
                          {item.description ? ` — ${item.description}` : ''}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      <div className="flex flex-wrap gap-2 items-center">
        {workingFilters.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={workingFilter === value ? 'secondary' : 'outline'}
            onClick={() => setWorkingFilter(value)}
          >
            {label}
          </Button>
        ))}
        <select
          className="h-8 rounded-md border px-2 text-sm bg-background"
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value as ReviewDecisionFilter)}
        >
          <option value="all">All decisions</option>
          <option value="undecided">Undecided</option>
          <option value="change_price">Change Price</option>
          <option value="delist">De-list</option>
          <option value="no_action">No Action</option>
        </select>
        <Input
          className="h-8 max-w-xs"
          placeholder="Search wine / PLU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!readOnly && undecidedCount > 0 && (
        <p className="text-sm text-amber-800">
          {undecidedCount} Requires Attention row{undecidedCount === 1 ? '' : 's'} still need a
          decision before completion.
        </p>
      )}

      <CostChangeReviewTable
        items={review.items}
        reviewType={review.reviewType}
        vatRate={vatRate}
        readOnly={readOnly}
        workingFilter={workingFilter}
        decisionFilter={decisionFilter}
        search={search}
        onDecision={onDecision}
        busyItemId={busyItemId}
      />
    </div>
  )
}
