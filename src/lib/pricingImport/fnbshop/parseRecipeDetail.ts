import { readFirstSheetRows } from '@/lib/pricingImport/fnbshop/readXlsxRows'
import { parsePackageVolumeMl, parseVolumeMl } from '@/lib/pricingImport/volumes'

export interface FnbShopIngredient {
  description: string
  measurement: string | null
  cost: number | null
  recipeVolumeMl: number | null
  packageVolumeMl: number | null
}

export interface FnbShopRecipe {
  plu: string
  description: string
  category: string | null
  costExVat: number | null
  sellingPriceIncVat: number | null
  ingredients: FnbShopIngredient[]
}

export interface FnbShopParseResult {
  recipes: FnbShopRecipe[]
  headerRowFound: boolean
}

const REQUIRED_HEADERS = [
  'PLU Number',
  'Menu Name',
  'Measurement',
  'Cost Price',
  'Selling Price',
] as const

/** Lime Wood wine PLU range for the current FnbShop/Micros source only. */
export const LIME_WOOD_WINE_PLU_MIN = 5_000_000
export const LIME_WOOD_WINE_PLU_MAX = 5_999_999

export function isLimeWoodWinePlu(plu: string): boolean {
  if (!/^\d+$/.test(plu)) return false
  const n = Number(plu)
  return n >= LIME_WOOD_WINE_PLU_MIN && n <= LIME_WOOD_WINE_PLU_MAX
}

function cellText(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const t = value.trim()
    return t === '' ? null : t
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value)
    return String(value)
  }
  const t = String(value).trim()
  return t === '' ? null : t
}

function cellNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const t = String(value).trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function isPluCell(value: unknown): string | null {
  const text = cellText(value)
  if (!text) return null
  const normalised = text.replace(/\.0+$/, '')
  if (!/^\d+$/.test(normalised)) return null
  return normalised
}

function isCategoryRow(row: unknown[]): boolean {
  const first = cellText(row[0])
  if (!first) return false
  if (isPluCell(row[0])) return false
  return first.includes('>')
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((v) => v == null || String(v).trim() === '')
}

/**
 * Parse FnbShop "Recipe Detail" / RECIPE LIST workbook.
 * Source-specific: expects the Lime Wood export layout.
 */
export async function parseFnbShopRecipeDetail(
  buffer: ArrayBuffer | Buffer | Uint8Array
): Promise<FnbShopParseResult> {
  let matrix: unknown[][]
  try {
    matrix = await readFirstSheetRows(buffer)
  } catch {
    throw new FnbShopParseError('Failed to parse FnbShop Recipe Detail workbook.')
  }

  let headerIndex = -1
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const row = matrix[i] ?? []
    const texts = row.map((c) => cellText(c) ?? '')
    if (REQUIRED_HEADERS.every((h) => texts.includes(h))) {
      headerIndex = i
      break
    }
  }

  if (headerIndex < 0) {
    throw new FnbShopParseError(
      'FnbShop file is not a recognisable Recipe Detail report (required columns missing).'
    )
  }

  const header = (matrix[headerIndex] ?? []).map((c) => cellText(c) ?? '')
  const col = {
    plu: header.indexOf('PLU Number'),
    name: header.indexOf('Menu Name'),
    measurement: header.indexOf('Measurement'),
    cost: header.indexOf('Cost Price'),
    sell: header.indexOf('Selling Price'),
  }

  const recipes: FnbShopRecipe[] = []
  let currentCategory: string | null = null
  let i = headerIndex + 1

  while (i < matrix.length) {
    const row = matrix[i] ?? []
    if (isBlankRow(row)) {
      i++
      continue
    }
    if (isCategoryRow(row)) {
      currentCategory = cellText(row[0])
      i++
      continue
    }

    const plu = isPluCell(row[col.plu])
    const name = cellText(row[col.name])
    if (plu && name) {
      const recipe: FnbShopRecipe = {
        plu,
        description: name,
        category: currentCategory,
        costExVat: cellNumber(row[col.cost]),
        sellingPriceIncVat: cellNumber(row[col.sell]),
        ingredients: [],
      }
      i++
      while (i < matrix.length) {
        const ingRow = matrix[i] ?? []
        if (isBlankRow(ingRow)) break
        if (isCategoryRow(ingRow)) break
        if (isPluCell(ingRow[col.plu])) break

        const ingName = cellText(ingRow[col.name])
        if (ingName) {
          const measurement = cellText(ingRow[col.measurement])
          recipe.ingredients.push({
            description: ingName,
            measurement,
            cost: cellNumber(ingRow[col.cost]),
            recipeVolumeMl: parseVolumeMl(measurement),
            packageVolumeMl: parsePackageVolumeMl(ingName),
          })
        }
        i++
      }
      recipes.push(recipe)
      continue
    }

    i++
  }

  return { recipes, headerRowFound: true }
}

export function filterWineRecipes(recipes: FnbShopRecipe[]): FnbShopRecipe[] {
  return recipes.filter((r) => isLimeWoodWinePlu(r.plu))
}

export class FnbShopParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FnbShopParseError'
  }
}
