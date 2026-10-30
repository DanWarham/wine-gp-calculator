/**
 * Authenticated Stage 6B smoke (not part of default `npm test`).
 *
 * Run:
 * node --env-file-if-exists=.env.local --env-file-if-exists=.env.test.local \
 *   ./node_modules/vitest/vitest.mjs run --config vitest.smoke.config.ts
 */
import { describe, expect, it } from 'vitest'
import {
  buildFnbShopRecipeDetailXlsx,
  buildMicrosCsvs,
} from '@/lib/pricingImport/fixtures/buildFixtures'
import { buildLimeWoodPricingImport } from '@/lib/pricingImport/limeWoodImport'
import {
  completePricingReview,
  createCostChangeReview,
  getPricingReview,
  saveReviewItemDecision,
} from '@/lib/pricingReviewStore'
import { canCompleteReview } from '@/lib/pricingReview/costChangeReview'
import {
  provisionTestUserAccount,
  readTestUserCredentials,
  signInAsTestUser,
} from '@/lib/testSupport'
import { supabase } from '@/lib/supabaseClient'

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
  dataMonth?: string
}): Promise<string> {
  const fnbshop = await buildFnbShopRecipeDetailXlsx(options.recipes)
  const masters = options.recipes.map((r, i) => ({
    id: String(100 + i),
    objectNumber: r.plu,
    name: r.name,
  }))
  const definitions = masters.map((m, i) => ({
    id: String(1000 + i),
    masterId: m.id,
    firstName: m.name,
    mainMenuLevel: '11111111',
  }))
  const prices = definitions.map((d, i) => ({
    id: String(2000 + i),
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
      fnbshopRecipeDetail: 'fnbshop.xlsx',
      microsMenuItemMaster: 'master.csv',
      microsMenuItemDefinition: 'definition.csv',
      microsMenuItemPrice: 'price.csv',
    },
  })
  expect(built.validation.ok).toBe(true)
  expect(built.commitPayload).toBeTruthy()

  const { data, error } = await supabase.rpc('commit_pricing_data_import', {
    p_payload: {
      ...built.commitPayload,
      data_month: options.dataMonth ?? '2026-10-01',
    },
  })
  expect(error).toBeNull()
  return String((data as { import_id: string }).import_id)
}

describe('Stage 6B Cost Change Review smoke', () => {
  it('imports twice, reviews, decides, reopens, and completes', async () => {
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

    // New imports create a fresh latest/previous pair for this smoke run.
    const firstImportId = await commitFixtureImport({
      recipes: [
        {
          plu: '5000101',
          name: 'Smoke Alpha',
          cost: 21.5,
          sell: 60,
          ingredientName: 'Smoke Alpha, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000102',
          name: 'Smoke Beta',
          cost: 18,
          sell: 55,
          ingredientName: 'Smoke Beta, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000103',
          name: 'Smoke Gamma',
          cost: 20,
          sell: 70,
          ingredientName: 'Smoke Gamma, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000105',
          name: 'Smoke Decrease',
          cost: 30,
          sell: 90,
          ingredientName: 'Smoke Decrease, Btl750 ML',
          measurement: '750 ML',
        },
      ],
      microsPriceByPlu: {
        '5000101': '69',
        '5000102': '55',
        '5000103': '60',
        '5000105': '95',
      },
      dataMonth: '2026-09-01',
    })

    // Brief pause so imported_at ordering is unambiguous if clocks are coarse.
    await new Promise((r) => setTimeout(r, 1100))

    const secondImportId = await commitFixtureImport({
      recipes: [
        {
          plu: '5000101',
          name: 'Smoke Alpha',
          cost: 23,
          sell: 60,
          ingredientName: 'Smoke Alpha, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000102',
          name: 'Smoke Beta',
          cost: 22,
          sell: 55,
          ingredientName: 'Smoke Beta, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000103',
          name: 'Smoke Gamma',
          cost: 24,
          sell: 70,
          ingredientName: 'Smoke Gamma, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000104',
          name: 'Smoke New',
          cost: 22,
          sell: 70,
          ingredientName: 'Smoke New, Btl750 ML',
          measurement: '750 ML',
        },
        {
          plu: '5000105',
          name: 'Smoke Decrease',
          cost: 28,
          sell: 90,
          ingredientName: 'Smoke Decrease, Btl750 ML',
          measurement: '750 ML',
        },
      ],
      microsPriceByPlu: {
        '5000101': '69',
        '5000102': '55',
        '5000103': '60',
        '5000104': '72',
        '5000105': '95',
      },
      dataMonth: '2026-10-01',
    })

    expect(firstImportId).not.toBe(secondImportId)

    const created = await createCostChangeReview(userId)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error)
    expect(created.data.insufficientImports).toBeFalsy()
    expect(created.data.reviewId).toBeTruthy()

    const reviewId = created.data.reviewId
    let loaded = await getPricingReview(reviewId, userId)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.error)

    expect(loaded.data.currentImportId).toBe(secondImportId)
    expect(loaded.data.previousImportId).toBe(firstImportId)
    expect(loaded.data.toleranceGpPoints).toBe(1)
    expect(loaded.data.status).toBe('draft')
    expect(loaded.data.snapshot).toBeTruthy()

    const plus = loaded.data.items.map((i) => i.externalPlu).sort()
    expect(plus).toEqual(expect.arrayContaining(['5000101', '5000102', '5000103', '5000105']))
    expect(loaded.data.presenceSummary.newItems.map((i) => i.externalPlu)).toContain('5000104')

    const alpha = loaded.data.items.find((i) => i.externalPlu === '5000101')
    expect(alpha).toBeTruthy()
    if (!alpha) throw new Error('missing alpha')
    expect(alpha.previousCostExVat).toBe(21.5)
    expect(alpha.currentCostExVat).toBe(23)
    expect(alpha.currentSellingPriceIncVat).toBe(69)
    // Old GP uses previous cost + current price (69), not historical 60.
    expect(alpha.oldGp).toBeGreaterThan(alpha.currentGp)

    const attention = loaded.data.items.filter((i) => i.systemStatus === 'requires_attention')
    expect(attention.length).toBeGreaterThanOrEqual(3)

    const [changeTarget, delistTarget, noActionTarget] = attention

    const changed = await saveReviewItemDecision(reviewId, changeTarget.id, userId, {
      decision: 'change_price',
      proposedPriceIncVat: changeTarget.recommendedPriceIncVat + 1,
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw new Error(changed.error)
    expect(changed.data.proposedPriceIncVat).toBe(changeTarget.recommendedPriceIncVat + 1)
    expect(changed.data.resultingGp).not.toBeNull()

    const delisted = await saveReviewItemDecision(reviewId, delistTarget.id, userId, {
      decision: 'delist',
    })
    expect(delisted.ok).toBe(true)

    const noAction = await saveReviewItemDecision(reviewId, noActionTarget.id, userId, {
      decision: 'no_action',
    })
    expect(noAction.ok).toBe(true)

    // Any remaining attention rows also need decisions.
    loaded = await getPricingReview(reviewId, userId)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.error)
    for (const item of loaded.data.items) {
      if (item.systemStatus === 'requires_attention' && item.decision == null) {
        const extra = await saveReviewItemDecision(reviewId, item.id, userId, {
          decision: 'no_action',
        })
        expect(extra.ok).toBe(true)
      }
    }

    // Save/reopen
    const reopened = await getPricingReview(reviewId, userId)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) throw new Error(reopened.error)
    expect(reopened.data.items.some((i) => i.decision === 'change_price')).toBe(true)
    expect(reopened.data.items.some((i) => i.decision === 'delist')).toBe(true)
    expect(reopened.data.items.some((i) => i.decision === 'no_action')).toBe(true)
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

    // Decision mutation blocked after completion
    const blocked = await saveReviewItemDecision(
      reviewId,
      historical.data.items[0].id,
      userId,
      { decision: 'no_action' }
    )
    expect(blocked.ok).toBe(false)

    await supabase.auth.signOut()

    console.log(
      JSON.stringify(
        {
          ok: true,
          reviewId,
          firstImportId,
          secondImportId,
          itemCount: historical.data.items.length,
          decisions: historical.data.items.map((i) => ({
            plu: i.externalPlu,
            systemStatus: i.systemStatus,
            decision: i.decision,
            oldGp: i.oldGp,
            currentGp: i.currentGp,
            targetGp: i.targetGp,
            recommended: i.recommendedPriceIncVat,
            proposed: i.proposedPriceIncVat,
            resultingGp: i.resultingGp,
          })),
          newItems: historical.data.presenceSummary.newItems.map((i) => i.externalPlu),
        },
        null,
        2
      )
    )
  }, 120_000)
})
