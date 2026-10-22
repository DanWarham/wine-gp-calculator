import { describe, expect, it } from 'vitest'
import { WINE_TYPE_OPTIONS, wineTypeToCategory } from '@/lib/wineCategories'
import {
  SERVING_SIZE_CATEGORIES,
  SERVING_SIZE_CATEGORY_LABELS,
  type ServingSizeCategory,
} from '@/types/servingSizes'

describe('wine type category mapping', () => {
  it('maps each calculator wine type onto the canonical category ids', () => {
    expect(WINE_TYPE_OPTIONS.map((option) => option.category)).toEqual([
      ...SERVING_SIZE_CATEGORIES,
    ])
    expect(wineTypeToCategory('Dry')).toBe('dry')
    expect(wineTypeToCategory('Sparkling')).toBe('sparkling')
    expect(wineTypeToCategory('Sweet')).toBe('sweet_fortified')
    expect(wineTypeToCategory('sweet_fortified')).toBeNull()
    expect(wineTypeToCategory('')).toBeNull()
  })

  it('uses the canonical category labels, including Sweet / Fortified', () => {
    for (const option of WINE_TYPE_OPTIONS) {
      expect(option.label).toBe(SERVING_SIZE_CATEGORY_LABELS[option.category])
    }
    expect(SERVING_SIZE_CATEGORY_LABELS.sweet_fortified).toBe('Sweet / Fortified')
  })

  it('covers each category once', () => {
    const categories = WINE_TYPE_OPTIONS.map((option) => option.category)
    const unique = new Set<ServingSizeCategory>(categories)
    expect(unique.size).toBe(SERVING_SIZE_CATEGORIES.length)
  })
})
