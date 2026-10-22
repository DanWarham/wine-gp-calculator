import type { ServingSizeCategory } from '@/types/servingSizes'

/** Product default serving sizes used for migration seed and first-use provisioning. */
export interface DefaultServingSizeDefinition {
  category: ServingSizeCategory
  label: string
  volumeMl: number
  displayOrder: number
}

/**
 * Canonical defaults matching pre-Stage-3C calculator pour catalogues.
 * Bottle is intentionally excluded — it remains a core calculator line, not a serving-size row.
 */
export const DEFAULT_SERVING_SIZE_DEFINITIONS: readonly DefaultServingSizeDefinition[] = [
  { category: 'dry', label: 'Small glass', volumeMl: 125, displayOrder: 10 },
  { category: 'dry', label: 'Medium glass', volumeMl: 175, displayOrder: 20 },
  { category: 'dry', label: 'Large glass', volumeMl: 250, displayOrder: 30 },
  { category: 'dry', label: 'Carafe', volumeMl: 500, displayOrder: 40 },
  { category: 'sparkling', label: 'Coravin glass', volumeMl: 125, displayOrder: 10 },
  { category: 'sparkling', label: 'Standard glass', volumeMl: 150, displayOrder: 20 },
  { category: 'sweet_fortified', label: 'Small glass', volumeMl: 75, displayOrder: 10 },
] as const
