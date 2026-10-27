'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/toast-provider'
import { getOrCreateCurrentPricingConfiguration } from '@/lib/pricingConfigurationStore'
import {
  createServingSize,
  deleteServingSize,
  listServingSizes,
  moveServingSize,
  setServingSizeEnabled,
  sortServingSizes,
  updateServingSize,
} from '@/lib/servingSizeStore'
import { supabase } from '@/lib/supabaseClient'
import type { ServingSize, ServingSizeCategory } from '@/types/servingSizes'
import {
  SERVING_SIZE_CATEGORIES,
  SERVING_SIZE_CATEGORY_LABELS,
} from '@/types/servingSizes'

export default function SettingsPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

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

      // Ensures first-use Main Pricing + Serving Size seeding when Settings is visited first.
      const config = await getOrCreateCurrentPricingConfiguration(session.user.id)
      if (!config.ok) {
        setLoadError(config.error)
        setLoading(false)
        return
      }

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
      <AppNav active="settings" />

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <p className="text-sm text-gray-600 pt-1">
            Serving Sizes control calculator pour/carafe lines. GP Rules and Pricing Policy are
            edited under Pricing Configurations.
          </p>
        </CardHeader>
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
