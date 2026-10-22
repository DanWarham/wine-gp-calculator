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
import {
  createServingSize,
  deleteServingSize,
  listServingSizes,
  moveServingSize,
  setServingSizeEnabled,
  sortServingSizes,
  updateServingSize,
} from '@/lib/servingSizeStore'
import type { ServingSize, ServingSizeCategory } from '@/types/servingSizes'
import {
  SERVING_SIZE_CATEGORIES,
  SERVING_SIZE_CATEGORY_LABELS,
} from '@/types/servingSizes'

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

  const [userId, setUserId] = useState<string | null>(null)
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

  const [servingSizes, setServingSizes] = useState<ServingSize[]>([])
  const [servingBusyId, setServingBusyId] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState<ServingSizeCategory | null>(null)
  const [addLabel, setAddLabel] = useState('')
  const [addVolume, setAddVolume] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editVolume, setEditVolume] = useState('')
  const [servingError, setServingError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push('/welcome')
        return
      }

      setUserId(session.user.id)

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

      const servings = await listServingSizes(session.user.id)
      if (!servings.ok) {
        setLoadError(servings.error)
        setLoading(false)
        return
      }
      setServingSizes(servings.data)

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

  const servingsByCategory = useMemo(() => {
    const map: Record<ServingSizeCategory, ServingSize[]> = {
      dry: [],
      sparkling: [],
      sweet_fortified: [],
    }
    for (const row of sortServingSizes(servingSizes)) {
      map[row.category].push(row)
    }
    return map
  }, [servingSizes])

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

  const requireUser = (): string | null => {
    if (!userId) {
      router.push('/welcome')
      return null
    }
    return userId
  }

  const handleAdd = async (category: ServingSizeCategory) => {
    const uid = requireUser()
    if (!uid) return
    setServingError(null)
    const volumeMl = Number(addVolume)
    setServingBusyId(`add-${category}`)
    const result = await createServingSize(
      uid,
      { category, label: addLabel, volumeMl },
      servingSizes
    )
    setServingBusyId(null)
    if (!result.ok) {
      setServingError(result.error)
      showToast(result.error, 'error')
      return
    }
    setServingSizes((prev) => sortServingSizes([...prev, result.data]))
    setAddingCategory(null)
    setAddLabel('')
    setAddVolume('')
    showToast('Serving size added.', 'success')
  }

  const handleSaveEdit = async (id: string) => {
    const uid = requireUser()
    if (!uid) return
    setServingError(null)
    const volumeMl = Number(editVolume)
    setServingBusyId(id)
    const result = await updateServingSize(
      uid,
      id,
      { label: editLabel, volumeMl },
      servingSizes
    )
    setServingBusyId(null)
    if (!result.ok) {
      setServingError(result.error)
      showToast(result.error, 'error')
      return
    }
    setServingSizes((prev) =>
      sortServingSizes(prev.map((r) => (r.id === id ? result.data : r)))
    )
    setEditingId(null)
    showToast('Serving size updated.', 'success')
  }

  const handleToggleEnabled = async (row: ServingSize) => {
    const uid = requireUser()
    if (!uid) return
    setServingError(null)
    setServingBusyId(row.id)
    const result = await setServingSizeEnabled(uid, row.id, !row.enabled)
    setServingBusyId(null)
    if (!result.ok) {
      setServingError(result.error)
      showToast(result.error, 'error')
      return
    }
    setServingSizes((prev) =>
      sortServingSizes(prev.map((r) => (r.id === row.id ? result.data : r)))
    )
  }

  const handleMove = async (id: string, direction: 'up' | 'down') => {
    const uid = requireUser()
    if (!uid) return
    setServingError(null)
    setServingBusyId(id)
    const result = await moveServingSize(uid, id, direction, servingSizes)
    setServingBusyId(null)
    if (!result.ok) {
      setServingError(result.error)
      showToast(result.error, 'error')
      return
    }
    setServingSizes(result.data)
  }

  const handleDelete = async (row: ServingSize) => {
    const uid = requireUser()
    if (!uid) return
    if (!window.confirm(`Delete “${row.label}” (${row.volumeMl}ml)?`)) return
    setServingError(null)
    setServingBusyId(row.id)
    const result = await deleteServingSize(uid, row.id)
    setServingBusyId(null)
    if (!result.ok) {
      setServingError(result.error)
      showToast(result.error, 'error')
      return
    }
    setServingSizes((prev) => prev.filter((r) => r.id !== row.id))
    if (editingId === row.id) setEditingId(null)
    showToast('Serving size deleted.', 'success')
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
            Pricing Policy and Serving Sizes control calculator behaviour. Pricing Rules (GP bands)
            remain separate under Pricing Rules.
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
              {saving ? 'Saving…' : 'Save pricing policy'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Serving Sizes</CardTitle>
          <p className="text-sm text-gray-600 pt-1">
            Configure pour and carafe sizes for each fixed wine category. The full-bottle line is
            separate and is not managed here. Disabled sizes stay in Settings but are hidden on the
            calculator.
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {servingError && <p className="text-sm text-red-600">{servingError}</p>}

          {SERVING_SIZE_CATEGORIES.map((category) => {
            const rows = servingsByCategory[category]
            return (
              <section key={category} className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-800">
                  {SERVING_SIZE_CATEGORY_LABELS[category]}
                </h3>

                {rows.length === 0 ? (
                  <p className="text-sm text-gray-500">No serving sizes configured.</p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((row, index) => {
                      const busy = servingBusyId === row.id
                      const editing = editingId === row.id
                      return (
                        <li
                          key={row.id}
                          className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={row.enabled}
                              disabled={busy}
                              onChange={() => void handleToggleEnabled(row)}
                              aria-label={`Enable ${row.label}`}
                            />
                            {editing ? (
                              <div className="flex flex-wrap gap-2 items-center">
                                <Input
                                  className="w-40"
                                  value={editLabel}
                                  onChange={(e) => setEditLabel(e.target.value)}
                                  placeholder="Name"
                                />
                                <div className="flex items-center gap-1">
                                  <Input
                                    className="w-24"
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    step={1}
                                    value={editVolume}
                                    onChange={(e) => setEditVolume(e.target.value)}
                                  />
                                  <span className="text-sm text-gray-600">ml</span>
                                </div>
                              </div>
                            ) : (
                              <div className={!row.enabled ? 'opacity-60' : undefined}>
                                <div className="font-medium text-gray-900">{row.label}</div>
                                <div className="text-sm text-gray-600">{row.volumeMl} ml</div>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-1 justify-end">
                            {editing ? (
                              <>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void handleSaveEdit(row.id)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setEditingId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || index === 0}
                                  onClick={() => void handleMove(row.id, 'up')}
                                  aria-label="Move up"
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || index === rows.length - 1}
                                  onClick={() => void handleMove(row.id, 'down')}
                                  aria-label="Move down"
                                >
                                  ↓
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditingId(row.id)
                                    setEditLabel(row.label)
                                    setEditVolume(String(row.volumeMl))
                                    setServingError(null)
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-300"
                                  disabled={busy}
                                  onClick={() => void handleDelete(row)}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {addingCategory === category ? (
                  <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <Input
                        className="w-44"
                        placeholder="Name"
                        value={addLabel}
                        onChange={(e) => setAddLabel(e.target.value)}
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          className="w-24"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          placeholder="ml"
                          value={addVolume}
                          onChange={(e) => setAddVolume(e.target.value)}
                        />
                        <span className="text-sm text-gray-600">ml</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={servingBusyId === `add-${category}`}
                        onClick={() => void handleAdd(category)}
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddingCategory(null)
                          setAddLabel('')
                          setAddVolume('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAddingCategory(category)
                      setAddLabel('')
                      setAddVolume('')
                      setServingError(null)
                    }}
                  >
                    + Add serving size
                  </Button>
                )}
              </section>
            )
          })}

          <Button variant="outline" onClick={() => router.push('/')}>
            Back to Calculator
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
