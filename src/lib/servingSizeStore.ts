import { supabase } from '@/lib/supabaseClient'
import { DEFAULT_SERVING_SIZE_DEFINITIONS } from '@/lib/servingSizeDefaults'
import type {
  ServingSize,
  ServingSizeCategory,
  ServingSizeCreateInput,
  ServingSizeUpdateInput,
} from '@/types/servingSizes'
import { SERVING_SIZE_CATEGORIES } from '@/types/servingSizes'

export interface ServingSizeRow {
  id: string
  user_id: string
  category: string
  label: string
  volume_ml: number
  enabled: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export type ServingSizeResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function isServingSizeCategory(value: string): value is ServingSizeCategory {
  return (SERVING_SIZE_CATEGORIES as readonly string[]).includes(value)
}

export function rowToServingSize(row: ServingSizeRow): ServingSize {
  if (!isServingSizeCategory(row.category)) {
    throw new Error(`Invalid serving size category: ${row.category}`)
  }
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    volumeMl: row.volume_ml,
    enabled: row.enabled,
    displayOrder: row.display_order,
  }
}

/** Stable sort: display_order ascending, then label, then id. */
export function sortServingSizes(rows: ServingSize[]): ServingSize[] {
  return [...rows].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    const labelCmp = a.label.localeCompare(b.label)
    if (labelCmp !== 0) return labelCmp
    return a.id.localeCompare(b.id)
  })
}

/** Calculator helper: category match + enabled + ordered. */
export function servingSizesForCalculator(
  rows: ServingSize[],
  category: ServingSizeCategory
): ServingSize[] {
  return sortServingSizes(rows.filter((r) => r.category === category && r.enabled))
}

export function validateServingSizeFields(input: {
  category: string
  label: string
  volumeMl: number
}): string | null {
  if (!isServingSizeCategory(input.category)) {
    return 'Invalid wine category.'
  }
  const trimmed = input.label.trim()
  if (!trimmed) {
    return 'Serving size name is required.'
  }
  if (!Number.isInteger(input.volumeMl) || input.volumeMl <= 0) {
    return 'Volume must be a positive whole number of millilitres.'
  }
  return null
}

function mapError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.code === '23505') {
    return 'A serving size with this name already exists in this category.'
  }
  if (error.code === '23514') {
    return 'Serving size values failed database validation.'
  }
  return error.message || fallback
}

function normalizeLabel(label: string): string {
  return label.trim()
}

/**
 * Insert product-default serving sizes for a user.
 * Conflict-safe: does not overwrite or duplicate existing labels.
 * Intended only for first-use provisioning alongside Current Pricing Configuration
 * creation — do not call merely because serving_sizes is empty.
 */
export async function seedDefaultServingSizes(userId: string): Promise<ServingSizeResult<void>> {
  const rows = DEFAULT_SERVING_SIZE_DEFINITIONS.map((d) => ({
    user_id: userId,
    category: d.category,
    label: d.label,
    volume_ml: d.volumeMl,
    enabled: true,
    display_order: d.displayOrder,
  }))

  const { error } = await supabase.from('serving_sizes').insert(rows)
  if (!error) {
    return { ok: true, data: undefined }
  }

  // Batch failed (often unique conflict under concurrency). Insert one-by-one;
  // ignore unique violations so parallel first-use / partial seeds stay safe.
  for (const row of rows) {
    const { error: oneError } = await supabase.from('serving_sizes').insert([row])
    if (oneError && oneError.code !== '23505') {
      return { ok: false, error: mapError(oneError, 'Failed to seed default serving sizes.') }
    }
  }

  return { ok: true, data: undefined }
}

/** Load all serving sizes for a user (including disabled). Empty is a valid configured state. */
export async function listServingSizes(userId: string): Promise<ServingSizeResult<ServingSize[]>> {
  const { data, error } = await supabase
    .from('serving_sizes')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    return { ok: false, error: mapError(error, 'Failed to load serving sizes.') }
  }

  try {
    const mapped = (data as ServingSizeRow[]).map(rowToServingSize)
    return { ok: true, data: sortServingSizes(mapped) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid serving size data returned from the database.',
    }
  }
}

export async function createServingSize(
  userId: string,
  input: ServingSizeCreateInput,
  existing: ServingSize[]
): Promise<ServingSizeResult<ServingSize>> {
  const label = normalizeLabel(input.label)
  const fieldError = validateServingSizeFields({
    category: input.category,
    label,
    volumeMl: input.volumeMl,
  })
  if (fieldError) return { ok: false, error: fieldError }

  const duplicate = existing.some(
    (r) =>
      r.category === input.category && r.label.trim().toLowerCase() === label.toLowerCase()
  )
  if (duplicate) {
    return { ok: false, error: 'A serving size with this name already exists in this category.' }
  }

  const categoryRows = existing.filter((r) => r.category === input.category)
  const maxOrder = categoryRows.reduce((max, r) => Math.max(max, r.displayOrder), 0)
  const displayOrder = maxOrder + 10

  const { data, error } = await supabase
    .from('serving_sizes')
    .insert([
      {
        user_id: userId,
        category: input.category,
        label,
        volume_ml: input.volumeMl,
        enabled: true,
        display_order: displayOrder,
      },
    ])
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: mapError(error, 'Failed to add serving size.') }
  }

  return { ok: true, data: rowToServingSize(data as ServingSizeRow) }
}

export async function updateServingSize(
  userId: string,
  id: string,
  input: ServingSizeUpdateInput,
  existing: ServingSize[]
): Promise<ServingSizeResult<ServingSize>> {
  const current = existing.find((r) => r.id === id)
  if (!current) {
    return { ok: false, error: 'Serving size not found.' }
  }

  const label = normalizeLabel(input.label)
  const fieldError = validateServingSizeFields({
    category: current.category,
    label,
    volumeMl: input.volumeMl,
  })
  if (fieldError) return { ok: false, error: fieldError }

  const duplicate = existing.some(
    (r) =>
      r.id !== id &&
      r.category === current.category &&
      r.label.trim().toLowerCase() === label.toLowerCase()
  )
  if (duplicate) {
    return { ok: false, error: 'A serving size with this name already exists in this category.' }
  }

  const { data, error } = await supabase
    .from('serving_sizes')
    .update({
      label,
      volume_ml: input.volumeMl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: mapError(error, 'Failed to update serving size.') }
  }

  return { ok: true, data: rowToServingSize(data as ServingSizeRow) }
}

export async function setServingSizeEnabled(
  userId: string,
  id: string,
  enabled: boolean
): Promise<ServingSizeResult<ServingSize>> {
  const { data, error } = await supabase
    .from('serving_sizes')
    .update({
      enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: mapError(error, 'Failed to update serving size.') }
  }

  return { ok: true, data: rowToServingSize(data as ServingSizeRow) }
}

export async function deleteServingSize(
  userId: string,
  id: string
): Promise<ServingSizeResult<void>> {
  const { error } = await supabase
    .from('serving_sizes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    return { ok: false, error: mapError(error, 'Failed to delete serving size.') }
  }

  return { ok: true, data: undefined }
}

/** Swap display_order with the neighbour above/below within the same category. */
export async function moveServingSize(
  userId: string,
  id: string,
  direction: 'up' | 'down',
  existing: ServingSize[]
): Promise<ServingSizeResult<ServingSize[]>> {
  const current = existing.find((r) => r.id === id)
  if (!current) {
    return { ok: false, error: 'Serving size not found.' }
  }

  const ordered = sortServingSizes(existing.filter((r) => r.category === current.category))
  const index = ordered.findIndex((r) => r.id === id)
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
    return { ok: true, data: existing }
  }

  const other = ordered[swapIndex]
  const now = new Date().toISOString()

  const { error: errA } = await supabase
    .from('serving_sizes')
    .update({ display_order: other.displayOrder, updated_at: now })
    .eq('id', current.id)
    .eq('user_id', userId)

  if (errA) {
    return { ok: false, error: mapError(errA, 'Failed to reorder serving sizes.') }
  }

  const { error: errB } = await supabase
    .from('serving_sizes')
    .update({ display_order: current.displayOrder, updated_at: now })
    .eq('id', other.id)
    .eq('user_id', userId)

  if (errB) {
    // Best-effort rollback of first update
    await supabase
      .from('serving_sizes')
      .update({ display_order: current.displayOrder, updated_at: now })
      .eq('id', current.id)
      .eq('user_id', userId)
    return { ok: false, error: mapError(errB, 'Failed to reorder serving sizes.') }
  }

  return listServingSizes(userId)
}
