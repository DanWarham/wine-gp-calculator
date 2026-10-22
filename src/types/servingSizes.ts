/** Fixed wine categories for serving-size configuration (Stage 3C). */
export type ServingSizeCategory = 'dry' | 'sparkling' | 'sweet_fortified'

/** Canonical serving-size shape shared by persistence, Settings, and calculator. */
export interface ServingSize {
  id: string
  category: ServingSizeCategory
  label: string
  volumeMl: number
  enabled: boolean
  displayOrder: number
}

/** Input for creating a new serving size (category taken from the Add context). */
export interface ServingSizeCreateInput {
  category: ServingSizeCategory
  label: string
  volumeMl: number
}

/** Editable fields for an existing serving size. */
export interface ServingSizeUpdateInput {
  label: string
  volumeMl: number
}

export const SERVING_SIZE_CATEGORIES: readonly ServingSizeCategory[] = [
  'dry',
  'sparkling',
  'sweet_fortified',
] as const

export const SERVING_SIZE_CATEGORY_LABELS: Record<ServingSizeCategory, string> = {
  dry: 'Dry',
  sparkling: 'Sparkling',
  sweet_fortified: 'Sweet / Fortified',
}
