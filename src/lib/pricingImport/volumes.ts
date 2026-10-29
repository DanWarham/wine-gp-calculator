/**
 * Volume parsing helpers for Lime Wood FnbShop recipe measurements and package sizes.
 * Supports ML / CL / L (case-insensitive). Does not assume 750ml.
 */

const VOLUME_TOKEN_SOURCE = String.raw`(\d+(?:\.\d+)?)\s*(ML|CL|L)\b`

export function volumeToMl(amount: number, unit: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const u = unit.trim().toUpperCase()
  if (u === 'ML') return amount
  if (u === 'CL') return amount * 10
  if (u === 'L') return amount * 1000
  return null
}

/** Parse the first volume token in a measurement string (e.g. "12.5 ML", "75 ML"). */
export function parseVolumeMl(text: string | null | undefined): number | null {
  if (!text) return null
  const match = new RegExp(VOLUME_TOKEN_SOURCE, 'i').exec(text)
  if (!match) return null
  return volumeToMl(Number(match[1]), match[2])
}

/**
 * Derive package/bottle size from an ingredient description.
 * Uses the last volume token (e.g. "Guiraud, Btl750 ML (2001)" → 750).
 */
export function parsePackageVolumeMl(description: string | null | undefined): number | null {
  if (!description) return null
  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  const re = new RegExp(VOLUME_TOKEN_SOURCE, 'gi')
  while ((match = re.exec(description)) !== null) {
    last = match
  }
  if (!last) return null
  return volumeToMl(Number(last[1]), last[2])
}

export type ServeClassification =
  | { itemType: 'full_bottle'; recipeVolumeMl: number; packageVolumeMl: number }
  | { itemType: 'partial_serve'; recipeVolumeMl: number; packageVolumeMl: number }
  | { itemType: null; recipeVolumeMl: number | null; packageVolumeMl: number | null; reason: string }

export function classifyServe(
  recipeVolumeMl: number | null,
  packageVolumeMl: number | null
): ServeClassification {
  if (recipeVolumeMl == null || packageVolumeMl == null) {
    return {
      itemType: null,
      recipeVolumeMl,
      packageVolumeMl,
      reason: 'Bottle/package size could not be resolved safely from the recipe measurement and ingredient description.',
    }
  }
  if (recipeVolumeMl === packageVolumeMl) {
    return { itemType: 'full_bottle', recipeVolumeMl, packageVolumeMl }
  }
  if (recipeVolumeMl < packageVolumeMl) {
    return { itemType: 'partial_serve', recipeVolumeMl, packageVolumeMl }
  }
  return {
    itemType: null,
    recipeVolumeMl,
    packageVolumeMl,
    reason: `Recipe volume (${recipeVolumeMl}ml) exceeds package volume (${packageVolumeMl}ml).`,
  }
}
