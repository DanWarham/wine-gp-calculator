/**
 * Authenticated Stage 6C smoke (not part of default `npm test`).
 *
 * Run:
 * node --env-file-if-exists=.env.local --env-file-if-exists=.env.test.local \
 *   ./node_modules/vitest/vitest.mjs run --config vitest.smoke6c.config.ts
 */
import { describe, expect, it } from 'vitest'
import {
  buildFnbShopRecipeDetailXlsx,
  buildMicrosCsvs,
} from '@/lib/pricingImport/fixtures/buildFixtures'
import { buildLimeWoodPricingImport } from '@/lib/pricingImport/limeWoodImport'
import { buildActionDocument } from '@/lib/pricingReview/actionDocument'
import {
  completePricingReview,
  createCostChangeReview,
  createFullPricingReview,
  getPricingReview,
  getPricingReviewActionDocument,
  listPricingReviews,
  saveReviewItemDecision,
} from '@/lib/pricingReviewStore'
import { canCompleteReview } from '@/lib/pricingReview/costChangeReview'
import {
  provisionTestUserAccount,
  readTestUserCredentials,
  signInAsTestUser,
} from '@/lib/testSupport'
import { supabase } from '@/lib/supabaseClient'

/** Distinctive PLU band for this smoke so cleanup can target disposable rows. */
const SMOKE_PLUS = {
  attentionA: '5000601',
  attentionB: '5000602',
  attentionC: '5000603',
  attentionD: '5000604',
  okWine: '5000605',
} as const

async function commitFixtureImport(options: {
  recipes: Array<{
    plu: string
    name: string
    cost: number
    sell: number
    ingredientName: string
    measurement: string
  }>
  microsPriceByPlu: Record<string, string>
}): Promise<string> {
  const fnbshop = await buildFnbShopRecipeDetailXlsx(options.recipes)
  const masters = options.recipes.map((r, i) => ({
    id: String(600 + i),
    objectNumber: r.plu,
    name: r.name,
  }))
  const definitions = masters.map((m, i) => ({
    id: String(1600 + i),
    masterId: m.id,
    firstName: m.name,
    mainMenuLevel: '11111111',
  }))
  const prices = definitions.map((d, i) => ({
    id: String(2600 + i),
    defId: d.id,
    price: options.microsPriceByPlu[options.recipes[i].plu] ?? '65',
  }))
  const micros = buildMicrosCsvs({ masters, definitions, prices })
  const built = await buildLimeWoodPricingImport({
    fnbshopRecipeDetail: fnbshop,
    microsMenuItemMaster: micros.master,
    microsMenuItemDefinition: micros.definition,
    microsMenuItemPrice: micros.price,
    filenames: {
      fnbshopRecipeDetail: 'fnbshop-6c.xlsx',
      microsMenuItemMaster: 'master-6c.csv',
      microsMenuItemDefinition: 'definition-6c.csv',
      microsMenuItemPrice: 'price-6c.csv',
    },
  })
  expect(built.validation.ok).toBe(true)
  expect(built.commitPayload).toBeTruthy()

  const { data, error } = await supabase.rpc('commit_pricing_data_import', {
    p_payload: built.commitPayload,
  })
  expect(error).toBeNull()
  return String((data as { import_id: string }).import_id)
}

function smokeRecipes(costBump = 0) {
  // High cost / modest Micros price → Requires Attention for A–D.
  // okWine priced generously → No Action Required.
  return {
    recipes: [
      {
        plu: SMOKE_PLUS.attentionA,
        name: '6C Smoke Alpha',
        cost: 28 + costBump,
        sell: 60,
        ingredientName: '6C Smoke Alpha, Btl750 ML',
        measurement: '750 ML',
      },
      {
        plu: SMOKE_PLUS.attentionB,
        name: '6C Smoke Beta',
        cost: 27 + costBump,
        sell: 58,
        ingredientName: '6C Smoke Beta, Btl750 ML',
        measurement: '750 ML',
      },
      {
        plu: SMOKE_PLUS.attentionC,
        name: '6C Smoke Gamma',
        cost: 26 + costBump,
        sell: 55,
        ingredientName: '6C Smoke Gamma, Btl750 ML',
        measurement: '750 ML',
      },
      {
        plu: SMOKE_PLUS.attentionD,
        name: '6C Smoke Delta',
        cost: 25 + costBump,
        sell: 52,
        ingredientName: '6C Smoke Delta, Btl750 ML',
        measurement: '750 ML',
      },
      {
        plu: SMOKE_PLUS.okWine,
        name: '6C Smoke Ok',
        cost: 12 + costBump,
        sell: 80,
        ingredientName: '6C Smoke Ok, Btl750 ML',
        measurement: '750 ML',
      },
    ],
    microsPriceByPlu: {
      [SMOKE_PLUS.attentionA]: '55',
      [SMOKE_PLUS.attentionB]: '54',
      [SMOKE_PLUS.attentionC]: '53',
      [SMOKE_PLUS.attentionD]: '52',
      [SMOKE_PLUS.okWine]: '95',
    },
  }
}

describe('Stage 6C Full Pricing Review + Action Document smoke', () => {
  it('creates full review, decides, completes, and verifies action documents', async () => {
    const credentials = readTestUserCredentials()
    if (!credentials) {
      throw new Error('Missing TEST_USER_EMAIL / TEST_USER_PASSWORD in .env.test.local')
    }

    const provisioned = await provisionTestUserAccount()
    expect(provisioned.ok).toBe(true)
    if (!provisioned.ok) throw new Error(provisioned.error)

    const signedIn = await signInAsTestUser(credentials)
    expect(signedIn.ok).toBe(true)
    if (!signedIn.ok) throw new Error(signedIn.error)

    const userId = signedIn.userId
    const createdIds: {
      importIds: string[]
      fullReviewId?: string
      costChangeReviewId?: string
    } = { importIds: [] }

    try {
      // Fresh latest import for Full Review.
      const importId = await commitFixtureImport(smokeRecipes(0))
      createdIds.importIds.push(importId)

      const created = await createFullPricingReview(userId)
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error(created.error)
      expect(created.data.insufficientImports).toBeFalsy()
      expect(created.data.reviewId).toBeTruthy()

      const reviewId = created.data.reviewId
      createdIds.fullReviewId = reviewId

      const loaded = await getPricingReview(reviewId, userId)
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) throw new Error(loaded.error)
      const review = loaded.data

      expect(review.reviewType).toBe('full')
      expect(review.previousImportId).toBeNull()
      expect(review.currentImportId).toBe(importId)
      expect(review.status).toBe('draft')
      expect(review.toleranceGpPoints).toBe(1)

      const plus = review.items.map((i) => i.externalPlu)
      expect(plus).toEqual(
        expect.arrayContaining([
          SMOKE_PLUS.attentionA,
          SMOKE_PLUS.attentionB,
          SMOKE_PLUS.attentionC,
          SMOKE_PLUS.attentionD,
          SMOKE_PLUS.okWine,
        ])
      )
      // PLU ascending
      expect(plus).toEqual([...plus].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))

      const attention = review.items.filter((i) => i.systemStatus === 'requires_attention')
      const noActionRequired = review.items.filter(
        (i) => i.systemStatus === 'no_action_required'
      )
      expect(attention.length).toBeGreaterThanOrEqual(4)
      expect(noActionRequired.some((i) => i.externalPlu === SMOKE_PLUS.okWine)).toBe(true)

      // Working-view semantics: Requires Attention ⊂ All Wines
      expect(attention.length).toBeLessThan(review.items.length)
      expect(review.items.length).toBe(attention.length + noActionRequired.length)

      const byPlu = (plu: string) => {
        const row =
          attention.find((i) => i.externalPlu === plu) ??
          review.items.find((i) => i.externalPlu === plu)
        if (!row || row.systemStatus !== 'requires_attention') {
          throw new Error(`Expected Requires Attention row for PLU ${plu}`)
        }
        return row
      }

      const changeTarget = byPlu(SMOKE_PLUS.attentionA)
      const overrideTarget = byPlu(SMOKE_PLUS.attentionB)
      const delistTarget = byPlu(SMOKE_PLUS.attentionC)
      const noActionTarget = byPlu(SMOKE_PLUS.attentionD)

      const changed = await saveReviewItemDecision(reviewId, changeTarget.id, userId, {
        decision: 'change_price',
        proposedPriceIncVat: changeTarget.recommendedPriceIncVat,
      })
      expect(changed.ok).toBe(true)
      if (!changed.ok) throw new Error(changed.error)
      expect(changed.data.proposedPriceIncVat).toBe(changeTarget.recommendedPriceIncVat)

      const overriddenPrice = overrideTarget.recommendedPriceIncVat + 3
      const overridden = await saveReviewItemDecision(reviewId, overrideTarget.id, userId, {
        decision: 'change_price',
        proposedPriceIncVat: overriddenPrice,
      })
      expect(overridden.ok).toBe(true)
      if (!overridden.ok) throw new Error(overridden.error)
      expect(overridden.data.proposedPriceIncVat).toBe(overriddenPrice)
      expect(overridden.data.resultingGp).not.toBeNull()

      const delisted = await saveReviewItemDecision(reviewId, delistTarget.id, userId, {
        decision: 'delist',
      })
      expect(delisted.ok).toBe(true)

      const noAction = await saveReviewItemDecision(reviewId, noActionTarget.id, userId, {
        decision: 'no_action',
      })
      expect(noAction.ok).toBe(true)

      // Decide any remaining attention rows so completion is possible.
      const reloaded = await getPricingReview(reviewId, userId)
      expect(reloaded.ok).toBe(true)
      if (!reloaded.ok) throw new Error(reloaded.error)
      for (const item of reloaded.data.items) {
        if (item.systemStatus === 'requires_attention' && item.decision == null) {
          const extra = await saveReviewItemDecision(reviewId, item.id, userId, {
            decision: 'no_action',
          })
          expect(extra.ok).toBe(true)
        }
      }

      // Save / leave / reopen
      const reopened = await getPricingReview(reviewId, userId)
      expect(reopened.ok).toBe(true)
      if (!reopened.ok) throw new Error(reopened.error)
      expect(
        reopened.data.items.find((i) => i.externalPlu === SMOKE_PLUS.attentionA)?.decision
      ).toBe('change_price')
      expect(
        reopened.data.items.find((i) => i.externalPlu === SMOKE_PLUS.attentionB)?.proposedPriceIncVat
      ).toBe(overriddenPrice)
      expect(
        reopened.data.items.find((i) => i.externalPlu === SMOKE_PLUS.attentionC)?.decision
      ).toBe('delist')
      expect(
        reopened.data.items.find((i) => i.externalPlu === SMOKE_PLUS.attentionD)?.decision
      ).toBe('no_action')
      expect(canCompleteReview(reopened.data.items)).toBe(true)

      const completed = await completePricingReview(reviewId, userId)
      expect(completed.ok).toBe(true)
      if (!completed.ok) throw new Error(completed.error)
      expect(completed.data.status).toBe('completed')

      const historical = await getPricingReview(reviewId, userId)
      expect(historical.ok).toBe(true)
      if (!historical.ok) throw new Error(historical.error)
      expect(historical.data.status).toBe('completed')
      expect(historical.data.completedAt).toBeTruthy()

      // Read-only: decision mutation blocked
      const blocked = await saveReviewItemDecision(
        reviewId,
        historical.data.items[0].id,
        userId,
        { decision: 'no_action' }
      )
      expect(blocked.ok).toBe(false)

      // Draft Action Document rejected
      const draftDoc = buildActionDocument({
        reviewType: 'full',
        reviewDate: historical.data.createdAt,
        pricingDataImportDate: null,
        configurationName: null,
        items: historical.data.items,
        status: 'draft',
      })
      expect(draftDoc).toMatchObject({ ok: false })

      const actionDoc = await getPricingReviewActionDocument(reviewId, userId)
      expect(actionDoc.ok).toBe(true)
      if (!actionDoc.ok) throw new Error(actionDoc.error)

      expect(actionDoc.data.reviewType).toBe('full')
      expect(actionDoc.data.hasActionableDecisions).toBe(true)
      expect(actionDoc.data.summary.priceChangeCount).toBeGreaterThanOrEqual(2)
      expect(actionDoc.data.summary.delistCount).toBeGreaterThanOrEqual(1)
      expect(actionDoc.data.summary.noActionCount).toBeGreaterThanOrEqual(1)

      // No Action omitted from working sections
      const workingPlus = [
        ...actionDoc.data.priceChanges.map((r) => r.plu),
        ...actionDoc.data.delists.map((r) => r.plu),
      ]
      expect(workingPlus).not.toContain(SMOKE_PLUS.attentionD)
      expect(workingPlus).not.toContain(SMOKE_PLUS.okWine)

      // Checklists
      for (const row of actionDoc.data.priceChanges) {
        expect(row.checklist).toEqual(['Update Micros', 'Update Wine List'])
      }
      for (const row of actionDoc.data.delists) {
        expect(row.checklist).toEqual([
          'Archive on FnbShop',
          'Archive on Micros',
          'Remove from Wine List',
        ])
      }

      // PLU ascending in both sections
      const changePlus = actionDoc.data.priceChanges.map((r) => r.plu)
      expect(changePlus).toEqual(
        [...changePlus].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      )
      const delistPlus = actionDoc.data.delists.map((r) => r.plu)
      expect(delistPlus).toEqual(
        [...delistPlus].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      )

      // --- Cost Change Review Action Document (same format) ---
      await new Promise((r) => setTimeout(r, 1100))
      const secondImportId = await commitFixtureImport(smokeRecipes(2))
      createdIds.importIds.push(secondImportId)

      const costCreated = await createCostChangeReview(userId)
      expect(costCreated.ok).toBe(true)
      if (!costCreated.ok) throw new Error(costCreated.error)
      expect(costCreated.data.insufficientImports).toBeFalsy()

      const costReviewId = costCreated.data.reviewId
      createdIds.costChangeReviewId = costReviewId

      let costLoaded = await getPricingReview(costReviewId, userId)
      expect(costLoaded.ok).toBe(true)
      if (!costLoaded.ok) throw new Error(costLoaded.error)
      expect(costLoaded.data.reviewType).toBe('cost_change')

      // Ensure at least one change_price + one delist for format check
      const costAttention = costLoaded.data.items.filter(
        (i) => i.systemStatus === 'requires_attention'
      )
      expect(costAttention.length).toBeGreaterThanOrEqual(2)
      const [cChange, cDelist, ...restAttention] = costAttention

      expect(
        (
          await saveReviewItemDecision(costReviewId, cChange.id, userId, {
            decision: 'change_price',
            proposedPriceIncVat: cChange.recommendedPriceIncVat,
          })
        ).ok
      ).toBe(true)
      expect(
        (await saveReviewItemDecision(costReviewId, cDelist.id, userId, { decision: 'delist' })).ok
      ).toBe(true)
      for (const item of restAttention) {
        expect(
          (await saveReviewItemDecision(costReviewId, item.id, userId, { decision: 'no_action' })).ok
        ).toBe(true)
      }

      // Also clear any newly undecided after reload
      costLoaded = await getPricingReview(costReviewId, userId)
      expect(costLoaded.ok).toBe(true)
      if (!costLoaded.ok) throw new Error(costLoaded.error)
      for (const item of costLoaded.data.items) {
        if (item.systemStatus === 'requires_attention' && item.decision == null) {
          expect(
            (await saveReviewItemDecision(costReviewId, item.id, userId, { decision: 'no_action' }))
              .ok
          ).toBe(true)
        }
      }

      const costCompleted = await completePricingReview(costReviewId, userId)
      expect(costCompleted.ok).toBe(true)
      if (!costCompleted.ok) throw new Error(costCompleted.error)

      const costDoc = await getPricingReviewActionDocument(costReviewId, userId)
      expect(costDoc.ok).toBe(true)
      if (!costDoc.ok) throw new Error(costDoc.error)
      expect(costDoc.data.reviewType).toBe('cost_change')
      expect(costDoc.data.priceChanges.length).toBeGreaterThanOrEqual(1)
      expect(costDoc.data.delists.length).toBeGreaterThanOrEqual(1)
      expect(costDoc.data.priceChanges[0].checklist).toEqual([
        'Update Micros',
        'Update Wine List',
      ])
      expect(costDoc.data.delists[0].checklist).toEqual([
        'Archive on FnbShop',
        'Archive on Micros',
        'Remove from Wine List',
      ])
      expect(
        [...costDoc.data.priceChanges.map((r) => r.plu)].every(
          (plu, i, arr) => i === 0 || arr[i - 1].localeCompare(plu, undefined, { numeric: true }) <= 0
        )
      ).toBe(true)

      // Confirm list still isolates to this user
      const listed = await listPricingReviews(userId)
      expect(listed.ok).toBe(true)
      if (!listed.ok) throw new Error(listed.error)
      expect(listed.data.some((r) => r.id === reviewId)).toBe(true)
      expect(listed.data.some((r) => r.id === costReviewId)).toBe(true)

      console.log(
        JSON.stringify(
          {
            ok: true,
            userId,
            fullReviewId: reviewId,
            costChangeReviewId: costReviewId,
            importIds: createdIds.importIds,
            fullActionDoc: {
              priceChanges: actionDoc.data.priceChanges.map((r) => ({
                plu: r.plu,
                checklist: r.checklist,
              })),
              delists: actionDoc.data.delists.map((r) => ({
                plu: r.plu,
                checklist: r.checklist,
              })),
              summary: actionDoc.data.summary,
            },
            costActionDoc: {
              priceChanges: costDoc.data.priceChanges.map((r) => ({
                plu: r.plu,
                checklist: r.checklist,
              })),
              delists: costDoc.data.delists.map((r) => ({
                plu: r.plu,
                checklist: r.checklist,
              })),
              summary: costDoc.data.summary,
            },
          },
          null,
          2
        )
      )
    } finally {
      await supabase.auth.signOut()
    }
  }, 180_000)
})
