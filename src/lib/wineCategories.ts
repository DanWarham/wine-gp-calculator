import type { ServingSizeCategory } from '@/types/servingSizes'

/** Calculator wine-type option values → persisted serving-size category ids. */
export const WINE_TYPE_OPTIONS = [
  { value: 'Dry', label: 'Dry', category: 'dry' as const },
  { value: 'Sparkling', label: 'Sparkling', category: 'sparkling' as const },
  { value: 'Sweet', label: 'Sweet/Fortified', category: 'sweet_fortified' as const },
] as const

export type WineTypeValue = (typeof WINE_TYPE_OPTIONS)[number]['value']

export function wineTypeToCategory(wineType: string): ServingSizeCategory | null {
  const match = WINE_TYPE_OPTIONS.find((o) => o.value === wineType)
  return match ? match.category : null
}
