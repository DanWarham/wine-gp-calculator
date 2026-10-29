import { decodeCsvBuffer, parseCsv } from '@/lib/pricingImport/csv'
import { isLimeWoodWinePlu } from '@/lib/pricingImport/fnbshop/parseRecipeDetail'

export interface MicrosMasterRow {
  id: string
  objectNumber: string
  menuItemName: string
  status: string
}

export interface MicrosDefinitionRow {
  id: string
  menuItemMasterId: string
  firstName: string
  mainMenuLevel: string
}

export interface MicrosPriceRow {
  id: string
  menuItemDefId: string
  price: string
  menuLevel: string
  priceSequence: string
}

export interface MicrosParsedReports {
  masters: MicrosMasterRow[]
  definitions: MicrosDefinitionRow[]
  prices: MicrosPriceRow[]
}

export class MicrosParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MicrosParseError'
  }
}

const MASTER_REQUIRED = ['Id', 'MenuItemName', 'ObjectNumber'] as const
const DEFINITION_REQUIRED = ['Id', 'MenuItemMasterId', 'MainMenuLevel', 'FirstName'] as const
const PRICE_REQUIRED = ['Id', 'MenuItemDefID', 'Price'] as const

function requireHeaders(headers: string[], required: readonly string[], reportName: string) {
  const missing = required.filter((h) => !headers.includes(h))
  if (missing.length > 0) {
    throw new MicrosParseError(
      `Micros ${reportName} is missing required columns: ${missing.join(', ')}.`
    )
  }
}

export function parseMicrosMenuItemMaster(
  buffer: ArrayBuffer | Buffer | Uint8Array
): MicrosMasterRow[] {
  const { headers, rows } = parseCsv(decodeCsvBuffer(buffer))
  requireHeaders(headers, MASTER_REQUIRED, 'Menu Item Master')
  return rows.map((r) => ({
    id: r.Id,
    objectNumber: r.ObjectNumber,
    menuItemName: r.MenuItemName,
    status: r.Status ?? '',
  }))
}

export function parseMicrosMenuItemDefinition(
  buffer: ArrayBuffer | Buffer | Uint8Array
): MicrosDefinitionRow[] {
  const { headers, rows } = parseCsv(decodeCsvBuffer(buffer))
  requireHeaders(headers, DEFINITION_REQUIRED, 'Menu Item Definition')
  return rows.map((r) => ({
    id: r.Id,
    menuItemMasterId: r.MenuItemMasterId,
    firstName: r.FirstName ?? '',
    mainMenuLevel: (r.MainMenuLevel ?? '').replace(/\t/g, '').trim(),
  }))
}

export function parseMicrosMenuItemPrice(
  buffer: ArrayBuffer | Buffer | Uint8Array
): MicrosPriceRow[] {
  const { headers, rows } = parseCsv(decodeCsvBuffer(buffer))
  requireHeaders(headers, PRICE_REQUIRED, 'Menu Item Price')
  return rows.map((r) => ({
    id: r.Id,
    menuItemDefId: r.MenuItemDefID,
    price: r.Price ?? '',
    menuLevel: r.MenuLevel ?? '',
    priceSequence: r.PriceSequence ?? '',
  }))
}

export function parseMicrosReports(files: {
  master: ArrayBuffer | Buffer | Uint8Array
  definition: ArrayBuffer | Buffer | Uint8Array
  price: ArrayBuffer | Buffer | Uint8Array
}): MicrosParsedReports {
  return {
    masters: parseMicrosMenuItemMaster(files.master),
    definitions: parseMicrosMenuItemDefinition(files.definition),
    prices: parseMicrosMenuItemPrice(files.price),
  }
}

/** Normalise Micros Main Menu Level bitfield / numeric forms. */
export function normaliseMainMenuLevel(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\t/g, '').trim()
}

export function isMainMenuLevelZero(level: string): boolean {
  const n = normaliseMainMenuLevel(level)
  if (n === '' || n === '0') return true
  // Lime Wood export uses 8-character bit fields: 00000000 = disabled
  if (/^0+$/.test(n)) return true
  return false
}

export function isMainMenuLevelActiveLooking(level: string): boolean {
  const n = normaliseMainMenuLevel(level)
  return n === '11111111'
}

export function isStructuralHeadingName(name: string): boolean {
  return name.includes('***') || name.includes('###')
}

/** Micros-only "RC" items (word boundary), current Lime Wood convention. */
export function isMicrosRcItem(name: string): boolean {
  return /\bRC\b/i.test(name)
}

export function parsePriceNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export interface MicrosResolvedItem {
  plu: string
  masterId: string
  definitionId: string
  description: string
  mainMenuLevel: string
  sellingPriceIncVat: number | null
  priceAmbiguous: boolean
  missingPrice: boolean
}

/**
 * Join Master → Definition → Price for wine-range PLUs.
 * Expected 1:1:1 for Lime Wood wine items; ambiguity is flagged.
 */
export function buildMicrosWineIndex(
  reports: MicrosParsedReports
): {
  byPlu: Map<string, MicrosResolvedItem[]>
  linkStructureOk: boolean
  linkStructureMessage: string | null
} {
  const defsByMaster = new Map<string, MicrosDefinitionRow[]>()
  for (const d of reports.definitions) {
    const list = defsByMaster.get(d.menuItemMasterId) ?? []
    list.push(d)
    defsByMaster.set(d.menuItemMasterId, list)
  }

  const pricesByDef = new Map<string, MicrosPriceRow[]>()
  for (const p of reports.prices) {
    const list = pricesByDef.get(p.menuItemDefId) ?? []
    list.push(p)
    pricesByDef.set(p.menuItemDefId, list)
  }

  // Structural sanity: wine-range masters should generally resolve through the chain.
  const wineMasters = reports.masters.filter((m) => isLimeWoodWinePlu(m.objectNumber))
  if (wineMasters.length === 0) {
    return {
      byPlu: new Map(),
      linkStructureOk: false,
      linkStructureMessage:
        'Micros Menu Item Master contains no wine-range ObjectNumbers (5000000–5999999).',
    }
  }

  let linked = 0
  for (const m of wineMasters) {
    const defs = defsByMaster.get(m.id) ?? []
    if (defs.length === 0) continue
    const prices = pricesByDef.get(defs[0].id) ?? []
    if (prices.length > 0) linked++
  }

  // If almost nothing links, the reports are the wrong shape / unrelated extracts.
  const linkRatio = linked / wineMasters.length
  if (linkRatio < 0.5) {
    return {
      byPlu: new Map(),
      linkStructureOk: false,
      linkStructureMessage:
        'Required Micros Master → Definition → Price link structure is unavailable for most wine-range items.',
    }
  }

  const byPlu = new Map<string, MicrosResolvedItem[]>()
  for (const m of wineMasters) {
    const defs = defsByMaster.get(m.id) ?? []
    if (defs.length === 0) {
      const item: MicrosResolvedItem = {
        plu: m.objectNumber,
        masterId: m.id,
        definitionId: '',
        description: m.menuItemName,
        mainMenuLevel: '',
        sellingPriceIncVat: null,
        priceAmbiguous: false,
        missingPrice: true,
      }
      const list = byPlu.get(m.objectNumber) ?? []
      list.push(item)
      byPlu.set(m.objectNumber, list)
      continue
    }

    for (const d of defs) {
      const prices = pricesByDef.get(d.id) ?? []
      const numericPrices = prices
        .map((p) => parsePriceNumber(p.price))
        .filter((n): n is number => n != null)
      const uniquePrices = [...new Set(numericPrices)]
      const missingPrice = prices.length === 0 || uniquePrices.length === 0
      const priceAmbiguous = uniquePrices.length > 1 || defs.length > 1

      const item: MicrosResolvedItem = {
        plu: m.objectNumber,
        masterId: m.id,
        definitionId: d.id,
        description: m.menuItemName || d.firstName,
        mainMenuLevel: normaliseMainMenuLevel(d.mainMenuLevel),
        sellingPriceIncVat: uniquePrices.length === 1 ? uniquePrices[0] : null,
        priceAmbiguous,
        missingPrice,
      }
      const list = byPlu.get(m.objectNumber) ?? []
      list.push(item)
      byPlu.set(m.objectNumber, list)
    }
  }

  return { byPlu, linkStructureOk: true, linkStructureMessage: null }
}
