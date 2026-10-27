'use client'

import { Input } from '@/components/ui/input'
import type { PricingPolicy } from '@/lib/pricing'
import { percentToRate, rateToPercent } from '@/lib/pricingConfigurationStore'

export const BOTTLE_ROUNDING_PRESETS = [
  { label: 'Nearest penny / £0.01', value: 0.01 },
  { label: '£0.50', value: 0.5 },
  { label: '£1.00', value: 1 },
  { label: '£5.00', value: 5 },
] as const

export const POUR_ROUNDING_PRESETS = [
  { label: '£0.10', value: 0.1 },
  { label: '£0.25', value: 0.25 },
  { label: '£0.50', value: 0.5 },
  { label: '£1.00', value: 1 },
] as const

function matchingPreset(
  value: number,
  presets: ReadonlyArray<{ value: number }>
): number | 'custom' {
  const match = presets.find((p) => Math.abs(p.value - value) < 1e-9)
  return match ? match.value : 'custom'
}

function parsePositiveMoney(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export interface PricingPolicyFieldState {
  vatPercentInput: string
  btgPercentInput: string
  bottlePreset: number | 'custom'
  bottleCustomInput: string
  pourPreset: number | 'custom'
  pourCustomInput: string
}

export function policyToFieldState(policy: PricingPolicy): PricingPolicyFieldState {
  const bottleMatch = matchingPreset(policy.bottleRoundingIncrement, BOTTLE_ROUNDING_PRESETS)
  const pourMatch = matchingPreset(policy.pourRoundingIncrement, POUR_ROUNDING_PRESETS)
  return {
    vatPercentInput: String(rateToPercent(policy.vatRate)),
    btgPercentInput: String(rateToPercent(policy.btgBottleDiscount)),
    bottlePreset: bottleMatch,
    bottleCustomInput: bottleMatch === 'custom' ? String(policy.bottleRoundingIncrement) : '',
    pourPreset: pourMatch,
    pourCustomInput: pourMatch === 'custom' ? String(policy.pourRoundingIncrement) : '',
  }
}

export function fieldStateToPolicy(state: PricingPolicyFieldState): PricingPolicy | null {
  const vatPercent = Number(state.vatPercentInput)
  const btgPercent = Number(state.btgPercentInput)
  if (!Number.isFinite(vatPercent) || !Number.isFinite(btgPercent)) return null

  const bottleRounding =
    state.bottlePreset === 'custom'
      ? parsePositiveMoney(state.bottleCustomInput)
      : state.bottlePreset
  const pourRounding =
    state.pourPreset === 'custom' ? parsePositiveMoney(state.pourCustomInput) : state.pourPreset

  if (bottleRounding === null || pourRounding === null) return null

  return {
    vatRate: percentToRate(vatPercent),
    btgBottleDiscount: percentToRate(btgPercent),
    bottleRoundingIncrement: bottleRounding,
    pourRoundingIncrement: pourRounding,
  }
}

interface PricingPolicyFieldsProps {
  state: PricingPolicyFieldState
  onChange: (next: PricingPolicyFieldState) => void
  disabled?: boolean
}

export function PricingPolicyFields({ state, onChange, disabled }: PricingPolicyFieldsProps) {
  const patch = (partial: Partial<PricingPolicyFieldState>) => {
    onChange({ ...state, ...partial })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Pricing Policy</h3>

      <label className="block text-sm font-medium text-gray-700">
        VAT rate
        <div className="mt-1 flex items-center gap-2 max-w-xs">
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            disabled={disabled}
            value={state.vatPercentInput}
            onChange={(e) => patch({ vatPercentInput: e.target.value })}
          />
          <span className="text-gray-600">%</span>
        </div>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Bottle discount when wine is offered BTG
        <p className="text-xs font-normal text-gray-500 mt-0.5">
          Applies only to the full-bottle line when by-the-glass is enabled. Glass/pour prices are
          not discounted.
        </p>
        <div className="mt-1 flex items-center gap-2 max-w-xs">
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="99.9"
            disabled={disabled}
            value={state.btgPercentInput}
            onChange={(e) => patch({ btgPercentInput: e.target.value })}
          />
          <span className="text-gray-600">%</span>
        </div>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Bottle price rounding
        <select
          className="mt-1 w-full max-w-md border rounded-md h-9 px-3 text-sm disabled:opacity-60"
          disabled={disabled}
          value={state.bottlePreset === 'custom' ? 'custom' : String(state.bottlePreset)}
          onChange={(e) => {
            const v = e.target.value
            patch({ bottlePreset: v === 'custom' ? 'custom' : Number(v) })
          }}
        >
          {BOTTLE_ROUNDING_PRESETS.map((p) => (
            <option key={p.value} value={String(p.value)}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {state.bottlePreset === 'custom' && (
        <div className="flex items-center gap-2 max-w-xs">
          <span className="text-gray-600">£</span>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            disabled={disabled}
            placeholder="e.g. 2.00"
            value={state.bottleCustomInput}
            onChange={(e) => patch({ bottleCustomInput: e.target.value })}
          />
        </div>
      )}

      <label className="block text-sm font-medium text-gray-700">
        Glass / pour price rounding
        <select
          className="mt-1 w-full max-w-md border rounded-md h-9 px-3 text-sm disabled:opacity-60"
          disabled={disabled}
          value={state.pourPreset === 'custom' ? 'custom' : String(state.pourPreset)}
          onChange={(e) => {
            const v = e.target.value
            patch({ pourPreset: v === 'custom' ? 'custom' : Number(v) })
          }}
        >
          {POUR_ROUNDING_PRESETS.map((p) => (
            <option key={p.value} value={String(p.value)}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {state.pourPreset === 'custom' && (
        <div className="flex items-center gap-2 max-w-xs">
          <span className="text-gray-600">£</span>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            disabled={disabled}
            placeholder="e.g. 0.25"
            value={state.pourCustomInput}
            onChange={(e) => patch({ pourCustomInput: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
