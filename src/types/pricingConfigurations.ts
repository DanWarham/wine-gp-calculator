import type { Rule } from '@/types/rules'
import type { PricingPolicy } from '@/lib/pricing'

export type PricingConfigurationStatus = 'active' | 'archived'

/** Canonical Pricing Configuration shape used by UI and stores. */
export interface PricingConfiguration {
  id: string
  name: string
  isCurrent: boolean
  status: PricingConfigurationStatus
  rules: Rule[]
  pricingPolicy: PricingPolicy
  createdAt: string
  updatedAt: string
}

export type PricingConfigurationCreateSource =
  | { kind: 'current' }
  | { kind: 'configuration'; configurationId: string }
  | { kind: 'blank' }

export interface PricingConfigurationCreateInput {
  name: string
  source: PricingConfigurationCreateSource
}

export interface PricingConfigurationUpdateInput {
  name: string
  rules: Rule[]
  pricingPolicy: PricingPolicy
}

export interface PricingConfigurationSnapshot {
  id: string
  sourceConfigurationId: string
  sourceConfigurationName: string
  rules: Rule[]
  pricingPolicy: PricingPolicy
  contentHash: string
  createdAt: string
}

export interface MakeCurrentResult {
  previousConfigurationId: string
  previousSnapshotId: string
  newConfigurationId: string
  newSnapshotId: string
  eventId: string
  changedAt: string
}
