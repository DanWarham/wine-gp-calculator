'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toast-provider'
import {
  type PricingPolicy,
  validatePricingPolicy,
} from '@/lib/pricing'
import {
  getOrCreatePricingPolicy,
  percentToRate,
  rateToPercent,
  savePricingPolicy,
} from '@/lib/pricingPolicyStore'

const BOTTLE_ROUNDING_PRESETS = [
  { label: 'Nearest penny / £0.01', value: 0.01 },
  { label: '£0.50', value: 0.5 },
  { label: '£1.00', value: 1 },
  { label: '£5.00', value: 5 },
] as const

const POUR_ROUNDING_PRESETS = [
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

export default function SettingsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [vatPercentInput, setVatPercentInput] = useState('20')
  const [btgPercentInput, setBtgPercentInput] = useState('5')
  const [bottlePreset, setBottlePreset] = useState<number | 'custom'>(1)
  const [bottleCustomInput, setBottleCustomInput] = useState('')
  const [pourPreset, setPourPreset] = useState<number | 'custom'>(0.5)
  const [pourCustomInput, setPourCustomInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push('/welcome')
        return
      }

      const result = await getOrCreatePricingPolicy(session.user.id)
      if (!result.ok) {
        setLoadError(result.error)
        setLoading(false)
        return
      }

      const { policy } = result
      setVatPercentInput(String(rateToPercent(policy.vatRate)))
      setBtgPercentInput(String(rateToPercent(policy.btgBottleDiscount)))

      const bottleMatch = matchingPreset(policy.bottleRoundingIncrement, BOTTLE_ROUNDING_PRESETS)
      setBottlePreset(bottleMatch)
      setBottleCustomInput(
        bottleMatch === 'custom' ? String(policy.bottleRoundingIncrement) : ''
      )

      const pourMatch = matchingPreset(policy.pourRoundingIncrement, POUR_ROUNDING_PRESETS)
      setPourPreset(pourMatch)
      setPourCustomInput(
        pourMatch === 'custom' ? String(policy.pourRoundingIncrement) : ''
      )

      setLoading(false)
    }

    void load()
  }, [router])

  const draftPolicy: PricingPolicy | null = useMemo(() => {
    const vatPercent = Number(vatPercentInput)
    const btgPercent = Number(btgPercentInput)
    if (!Number.isFinite(vatPercent) || !Number.isFinite(btgPercent)) return null

    const bottleRounding =
      bottlePreset === 'custom'
        ? parsePositiveMoney(bottleCustomInput)
        : bottlePreset
    const pourRounding =
      pourPreset === 'custom' ? parsePositiveMoney(pourCustomInput) : pourPreset

    if (bottleRounding === null || pourRounding === null) return null

    return {
      vatRate: percentToRate(vatPercent),
      btgBottleDiscount: percentToRate(btgPercent),
      bottleRoundingIncrement: bottleRounding,
      pourRoundingIncrement: pourRounding,
    }
  }, [
    vatPercentInput,
    btgPercentInput,
    bottlePreset,
    bottleCustomInput,
    pourPreset,
    pourCustomInput,
  ])

  const handleSave = async () => {
    setFormError(null)

    if (!draftPolicy) {
      setFormError('Enter valid percentage and positive rounding values.')
      return
    }

    const validation = validatePricingPolicy(draftPolicy)
    if (validation) {
      setFormError(validation.message)
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      router.push('/welcome')
      return
    }

    setSaving(true)
    const result = await savePricingPolicy(session.user.id, draftPolicy)
    setSaving(false)

    if (!result.ok) {
      setFormError(result.error)
      showToast(result.error, 'error')
      return
    }

    showToast('Pricing policy saved.', 'success')
  }

  if (loading) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto">
        <p className="text-gray-500">Loading settings…</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
        <p className="text-red-600">{loadError}</p>
        <Button variant="outline" onClick={() => router.push('/')}>
          Back to Calculator
        </Button>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-8 max-w-2xl mx-auto space-y-4">
      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/')}>
            Calculator
          </Button>
          <Button variant="outline" onClick={() => router.push('/gp-setup')}>
            Pricing Rules
          </Button>
          <Button variant="secondary" disabled>
            Settings
          </Button>
        </div>
        <Button
          variant="outline"
          className="text-red-600 border-red-400 hover:bg-red-50"
          onClick={async () => {
            await supabase.auth.signOut()
            router.push('/welcome')
          }}
        >
          Logout
        </Button>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <p className="text-sm text-gray-600 pt-1">
            Pricing Policy controls how suggested selling prices are calculated (VAT, BTG bottle
            discount, and commercial rounding). Pricing Rules (GP bands) remain separate.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">Pricing Policy</h2>

            <label className="block text-sm font-medium text-gray-700">
              VAT rate
              <div className="mt-1 flex items-center gap-2 max-w-xs">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={vatPercentInput}
                  onChange={(e) => setVatPercentInput(e.target.value)}
                />
                <span className="text-gray-600">%</span>
              </div>
            </label>

            <label className="block text-sm font-medium text-gray-700 pt-2">
              Bottle discount when wine is offered BTG
              <p className="text-xs font-normal text-gray-500 mt-0.5">
                Applies only to the full-bottle line when by-the-glass is enabled. Glass/pour prices
                are not discounted.
              </p>
              <div className="mt-1 flex items-center gap-2 max-w-xs">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="99.9"
                  value={btgPercentInput}
                  onChange={(e) => setBtgPercentInput(e.target.value)}
                />
                <span className="text-gray-600">%</span>
              </div>
            </label>
          </section>

          <section className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Bottle price rounding
              <select
                className="mt-1 w-full max-w-md border rounded-md h-9 px-3 text-sm"
                value={bottlePreset === 'custom' ? 'custom' : String(bottlePreset)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'custom') {
                    setBottlePreset('custom')
                  } else {
                    setBottlePreset(Number(v))
                  }
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
            {bottlePreset === 'custom' && (
              <div className="flex items-center gap-2 max-w-xs">
                <span className="text-gray-600">£</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 2.00"
                  value={bottleCustomInput}
                  onChange={(e) => setBottleCustomInput(e.target.value)}
                />
              </div>
            )}
          </section>

          <section className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Glass / pour price rounding
              <select
                className="mt-1 w-full max-w-md border rounded-md h-9 px-3 text-sm"
                value={pourPreset === 'custom' ? 'custom' : String(pourPreset)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'custom') {
                    setPourPreset('custom')
                  } else {
                    setPourPreset(Number(v))
                  }
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
            {pourPreset === 'custom' && (
              <div className="flex items-center gap-2 max-w-xs">
                <span className="text-gray-600">£</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 0.25"
                  value={pourCustomInput}
                  onChange={(e) => setPourCustomInput(e.target.value)}
                />
              </div>
            )}
          </section>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex gap-3 pt-2">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/')}>
              Back to Calculator
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
