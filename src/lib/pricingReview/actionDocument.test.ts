import { describe, expect, it } from 'vitest'
import { buildActionDocument, reviewTypeLabel } from './actionDocument'

function item(partial: {
  externalPlu: string
  description?: string | null
  currentSellingPriceIncVat?: number
  decision: 'change_price' | 'delist' | 'no_action' | null
  proposedPriceIncVat?: number | null
  systemStatus?: 'requires_attention' | 'no_action_required'
}) {
  return {
    externalPlu: partial.externalPlu,
    description: partial.description ?? `Wine ${partial.externalPlu}`,
    currentSellingPriceIncVat: partial.currentSellingPriceIncVat ?? 69,
    decision: partial.decision,
    proposedPriceIncVat: partial.proposedPriceIncVat ?? null,
    systemStatus: partial.systemStatus ?? 'requires_attention',
  }
}

describe('buildActionDocument', () => {
  it('rejects draft reviews', () => {
    const result = buildActionDocument({
      reviewType: 'full',
      reviewDate: '2026-10-29T12:00:00Z',
      pricingDataImportDate: '2026-10-28T10:00:00Z',
      configurationName: 'Main Pricing',
      status: 'draft',
      items: [],
    })
    expect(result).toEqual({
      ok: false,
      error: 'Only completed reviews can generate an Action Document.',
    })
  })

  it('maps Change Price and De-list decisions and omits No Action from working sections', () => {
    const result = buildActionDocument({
      reviewType: 'cost_change',
      reviewDate: '2026-10-29T12:00:00Z',
      pricingDataImportDate: '2026-10-28T10:00:00Z',
      configurationName: 'Main Pricing',
      status: 'completed',
      items: [
        item({
          externalPlu: '5000010',
          description: 'Later wine',
          decision: 'change_price',
          proposedPriceIncVat: 80,
          currentSellingPriceIncVat: 75,
        }),
        item({
          externalPlu: '5000001',
          description: 'Picq Chablis',
          decision: 'change_price',
          proposedPriceIncVat: 72,
          currentSellingPriceIncVat: 69,
        }),
        item({
          externalPlu: '5000005',
          description: 'Delist me',
          decision: 'delist',
          currentSellingPriceIncVat: 55,
        }),
        item({
          externalPlu: '5000003',
          decision: 'no_action',
        }),
        item({
          externalPlu: '5000009',
          decision: null,
          systemStatus: 'no_action_required',
        }),
      ],
    })
    expect('ok' in result && result.ok === false).toBe(false)
    if ('ok' in result) return

    expect(result.summary).toEqual({
      priceChangeCount: 2,
      delistCount: 1,
      noActionCount: 1,
    })
    expect(result.hasActionableDecisions).toBe(true)

    // PLU ascending; No Action omitted from working sections
    expect(result.priceChanges.map((r) => r.plu)).toEqual(['5000001', '5000010'])
    expect(result.priceChanges[0]).toMatchObject({
      plu: '5000001',
      wine: 'Picq Chablis',
      currentPriceIncVat: 69,
      proposedPriceIncVat: 72,
      checklist: ['Update Micros', 'Update Wine List'],
    })

    expect(result.delists).toHaveLength(1)
    expect(result.delists[0]).toMatchObject({
      plu: '5000005',
      wine: 'Delist me',
      currentPriceIncVat: 55,
      checklist: ['Archive on FnbShop', 'Archive on Micros', 'Remove from Wine List'],
    })
  })

  it('renders a sensible empty result when there are no actionable decisions', () => {
    const result = buildActionDocument({
      reviewType: 'full',
      reviewDate: '2026-10-29T12:00:00Z',
      pricingDataImportDate: '2026-10-28T10:00:00Z',
      configurationName: 'Main Pricing',
      status: 'completed',
      items: [
        item({ externalPlu: '5000001', decision: 'no_action' }),
        item({
          externalPlu: '5000002',
          decision: null,
          systemStatus: 'no_action_required',
        }),
      ],
    })
    expect('ok' in result && result.ok === false).toBe(false)
    if ('ok' in result) return
    expect(result.hasActionableDecisions).toBe(false)
    expect(result.priceChanges).toEqual([])
    expect(result.delists).toEqual([])
    expect(result.summary.noActionCount).toBe(1)
  })

  it('works for both Cost Change and Full review types', () => {
    for (const reviewType of ['cost_change', 'full'] as const) {
      const result = buildActionDocument({
        reviewType,
        reviewDate: '2026-10-29T12:00:00Z',
        pricingDataImportDate: '2026-10-28T10:00:00Z',
        configurationName: 'Main Pricing',
        status: 'completed',
        items: [
          item({
            externalPlu: '5000001',
            decision: 'change_price',
            proposedPriceIncVat: 70,
          }),
        ],
      })
      expect('ok' in result && result.ok === false).toBe(false)
      if ('ok' in result) continue
      expect(result.reviewType).toBe(reviewType)
      expect(result.priceChanges).toHaveLength(1)
    }
  })
})

describe('reviewTypeLabel', () => {
  it('labels both review types', () => {
    expect(reviewTypeLabel('cost_change')).toBe('Cost Change Review')
    expect(reviewTypeLabel('full')).toBe('Full Pricing Review')
  })
})
