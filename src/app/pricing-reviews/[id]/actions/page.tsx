'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  reviewTypeLabel,
  type ActionDocument,
} from '@/lib/pricingReview/actionDocument'
import { formatMoney } from '@/lib/pricingReview/format'
import { getPricingReviewActionDocument } from '@/lib/pricingReviewStore'
import { supabase } from '@/lib/supabaseClient'

function formatDisplayDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function PricingReviewActionsPage() {
  const params = useParams<{ id: string }>()
  const reviewId = params.id
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [doc, setDoc] = useState<ActionDocument | null>(null)

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/welcome')
      return
    }
    const result = await getPricingReviewActionDocument(reviewId, session.user.id)
    if (!result.ok) {
      setError(result.error)
      setDoc(null)
      setLoading(false)
      return
    }
    setDoc(result.data)
    setError(null)
    setLoading(false)
  }, [reviewId, router])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading Action Document…</p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto">
        <p className="text-sm text-red-600">{error ?? 'Action Document unavailable.'}</p>
        <Button variant="outline" onClick={() => router.push(`/pricing-reviews/${reviewId}`)}>
          Back to review
        </Button>
      </div>
    )
  }

  const { summary } = doc

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          nav, header.app-nav { display: none !important; }
          body { background: white !important; color: black !important; }
          .action-doc { max-width: none !important; margin: 0 !important; padding: 12mm !important; }
          .action-row { break-inside: avoid; page-break-inside: avoid; }
        }
        @page { size: A4; margin: 12mm; }
      `}</style>

      <div className="no-print p-4 border-b bg-background sticky top-0 z-10 flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/pricing-reviews/${reviewId}`)}
          >
            ← Back to review
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use your browser print dialog to print or save as PDF.
        </p>
      </div>

      <article className="action-doc mx-auto max-w-3xl px-6 py-8 text-[13px] leading-snug text-black">
        <header className="mb-6 border-b border-black pb-4">
          <h1 className="text-2xl font-bold tracking-wide">PRICING ACTIONS</h1>
          <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-y-1">
            <dt className="text-neutral-600">Review type</dt>
            <dd>{reviewTypeLabel(doc.reviewType)}</dd>
            <dt className="text-neutral-600">Review date</dt>
            <dd>{formatDisplayDate(doc.reviewDate)}</dd>
            <dt className="text-neutral-600">Pricing data / import</dt>
            <dd>{formatDisplayDate(doc.pricingDataImportDate)}</dd>
            <dt className="text-neutral-600">Configuration</dt>
            <dd>{doc.configurationName ?? '—'}</dd>
          </dl>
        </header>

        <section className="mb-6">
          <p>
            {summary.priceChangeCount} price change
            {summary.priceChangeCount === 1 ? '' : 's'}
            {' · '}
            {summary.delistCount} de-list{summary.delistCount === 1 ? '' : 's'}
            {' · '}
            {summary.noActionCount} no-action decision
            {summary.noActionCount === 1 ? '' : 's'}
          </p>
        </section>

        {!doc.hasActionableDecisions ? (
          <section className="action-section mb-8 rounded border border-neutral-300 px-4 py-6 text-center">
            <p className="font-medium">No actions required</p>
            <p className="mt-1 text-neutral-600">
              This completed review has no price changes or de-lists to implement.
            </p>
          </section>
        ) : (
          <>
            <section className="action-section mb-8">
              <h2 className="mb-3 border-b border-neutral-400 pb-1 text-base font-semibold tracking-wide">
                PRICE CHANGES
              </h2>
              {doc.priceChanges.length === 0 ? (
                <p className="text-neutral-600">None.</p>
              ) : (
                <ul className="space-y-3">
                  {doc.priceChanges.map((row) => (
                    <li
                      key={`change-${row.plu}`}
                      className="action-row border border-neutral-300 px-3 py-2.5"
                    >
                      <div className="font-medium">
                        {row.plu}
                        {'  '}
                        {row.wine}
                      </div>
                      <div className="mt-0.5">
                        {formatMoney(row.currentPriceIncVat)} →{' '}
                        {formatMoney(row.proposedPriceIncVat)}
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {row.checklist.map((label) => (
                          <li key={label} className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="inline-block h-4 w-4 shrink-0 border-2 border-black"
                            />
                            <span>{label}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="action-section mb-8">
              <h2 className="mb-3 border-b border-neutral-400 pb-1 text-base font-semibold tracking-wide">
                DE-LISTS
              </h2>
              {doc.delists.length === 0 ? (
                <p className="text-neutral-600">None.</p>
              ) : (
                <ul className="space-y-3">
                  {doc.delists.map((row) => (
                    <li
                      key={`delist-${row.plu}`}
                      className="action-row border border-neutral-300 px-3 py-2.5"
                    >
                      <div className="font-medium">
                        {row.plu}
                        {'  '}
                        {row.wine}
                      </div>
                      <div className="mt-0.5">
                        Current price {formatMoney(row.currentPriceIncVat)}
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {row.checklist.map((label) => (
                          <li key={label} className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="inline-block h-4 w-4 shrink-0 border-2 border-black"
                            />
                            <span>{label}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </article>
    </>
  )
}
