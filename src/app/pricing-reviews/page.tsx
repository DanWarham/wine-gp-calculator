'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toast-provider'
import { listPricingDataImports } from '@/lib/pricingDataImportStore'
import {
  createCostChangeReview,
  listPricingReviews,
} from '@/lib/pricingReviewStore'
import { supabase } from '@/lib/supabaseClient'
import type { PricingReviewListItem } from '@/types/pricingReviews'

export default function PricingReviewsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reviews, setReviews] = useState<PricingReviewListItem[]>([])
  const [importCount, setImportCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = async (uid: string) => {
    const listed = await listPricingReviews(uid)
    if (!listed.ok) {
      setError(listed.error)
      return
    }
    setReviews(listed.data)
    const imports = await listPricingDataImports(uid)
    if (imports.ok) setImportCount(imports.data.length)
  }

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/welcome')
        return
      }
      setUserId(session.user.id)
      await reload(session.user.id)
      setLoading(false)
    }
    void load()
  }, [router])

  const onCreate = async () => {
    if (!userId) return
    setBusy(true)
    setError(null)
    const created = await createCostChangeReview(userId)
    setBusy(false)
    if (!created.ok) {
      setError(created.error)
      showToast(created.error)
      return
    }
    if (created.data.insufficientImports) {
      setError(
        'A Cost Change Review needs at least two completed pricing-data imports. Import a newer pricing snapshot first.'
      )
      return
    }
    if (created.data.reusedExistingDraft) {
      showToast('Opened existing draft Cost Change Review.')
    } else {
      showToast('Cost Change Review created.')
    }
    router.push(`/pricing-reviews/${created.data.reviewId}`)
  }

  if (loading) {
    return (
      <div className="p-6">
        <AppNav active="pricing-reviews" />
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <AppNav active="pricing-reviews" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pricing Reviews</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cost Change Review compares the latest completed pricing import with the previous
            one using Current Pricing.
          </p>
        </div>
        <Button onClick={onCreate} disabled={busy}>
          {busy ? 'Creating…' : 'New Cost Change Review'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      )}

      {importCount < 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not ready yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              A Cost Change Review cannot yet be created. Complete at least two pricing-data
              imports first ({importCount} completed so far).
            </p>
            <Button variant="outline" onClick={() => router.push('/pricing-data')}>
              Go to Pricing Data
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pricing reviews yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 pr-3 font-medium">Items</th>
                    <th className="py-2 pr-3 font-medium">Attention</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.id} className="border-b">
                      <td className="py-2 pr-3">Cost Change</td>
                      <td className="py-2 pr-3 capitalize">{review.status}</td>
                      <td className="py-2 pr-3">
                        {new Date(review.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">{review.itemCount}</td>
                      <td className="py-2 pr-3">
                        {review.requiresAttentionCount}
                        {review.status === 'draft' && review.undecidedAttentionCount > 0
                          ? ` (${review.undecidedAttentionCount} undecided)`
                          : ''}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/pricing-reviews/${review.id}`)}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
