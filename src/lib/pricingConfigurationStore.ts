import { supabase } from '@/lib/supabaseClient'
import {
  DEFAULT_PRICING_POLICY,
  validatePricingPolicy,
  validateRuleSetForPricing,
  type PricingPolicy,
} from '@/lib/pricing'
import { seedDefaultServingSizes } from '@/lib/servingSizeStore'
import type { Rule } from '@/types/rules'
import type {
  MakeCurrentResult,
  PricingConfiguration,
  PricingConfigurationCreateInput,
  PricingConfigurationSnapshot,
  PricingConfigurationStatus,
  PricingConfigurationUpdateInput,
} from '@/types/pricingConfigurations'

/** Row shape returned by PostgREST for public.pricing_configurations. */
export interface PricingConfigurationRow {
  id: string
  user_id: string
  name: string
  is_current: boolean
  status: string
  rules: Rule[] | unknown
  vat_rate: number | string
  btg_bottle_discount: number | string
  bottle_rounding_increment: number | string
  pour_rounding_increment: number | string
  created_at: string
  updated_at: string
}

export interface PricingConfigurationSnapshotRow {
  id: string
  user_id: string
  source_configuration_id: string
  source_configuration_name: string
  rules: Rule[] | unknown
  vat_rate: number | string
  btg_bottle_discount: number | string
  bottle_rounding_increment: number | string
  pour_rounding_increment: number | string
  content_hash: string
  created_at: string
}

export type PricingConfigurationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** UI percent (e.g. 20) → domain/DB rate (e.g. 0.2). */
export function percentToRate(percent: number): number {
  return percent / 100
}

/** Domain/DB rate (e.g. 0.2) → UI percent (e.g. 20). */
export function rateToPercent(rate: number): number {
  return rate * 100
}

function toNumber(value: number | string): number {
  if (typeof value === 'number') return value
  return Number(value)
}

function isStatus(value: string): value is PricingConfigurationStatus {
  return value === 'active' || value === 'archived'
}

function parseRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid pricing configuration rules payload.')
  }
  return raw as Rule[]
}

export function rowToPricingPolicy(row: {
  vat_rate: number | string
  btg_bottle_discount: number | string
  bottle_rounding_increment: number | string
  pour_rounding_increment: number | string
}): PricingPolicy {
  return {
    vatRate: toNumber(row.vat_rate),
    btgBottleDiscount: toNumber(row.btg_bottle_discount),
    bottleRoundingIncrement: toNumber(row.bottle_rounding_increment),
    pourRoundingIncrement: toNumber(row.pour_rounding_increment),
  }
}

export function rowToPricingConfiguration(row: PricingConfigurationRow): PricingConfiguration {
  if (!isStatus(row.status)) {
    throw new Error(`Invalid pricing configuration status: ${row.status}`)
  }
  return {
    id: row.id,
    name: row.name,
    isCurrent: row.is_current,
    status: row.status,
    rules: parseRules(row.rules),
    pricingPolicy: rowToPricingPolicy(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function rowToSnapshot(row: PricingConfigurationSnapshotRow): PricingConfigurationSnapshot {
  return {
    id: row.id,
    sourceConfigurationId: row.source_configuration_id,
    sourceConfigurationName: row.source_configuration_name,
    rules: parseRules(row.rules),
    pricingPolicy: rowToPricingPolicy(row),
    contentHash: row.content_hash,
    createdAt: row.created_at,
  }
}

/** Blank alternative / new-user defaults (aligned with DB column defaults). */
export const BLANK_PRICING_CONFIGURATION_DEFAULTS = {
  rules: [] as Rule[],
  pricingPolicy: DEFAULT_PRICING_POLICY,
} as const

export const PROVISIONING_DEFAULTS = DEFAULT_PRICING_POLICY

export function normalizeConfigurationName(name: string): string {
  return name.trim()
}

export function validateConfigurationName(name: string): string | null {
  if (!normalizeConfigurationName(name)) {
    return 'Configuration name is required.'
  }
  return null
}

/** Whether a configuration is financially capturable / promotable. */
export function isConfigurationFinanciallyComplete(config: {
  rules: Rule[]
  pricingPolicy: PricingPolicy
}): boolean {
  if (validatePricingPolicy(config.pricingPolicy)) return false
  if (validateRuleSetForPricing(config.rules)) return false
  return true
}

function mapPostgrestError(
  error: { code?: string; message?: string } | null,
  fallback: string
): string {
  if (!error) return fallback
  if (error.code === '23505') {
    if (error.message?.includes('pricing_configurations_user_name_key')) {
      return 'A pricing configuration with this name already exists.'
    }
    if (error.message?.includes('pricing_configurations_one_current_per_user')) {
      return 'Only one Current pricing configuration is allowed.'
    }
    return 'A conflicting pricing configuration already exists.'
  }
  if (error.code === '23514') {
    return 'Pricing configuration values failed database validation.'
  }
  return error.message || fallback
}

function mapRpcError(error: { message?: string; details?: string } | null, fallback: string): string {
  if (!error) return fallback
  return error.message || error.details || fallback
}

/** Active first (Current first among active), then archived by name. */
export function sortPricingConfigurations(
  configs: PricingConfiguration[]
): PricingConfiguration[] {
  return [...configs].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1
    }
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

export async function listPricingConfigurations(
  userId: string
): Promise<PricingConfigurationResult<PricingConfiguration[]>> {
  const { data, error } = await supabase
    .from('pricing_configurations')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    return { ok: false, error: mapPostgrestError(error, 'Failed to load pricing configurations.') }
  }

  try {
    const mapped = (data as PricingConfigurationRow[]).map(rowToPricingConfiguration)
    return { ok: true, data: sortPricingConfigurations(mapped) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration data.',
    }
  }
}

export async function getCurrentPricingConfiguration(
  userId: string
): Promise<PricingConfigurationResult<PricingConfiguration | null>> {
  const { data, error } = await supabase
    .from('pricing_configurations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    return { ok: false, error: mapPostgrestError(error, 'Failed to load Current pricing configuration.') }
  }

  if (!data) {
    return { ok: true, data: null }
  }

  try {
    return { ok: true, data: rowToPricingConfiguration(data as PricingConfigurationRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid Current pricing configuration data.',
    }
  }
}

/**
 * Load Current Pricing Configuration, creating Main Pricing + default Serving Sizes
 * on genuine first authenticated configuration access.
 *
 * Race-safe via ensure_current_pricing_configuration RPC.
 * Intentionally empty Serving Sizes for an existing user are never reseeded —
 * seeding only runs when the RPC reports created=true.
 */
export async function getOrCreateCurrentPricingConfiguration(
  userId: string
): Promise<PricingConfigurationResult<PricingConfiguration>> {
  const { data, error } = await supabase.rpc('ensure_current_pricing_configuration')

  if (error || !data) {
    return {
      ok: false,
      error: mapRpcError(error, 'Failed to ensure Current pricing configuration.'),
    }
  }

  const payload = data as { configuration: PricingConfigurationRow; created: boolean }

  let configuration: PricingConfiguration
  try {
    configuration = rowToPricingConfiguration(payload.configuration)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration returned from ensure.',
    }
  }

  const policyError = validatePricingPolicy(configuration.pricingPolicy)
  if (policyError) {
    return { ok: false, error: policyError.message }
  }

  if (payload.created) {
    const seed = await seedDefaultServingSizes(userId)
    if (!seed.ok) {
      return { ok: false, error: seed.error }
    }
  }

  return { ok: true, data: configuration }
}

export async function createPricingConfiguration(
  userId: string,
  input: PricingConfigurationCreateInput,
  existing: PricingConfiguration[]
): Promise<PricingConfigurationResult<PricingConfiguration>> {
  const name = normalizeConfigurationName(input.name)
  const nameError = validateConfigurationName(name)
  if (nameError) return { ok: false, error: nameError }

  const duplicate = existing.some(
    (c) => c.name.trim().toLowerCase() === name.toLowerCase()
  )
  if (duplicate) {
    return { ok: false, error: 'A pricing configuration with this name already exists.' }
  }

  let rules: Rule[] = []
  let policy: PricingPolicy = { ...DEFAULT_PRICING_POLICY }

  if (input.source.kind === 'blank') {
    rules = []
    policy = { ...DEFAULT_PRICING_POLICY }
  } else if (input.source.kind === 'current') {
    const current = existing.find((c) => c.isCurrent && c.status === 'active')
    if (!current) {
      return { ok: false, error: 'Current pricing configuration was not found.' }
    }
    rules = structuredClone(current.rules)
    policy = { ...current.pricingPolicy }
  } else if (input.source.kind === 'configuration') {
    const sourceId = input.source.configurationId
    const source = existing.find((c) => c.id === sourceId && c.status === 'active')
    if (!source) {
      return { ok: false, error: 'Source pricing configuration was not found.' }
    }
    rules = structuredClone(source.rules)
    policy = { ...source.pricingPolicy }
  }

  const policyError = validatePricingPolicy(policy)
  if (policyError) {
    return { ok: false, error: policyError.message }
  }

  // Duplicating a complete set must remain valid; blank may be empty.
  if (rules.length > 0) {
    const rulesError = validateRuleSetForPricing(rules)
    if (rulesError) {
      return { ok: false, error: rulesError.message }
    }
  }

  const { data, error } = await supabase
    .from('pricing_configurations')
    .insert([
      {
        name,
        rules,
        vat_rate: policy.vatRate,
        btg_bottle_discount: policy.btgBottleDiscount,
        bottle_rounding_increment: policy.bottleRoundingIncrement,
        pour_rounding_increment: policy.pourRoundingIncrement,
      },
    ])
    .select('*')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: mapPostgrestError(error, 'Failed to create pricing configuration.'),
    }
  }

  // userId is ownership context for callers; insert uses auth.uid() default.
  void userId

  try {
    return { ok: true, data: rowToPricingConfiguration(data as PricingConfigurationRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration after create.',
    }
  }
}

export async function updatePricingConfiguration(
  userId: string,
  id: string,
  input: PricingConfigurationUpdateInput,
  existing: PricingConfiguration[]
): Promise<PricingConfigurationResult<PricingConfiguration>> {
  const current = existing.find((c) => c.id === id)
  if (!current) {
    return { ok: false, error: 'Pricing configuration not found.' }
  }

  const name = normalizeConfigurationName(input.name)
  const nameError = validateConfigurationName(name)
  if (nameError) return { ok: false, error: nameError }

  const duplicate = existing.some(
    (c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase()
  )
  if (duplicate) {
    return { ok: false, error: 'A pricing configuration with this name already exists.' }
  }

  const policyError = validatePricingPolicy(input.pricingPolicy)
  if (policyError) {
    return { ok: false, error: policyError.message }
  }

  // Current must not be casually cleared to an empty rule set.
  if (current.isCurrent && input.rules.length === 0) {
    return {
      ok: false,
      error: 'Current Pricing must keep a valid GP rule set. Empty rules are not allowed.',
    }
  }

  // Normal non-empty saves use authoritative rule validation.
  // Blank alternatives may remain empty until rules are added.
  if (input.rules.length > 0 || current.isCurrent) {
    const rulesError = validateRuleSetForPricing(input.rules)
    if (rulesError) {
      return { ok: false, error: rulesError.message }
    }
  }

  const { data, error } = await supabase
    .from('pricing_configurations')
    .update({
      name,
      rules: input.rules,
      vat_rate: input.pricingPolicy.vatRate,
      btg_bottle_discount: input.pricingPolicy.btgBottleDiscount,
      bottle_rounding_increment: input.pricingPolicy.bottleRoundingIncrement,
      pour_rounding_increment: input.pricingPolicy.pourRoundingIncrement,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: mapPostgrestError(error, 'Failed to save pricing configuration.'),
    }
  }

  try {
    return { ok: true, data: rowToPricingConfiguration(data as PricingConfigurationRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration after save.',
    }
  }
}

export async function archivePricingConfiguration(
  userId: string,
  id: string,
  existing: PricingConfiguration[]
): Promise<PricingConfigurationResult<PricingConfiguration>> {
  const current = existing.find((c) => c.id === id)
  if (!current) {
    return { ok: false, error: 'Pricing configuration not found.' }
  }
  if (current.isCurrent) {
    return { ok: false, error: 'Current Pricing cannot be archived.' }
  }
  if (current.status === 'archived') {
    return { ok: true, data: current }
  }

  const { data, error } = await supabase
    .from('pricing_configurations')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: mapPostgrestError(error, 'Failed to archive pricing configuration.'),
    }
  }

  try {
    return { ok: true, data: rowToPricingConfiguration(data as PricingConfigurationRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration after archive.',
    }
  }
}

export async function restorePricingConfiguration(
  userId: string,
  id: string,
  existing: PricingConfiguration[]
): Promise<PricingConfigurationResult<PricingConfiguration>> {
  const current = existing.find((c) => c.id === id)
  if (!current) {
    return { ok: false, error: 'Pricing configuration not found.' }
  }
  if (current.status === 'active') {
    return { ok: true, data: current }
  }

  const { data, error } = await supabase
    .from('pricing_configurations')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !data) {
    return {
      ok: false,
      error: mapPostgrestError(error, 'Failed to restore pricing configuration.'),
    }
  }

  try {
    return { ok: true, data: rowToPricingConfiguration(data as PricingConfigurationRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid pricing configuration after restore.',
    }
  }
}

export async function makePricingConfigurationCurrent(
  configurationId: string
): Promise<PricingConfigurationResult<MakeCurrentResult>> {
  const { data, error } = await supabase.rpc('make_pricing_configuration_current', {
    p_configuration_id: configurationId,
  })

  if (error || !data) {
    return {
      ok: false,
      error: mapRpcError(error, 'Failed to make pricing configuration Current.'),
    }
  }

  const row = data as {
    previous_configuration_id: string
    previous_snapshot_id: string
    new_configuration_id: string
    new_snapshot_id: string
    event_id: string
    changed_at: string
  }

  return {
    ok: true,
    data: {
      previousConfigurationId: row.previous_configuration_id,
      previousSnapshotId: row.previous_snapshot_id,
      newConfigurationId: row.new_configuration_id,
      newSnapshotId: row.new_snapshot_id,
      eventId: row.event_id,
      changedAt: row.changed_at,
    },
  }
}

export async function capturePricingConfigurationSnapshot(
  configurationId: string
): Promise<PricingConfigurationResult<PricingConfigurationSnapshot>> {
  const { data, error } = await supabase.rpc('capture_pricing_configuration_snapshot', {
    p_configuration_id: configurationId,
  })

  if (error || !data) {
    return {
      ok: false,
      error: mapRpcError(error, 'Failed to capture pricing configuration snapshot.'),
    }
  }

  try {
    return { ok: true, data: rowToSnapshot(data as PricingConfigurationSnapshotRow) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid snapshot payload.',
    }
  }
}
