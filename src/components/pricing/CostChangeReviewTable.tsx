'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  arrowForDelta,
  formatGp,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  formatSignedPoints,
} from '@/lib/pricingReview/format'
import { resultingGpForProposedPrice } from '@/lib/pricingReview/costChangeReview'
import type { PricingReviewDecision, PricingReviewItem } from '@/types/pricingReviews'

export type ReviewWorkingFilter =
  | 'requires_attention'
  | 'all_changes'
  | 'cost_increases'
  | 'cost_decreases'

export type ReviewDecisionFilter = 'all' | 'undecided' | PricingReviewDecision

interface CostChangeReviewTableProps {
  items: PricingReviewItem[]
  vatRate: number
  readOnly: boolean
  workingFilter: ReviewWorkingFilter
  decisionFilter: ReviewDecisionFilter
  search: string
  onDecision: (
    itemId: string,
    decision: PricingReviewDecision | null,
    proposedPriceIncVat?: number | null
  ) => void
  busyItemId: string | null
}

function matchesSearch(item: PricingReviewItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return (
    item.externalPlu.toLowerCase().includes(q) ||
    (item.description ?? '').toLowerCase().includes(q)
  )
}

function matchesWorkingFilter(item: PricingReviewItem, filter: ReviewWorkingFilter): boolean {
  const delta = item.currentCostExVat - item.previousCostExVat
  if (filter === 'requires_attention') return item.systemStatus === 'requires_attention'
  if (filter === 'cost_increases') return delta > 0
  if (filter === 'cost_decreases') return delta < 0
  return true
}

function matchesDecisionFilter(item: PricingReviewItem, filter: ReviewDecisionFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'undecided') {
    return item.systemStatus === 'requires_attention' && item.decision == null
  }
  return item.decision === filter
}

export function CostChangeReviewTable({
  items,
  vatRate,
  readOnly,
  workingFilter,
  decisionFilter,
  search,
  onDecision,
  busyItemId,
}: CostChangeReviewTableProps) {
  const visible = items.filter(
    (item) =>
      matchesSearch(item, search) &&
      matchesWorkingFilter(item, workingFilter) &&
      matchesDecisionFilter(item, decisionFilter)
  )

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No cost changes match the current filters.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium w-[22%]">Wine</th>
            <th className="px-3 py-2 font-medium w-[18%]">Cost</th>
            <th className="px-3 py-2 font-medium w-[28%]">GP</th>
            <th className="px-3 py-2 font-medium w-[14%]">Price</th>
            <th className="px-3 py-2 font-medium w-[18%]">Decision</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <ReviewRow
              key={item.id}
              item={item}
              vatRate={vatRate}
              readOnly={readOnly}
              busy={busyItemId === item.id}
              onDecision={onDecision}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReviewRow({
  item,
  vatRate,
  readOnly,
  busy,
  onDecision,
}: {
  item: PricingReviewItem
  vatRate: number
  readOnly: boolean
  busy: boolean
  onDecision: (
    itemId: string,
    decision: PricingReviewDecision | null,
    proposedPriceIncVat?: number | null
  ) => void
}) {
  const costDelta = item.currentCostExVat - item.previousCostExVat
  const costPct =
    Math.abs(item.previousCostExVat) > 1e-9
      ? (costDelta / item.previousCostExVat) * 100
      : null
  const gpDelta = item.currentGp - item.oldGp
  const vsTarget = item.currentGp - item.targetGp
  const priceDelta = item.recommendedPriceIncVat - item.currentSellingPriceIncVat
  const needsDecision = item.systemStatus === 'requires_attention'
  const expanded = item.decision === 'change_price'

  return (
    <tr className="border-b align-top hover:bg-muted/20">
      <td className="px-3 py-2">
        <div className="font-medium leading-tight">
          {item.description ?? 'Untitled wine'}
        </div>
        <div className="text-xs text-muted-foreground">PLU {item.externalPlu}</div>
        {item.previousChangePricePending && (
          <div className="text-xs text-amber-700 mt-1">
            Previous action not yet reflected
            {item.previousProposedPriceIncVat != null
              ? ` · Change price → ${formatMoney(item.previousProposedPriceIncVat)}`
              : ''}
          </div>
        )}
        {item.previousDelistPending && (
          <div className="text-xs text-amber-700 mt-1">
            Previous de-list decision still pending
          </div>
        )}
      </td>

      <td className="px-3 py-2 whitespace-nowrap">
        <div>
          {formatMoney(item.previousCostExVat)} → {formatMoney(item.currentCostExVat)}
        </div>
        <div className="text-xs text-muted-foreground">
          {arrowForDelta(costDelta)} {formatSignedMoney(costDelta)}
          {costPct != null ? ` · ${formatSignedPercent(costPct)}` : ''}
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 gap-y-0.5 items-start">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Old → Current
            </div>
            <div>
              {formatGp(item.oldGp)} → {formatGp(item.currentGp)}
            </div>
            <div className="text-xs text-muted-foreground">
              {arrowForDelta(gpDelta)} {formatSignedPoints(gpDelta)}
            </div>
          </div>
          <div className="text-muted-foreground self-stretch border-l" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Target
            </div>
            <div>{formatGp(item.targetGp)}</div>
            <div className="text-xs text-muted-foreground">
              {arrowForDelta(vsTarget)} {formatSignedPoints(vsTarget)}
            </div>
          </div>
        </div>
      </td>

      <td className="px-3 py-2 whitespace-nowrap">
        <div>
          {formatMoney(item.currentSellingPriceIncVat)} →{' '}
          {formatMoney(item.recommendedPriceIncVat)}
        </div>
        <div className="text-xs text-muted-foreground">
          {arrowForDelta(priceDelta)} {formatSignedMoney(priceDelta)}
        </div>
      </td>

      <td className="px-3 py-2">
        {!needsDecision ? (
          <div className="text-xs text-muted-foreground">No Action Required</div>
        ) : readOnly ? (
          <DecisionReadout item={item} />
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={item.decision === 'change_price' ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() =>
                  onDecision(item.id, 'change_price', item.recommendedPriceIncVat)
                }
              >
                Change Price
              </Button>
              <Button
                size="sm"
                variant={item.decision === 'delist' ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() => onDecision(item.id, 'delist')}
              >
                De-list
              </Button>
              <Button
                size="sm"
                variant={item.decision === 'no_action' ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() => onDecision(item.id, 'no_action')}
              >
                No Action
              </Button>
            </div>
            {expanded && (
              <ChangePriceEditor
                item={item}
                vatRate={vatRate}
                busy={busy}
                onCommit={(price) => onDecision(item.id, 'change_price', price)}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

function DecisionReadout({ item }: { item: PricingReviewItem }) {
  if (item.decision === 'change_price') {
    return (
      <div className="text-xs space-y-0.5">
        <div>Change Price</div>
        <div>Proposed {formatMoney(item.proposedPriceIncVat ?? 0)}</div>
        {item.resultingGp != null && <div>Resulting GP {formatGp(item.resultingGp)}</div>}
      </div>
    )
  }
  if (item.decision === 'delist') return <div className="text-xs">De-list</div>
  if (item.decision === 'no_action') return <div className="text-xs">No Action</div>
  return <div className="text-xs text-amber-700">Undecided</div>
}

function ChangePriceEditor({
  item,
  vatRate,
  busy,
  onCommit,
}: {
  item: PricingReviewItem
  vatRate: number
  busy: boolean
  onCommit: (price: number) => void
}) {
  const initial = item.proposedPriceIncVat ?? item.recommendedPriceIncVat
  const [value, setValue] = React.useState(String(initial))

  React.useEffect(() => {
    setValue(String(item.proposedPriceIncVat ?? item.recommendedPriceIncVat))
  }, [item.proposedPriceIncVat, item.recommendedPriceIncVat, item.id])

  const parsed = Number(value)
  const resulting =
    Number.isFinite(parsed) && parsed > 0
      ? resultingGpForProposedPrice(item.currentCostExVat, parsed, vatRate)
      : null
  const vsTarget = resulting != null ? resulting - item.targetGp : null

  return (
    <div className="rounded border bg-background p-2 space-y-1.5 max-w-[14rem]">
      <label className="text-xs text-muted-foreground block">
        Proposed price
        <Input
          className="mt-1 h-8"
          type="number"
          step="0.01"
          min="0"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (Number.isFinite(parsed) && parsed > 0 && parsed !== item.proposedPriceIncVat) {
              onCommit(parsed)
            }
          }}
        />
      </label>
      {resulting != null && (
        <div className="text-xs space-y-0.5">
          <div>Resulting GP {formatGp(resulting)}</div>
          <div>
            Target {formatGp(item.targetGp)}
            {vsTarget != null ? ` (${formatSignedPoints(vsTarget)})` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
