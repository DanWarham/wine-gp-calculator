import {
  SERVING_SIZE_CATEGORY_LABELS,
  type ServingSizeCategory,
} from '@/types/servingSizes'

/**
 * Calculator wine-type select values.
 * Category ids and labels come from the canonical serving-size categories.
 * The sweet/fortified select value stays `Sweet` (local calculator state only).
 */
export const WINE_TYPE_OPTIONS = [
  { value: 'Dry', category: 'dry', label: SERVING_SIZE_CATEGORY_LABELS.dry },
  { value: 'Sparkling', category: 'sparkling', label: SERVING_SIZE_CATEGORY_LABELS.sparkling },
  {
    value: 'Sweet',
    category: 'sweet_fortified',
    label: SERVING_SIZE_CATEGORY_LABELS.sweet_fortified,
  },
] as const satisfies readonly {
  value: string
  category: ServingSizeCategory
  label: string
}[]

export type WineTypeValue = (typeof WINE_TYPE_OPTIONS)[number]['value']

export function wineTypeToCategory(wineType: string): ServingSizeCategory | null {
  const match = WINE_TYPE_OPTIONS.find((o) => o.value === wineType)
  return match ? match.category : null
}
