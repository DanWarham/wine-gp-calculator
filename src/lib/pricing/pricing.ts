import { roundToIncrement } from './rounding'
import { resolveTargetGp, toReferenceCost750ml } from './rules'
import type { PriceSaleInput, PriceSaleResult, PricingPolicy, SaleContext } from './types'
import {
  isValidGp,
  isValidNonNegativeCost,
  isValidPositiveMl,
  validatePricingPolicy,
} from './validation'

/**
 * Raw bottle-equivalent selling price (inc VAT) before BTG discount, volume scaling, or rounding.
 */
export function rawBottleSellingPrice(
  actualCostExVat: number,
  gp: number,
  vatRate: number
): number {
  return (actualCostExVat * (1 + vatRate)) / (1 - gp / 100)
}

function rawSaleFromBottleBase(
  rawBottlePrice: number,
  bottleSizeMl: number,
  saleContext: SaleContext,
  policy: PricingPolicy
): { rawSalePrice: number; btgDiscountApplied: boolean; roundingIncrement: number } {
  if (saleContext.kind === 'bottle') {
    if (saleContext.applyBtgDiscount) {
      const discounted = rawBottlePrice * (1 - policy.btgBottleDiscount)
      return {
        rawSalePrice: discounted,
        btgDiscountApplied: true,
        roundingIncrement: policy.bottleRoundingIncrement,
      }
    }
    return {
      rawSalePrice: rawBottlePrice,
      btgDiscountApplied: false,
      roundingIncrement: policy.bottleRoundingIncrement,
    }
  }

  // Pours always use the undiscounted bottle-equivalent basis.
  const pourPrice = (rawBottlePrice / bottleSizeMl) * saleContext.pourMl
  return {
    rawSalePrice: pourPrice,
    btgDiscountApplied: false,
    roundingIncrement: policy.pourRoundingIncrement,
  }
}

/**
 * Price a bottle or pour using an explicit GP and pricing policy.
 * Does not resolve rules.
 */
export function priceWithGp(input: {
  actualCostExVat: number
  bottleSizeMl: number
  gp: number
  pricingPolicy: PricingPolicy
  saleContext: SaleContext
  referenceCost750ml?: number
}): PriceSaleResult {
  const { actualCostExVat, bottleSizeMl, gp, pricingPolicy, saleContext } = input

  if (!isValidNonNegativeCost(actualCostExVat)) {
    return {
      ok: false,
      error: { code: 'INVALID_COST', message: 'Acquisition cost must be a finite non-negative number.' },
    }
  }

  if (!isValidPositiveMl(bottleSizeMl)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_BOTTLE_SIZE',
        message: 'Bottle size must be a positive finite volume in ml.',
      },
    }
  }

  if (!isValidGp(gp)) {
    return {
      ok: false,
      error: { code: 'INVALID_GP', message: 'GP must satisfy 0 < GP < 100.' },
    }
  }

  const policyError = validatePricingPolicy(pricingPolicy)
  if (policyError) {
    return { ok: false, error: policyError }
  }

  if (saleContext.kind === 'pour' && !isValidPositiveMl(saleContext.pourMl)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_POUR_VOLUME',
        message: 'Pour volume must be a positive finite volume in ml.',
      },
    }
  }

  const referenceCost750ml =
    input.referenceCost750ml ?? toReferenceCost750ml(actualCostExVat, bottleSizeMl)

  const rawBottlePrice = rawBottleSellingPrice(actualCostExVat, gp, pricingPolicy.vatRate)
  const { rawSalePrice, btgDiscountApplied, roundingIncrement } = rawSaleFromBottleBase(
    rawBottlePrice,
    bottleSizeMl,
    saleContext,
    pricingPolicy
  )

  if (!Number.isFinite(rawBottlePrice) || !Number.isFinite(rawSalePrice)) {
    return {
      ok: false,
      error: { code: 'INVALID_GP', message: 'Pricing calculation produced a non-finite result.' },
      referenceCost750ml,
    }
  }

  const roundedSalePrice = roundToIncrement(rawSalePrice, roundingIncrement)

  return {
    ok: true,
    referenceCost750ml,
    targetGp: gp,
    matchedRule: null,
    rawBottlePrice,
    rawSalePrice,
    roundedSalePrice,
    btgDiscountApplied,
  }
}

/**
 * Price a sale: resolve GP from rules unless `gpOverride` is provided.
 */
export function priceSale(input: PriceSaleInput): PriceSaleResult {
  const {
    actualCostExVat,
    bottleSizeMl,
    pricingPolicy,
    saleContext,
    gpOverride,
    rules,
  } = input

  if (gpOverride !== undefined) {
    if (!isValidGp(gpOverride)) {
      return {
        ok: false,
        error: { code: 'INVALID_GP', message: 'GP must satisfy 0 < GP < 100.' },
      }
    }

    const priced = priceWithGp({
      actualCostExVat,
      bottleSizeMl,
      gp: gpOverride,
      pricingPolicy,
      saleContext,
    })

    if (!priced.ok) return priced
    return { ...priced, matchedRule: null }
  }

  if (!rules) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_RULES',
        message: 'Rules are required when no GP override is supplied.',
      },
    }
  }

  const resolved = resolveTargetGp({ actualCostExVat, bottleSizeMl, rules })
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      referenceCost750ml: resolved.referenceCost750ml,
    }
  }

  const priced = priceWithGp({
    actualCostExVat,
    bottleSizeMl,
    gp: resolved.targetGp,
    pricingPolicy,
    saleContext,
    referenceCost750ml: resolved.referenceCost750ml,
  })

  if (!priced.ok) return priced

  return {
    ...priced,
    matchedRule: resolved.matchedRule,
    targetGp: resolved.targetGp,
  }
}
