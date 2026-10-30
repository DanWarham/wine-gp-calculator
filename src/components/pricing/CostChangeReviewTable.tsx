'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  arrowForDelta,
  costDeltaClass,
  formatGp,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  formatSignedPoints,
  gpDeltaClass,
  priceDeltaClass,
} from '@/lib/pricingReview/format'
import { resultingGpForProposedPrice } from '@/lib/pricingReview/costChangeReview'
import type {
  PricingReviewDecision,
  PricingReviewItem,
  PricingReviewType,
} from '@/types/pricingReviews'

export type ReviewWorkingFilter =
  | 'requires_attention'
  | 'all_changes'
  | 'all_wines'
  | 'cost_increases'
  | 'cost_decreases'

export type ReviewDecisionFilter = 'all' | 'undecided' | PricingReviewDecision

interface CostChangeReviewTableProps {
  items: PricingReviewItem[]
  reviewType: PricingReviewType
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

function matchesWorkingFilter(
  item: PricingReviewItem,
  filter: ReviewWorkingFilter,
  reviewType: PricingReviewType
): boolean {
  if (filter === 'requires_attention') return item.systemStatus === 'requires_attention'
  if (filter === 'all_wines' || filter === 'all_changes') return true
  if (reviewType === 'full') return true
  const delta = item.currentCostExVat - item.previousCostExVat
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
  reviewType,
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
      matchesWorkingFilter(item, workingFilter, reviewType) &&
      matchesDecisionFilter(item, decisionFilter)
  )

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        {reviewType === 'full'
          ? 'No wines match the current filters.'
          : 'No cost changes match the current filters.'}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm table-fixed">
        <thead className="bg-muted/40 text-left">
          <tr className="border-b">
            <th className="px-2 py-1.5 font-medium w-[22%]">Wine</th>
            <th className="px-2 py-1.5 font-medium w-[14%]">Cost</th>
            <th className="px-2 py-1.5 font-medium w-[28%]">GP</th>
            <th className="px-2 py-1.5 font-medium w-[14%]">Price</th>
            <th className="px-2 py-1.5 font-medium w-[22%]">Decision</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <ReviewRow
              key={item.id}
              item={item}
              reviewType={reviewType}
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
  reviewType,
  vatRate,
  readOnly,
  busy,
  onDecision,
}: {
  item: PricingReviewItem
  reviewType: PricingReviewType
  vatRate: number
  readOnly: boolean
  busy: boolean
  onDecision: (
    itemId: string,
    decision: PricingReviewDecision | null,
    proposedPriceIncVat?: number | null
  ) => void
}) {
  const isFull = reviewType === 'full'
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
      <td className="px-2 py-1.5">
        <div className="font-medium leading-tight text-[13px]">
          {item.description ?? 'Untitled wine'}
        </div>
        <div className="text-[11px] text-muted-foreground">PLU {item.externalPlu}</div>
        {item.previousChangePricePending && (
          <div className="text-[11px] text-amber-700 mt-0.5">
            Previous price-change action not yet reflected
            {item.previousProposedPriceIncVat != null
              ? ` · ${formatMoney(item.previousProposedPriceIncVat)}`
              : ''}
          </div>
        )}
        {item.previousDelistPending && (
          <div className="text-[11px] text-amber-700 mt-0.5">
            Previous de-list decision still pending
          </div>
        )}
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap">
        {isFull ? (
          <>
            <div>{formatMoney(item.currentCostExVat)}</div>
            <div className="text-[11px] text-muted-foreground">{item.bottleSizeMl}ml</div>
          </>
        ) : (
          <>
            <div className="text-[13px]">
              {formatMoney(item.previousCostExVat)} → {formatMoney(item.currentCostExVat)}
            </div>
            <div className={`text-[11px] ${costDeltaClass(costDelta)}`}>
              {arrowForDelta(costDelta)} {formatSignedMoney(costDelta)}
              {costPct != null ? ` · ${formatSignedPercent(costPct)}` : ''}
            </div>
          </>
        )}
      </td>

      <td className="px-2 py-1.5">
        {isFull ? (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-1.5 items-start">
            <div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                Current
              </div>
              <div>{formatGp(item.currentGp)}</div>
            </div>
            <div className="text-muted-foreground/50 self-stretch border-l" />
            <div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                Target
              </div>
              <div>{formatGp(item.targetGp)}</div>
              <div className={`text-[11px] ${gpDeltaClass(vsTarget)}`}>
                {arrowForDelta(vsTarget)} {formatSignedPoints(vsTarget)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-1.5 items-start">
            <div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                Old → Current
              </div>
              <div className="text-[13px]">
                {formatGp(item.oldGp)} → {formatGp(item.currentGp)}
              </div>
              <div className={`text-[11px] ${gpDeltaClass(gpDelta)}`}>
                {arrowForDelta(gpDelta)} {formatSignedPoints(gpDelta)}
              </div>
            </div>
            <div className="text-muted-foreground/50 self-stretch border-l" />
            <div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                Target
              </div>
              <div>{formatGp(item.targetGp)}</div>
              <div className={`text-[11px] ${gpDeltaClass(vsTarget)}`}>
                {arrowForDelta(vsTarget)} {formatSignedPoints(vsTarget)}
              </div>
            </div>
          </div>
        )}
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap">
        <div className="text-[13px]">
          {formatMoney(item.currentSellingPriceIncVat)} →{' '}
          {formatMoney(item.recommendedPriceIncVat)}
        </div>
        <div className={`text-[11px] ${priceDeltaClass(priceDelta)}`}>
          {arrowForDelta(priceDelta)} {formatSignedMoney(priceDelta)}
        </div>
      </td>

      <td className="px-2 py-1.5">
        {!needsDecision ? (
          <div className="text-[11px] text-muted-foreground">No Action Required</div>
        ) : readOnly ? (
          <DecisionReadout item={item} />
        ) : (
          <div className="space-y-1.5">
            <div className="flex flex-nowrap gap-1">
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                variant={item.decision === 'change_price' ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() =>
                  onDecision(item.id, 'change_price', item.recommendedPriceIncVat)
                }
              >
                Price
              </Button>
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                variant={item.decision === 'delist' ? 'secondary' : 'outline'}
                disabled={busy}
                onClick={() => onDecision(item.id, 'delist')}
              >
                De-list
              </Button>
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
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
      <div className="text-[11px] space-y-0.5">
        <div>Change Price</div>
        <div>Proposed {formatMoney(item.proposedPriceIncVat ?? 0)}</div>
        {item.resultingGp != null && <div>Resulting GP {formatGp(item.resultingGp)}</div>}
      </div>
    )
  }
  if (item.decision === 'delist') return <div className="text-[11px]">De-list</div>
  if (item.decision === 'no_action') return <div className="text-[11px]">No Action</div>
  return <div className="text-[11px] text-amber-700">Undecided</div>
}

function ChangePriceEditor({
  item,
  vatRate,
  onCommit,
}: {
  item: PricingReviewItem
  vatRate: number
  onCommit: (price: number) => void
}) {
  const initial = item.proposedPriceIncVat ?? item.recommendedPriceIncVat
  const [value, setValue] = React.useState(String(initial))
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setValue(String(item.proposedPriceIncVat ?? item.recommendedPriceIncVat))
  }, [item.proposedPriceIncVat, item.recommendedPriceIncVat, item.id])

  React.useEffect(() => {
    // Focus after expand so the proposed price is immediately editable.
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [item.id])

  const parsed = Number(value)
  const resulting =
    Number.isFinite(parsed) && parsed > 0
      ? resultingGpForProposedPrice(item.currentCostExVat, parsed, vatRate)
      : null
  const vsTarget = resulting != null ? resulting - item.targetGp : null

  const commitIfChanged = () => {
    if (!Number.isFinite(parsed) || !(parsed > 0)) return
    if (parsed === item.proposedPriceIncVat) return
    onCommit(parsed)
  }

  return (
    <div className="rounded border bg-background p-1.5 space-y-1 max-w-[11rem]">
      <label className="text-[11px] text-muted-foreground block">
        Proposed price
        <Input
          ref={inputRef}
          className="mt-0.5 h-7 text-sm"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitIfChanged()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </label>
      {resulting != null && (
        <div className="text-[11px] space-y-0.5">
          <div>Resulting GP {formatGp(resulting)}</div>
          <div className={vsTarget != null ? gpDeltaClass(vsTarget) : undefined}>
            Target {formatGp(item.targetGp)}
            {vsTarget != null ? ` (${formatSignedPoints(vsTarget)})` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
