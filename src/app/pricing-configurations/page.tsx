'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/toast-provider'
import {
  PricingPolicyFields,
  fieldStateToPolicy,
  policyToFieldState,
  type PricingPolicyFieldState,
} from '@/components/pricing/PricingPolicyFields'
import {
  RuleSetEditor,
  type RuleSetEditorHandle,
} from '@/components/pricing/RuleSetEditor'
import { validatePricingPolicy } from '@/lib/pricing'
import {
  archivePricingConfiguration,
  createPricingConfiguration,
  getOrCreateCurrentPricingConfiguration,
  isConfigurationFinanciallyComplete,
  listPricingConfigurations,
  makePricingConfigurationCurrent,
  restorePricingConfiguration,
  updatePricingConfiguration,
} from '@/lib/pricingConfigurationStore'
import { supabase } from '@/lib/supabaseClient'
import type { PricingConfiguration } from '@/types/pricingConfigurations'
import type { Rule } from '@/types/rules'

type CreateSourceKind = 'current' | 'another' | 'blank'

export default function PricingConfigurationsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const ruleEditorRef = useRef<RuleSetEditorHandle>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<PricingConfiguration[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const [nameInput, setNameInput] = useState('')
  const [rules, setRules] = useState<Rule[]>([])
  const [policyState, setPolicyState] = useState<PricingPolicyFieldState>(
    policyToFieldState({
      vatRate: 0.2,
      btgBottleDiscount: 0.05,
      bottleRoundingIncrement: 1,
      pourRoundingIncrement: 0.5,
    })
  )
  const [editorError, setEditorError] = useState<string | null>(null)
  const [ruleError, setRuleError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSource, setCreateSource] = useState<CreateSourceKind>('current')
  const [createFromId, setCreateFromId] = useState<string>('')
  const [createError, setCreateError] = useState<string | null>(null)

  const activeConfigs = useMemo(
    () => configs.filter((c) => c.status === 'active'),
    [configs]
  )
  const archivedConfigs = useMemo(
    () => configs.filter((c) => c.status === 'archived'),
    [configs]
  )
  const selected = useMemo(
    () => configs.find((c) => c.id === selectedId) ?? null,
    [configs, selectedId]
  )

  const loadEditor = (config: PricingConfiguration) => {
    setSelectedId(config.id)
    setNameInput(config.name)
    setRules(structuredClone(config.rules))
    setPolicyState(policyToFieldState(config.pricingPolicy))
    setEditorError(null)
    setRuleError(null)
  }

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

      const ensured = await getOrCreateCurrentPricingConfiguration(session.user.id)
      if (!ensured.ok) {
        setLoadError(ensured.error)
        setLoading(false)
        return
      }

      const listed = await listPricingConfigurations(session.user.id)
      if (!listed.ok) {
        setLoadError(listed.error)
        setLoading(false)
        return
      }

      setConfigs(listed.data)
      const current = listed.data.find((c) => c.isCurrent) ?? listed.data[0]
      if (current) {
        loadEditor(current)
      }
      setLoading(false)
    }

    void load()
  }, [router])

  const refreshList = async (uid: string, preferId?: string | null) => {
    const listed = await listPricingConfigurations(uid)
    if (!listed.ok) {
      showToast(listed.error, 'error')
      return null
    }
    setConfigs(listed.data)
    const next =
      (preferId ? listed.data.find((c) => c.id === preferId) : null) ??
      listed.data.find((c) => c.isCurrent) ??
      listed.data[0] ??
      null
    if (next) loadEditor(next)
    return listed.data
  }

  const handleSave = async () => {
    if (!userId || !selected) return
    setEditorError(null)

    const preparedRules = ruleEditorRef.current?.prepareForSave()
    if (!preparedRules) return

    const policy = fieldStateToPolicy(policyState)
    if (!policy) {
      setEditorError('Enter valid percentage and positive rounding values.')
      return
    }
    const policyValidation = validatePricingPolicy(policy)
    if (policyValidation) {
      setEditorError(policyValidation.message)
      return
    }

    setSaving(true)
    const result = await updatePricingConfiguration(
      userId,
      selected.id,
      { name: nameInput, rules: preparedRules, pricingPolicy: policy },
      configs
    )
    setSaving(false)

    if (!result.ok) {
      setEditorError(result.error)
      showToast(result.error, 'error')
      return
    }

    setConfigs((prev) => prev.map((c) => (c.id === result.data.id ? result.data : c)))
    loadEditor(result.data)
    showToast('Configuration saved.', 'success')
  }

  const isEditorDirty = (config: PricingConfiguration): boolean => {
    const policy = fieldStateToPolicy(policyState)
    if (!policy) return true
    if (nameInput.trim() !== config.name.trim()) return true
    if (JSON.stringify(rules) !== JSON.stringify(config.rules)) return true
    if (
      policy.vatRate !== config.pricingPolicy.vatRate ||
      policy.btgBottleDiscount !== config.pricingPolicy.btgBottleDiscount ||
      policy.bottleRoundingIncrement !== config.pricingPolicy.bottleRoundingIncrement ||
      policy.pourRoundingIncrement !== config.pricingPolicy.pourRoundingIncrement
    ) {
      return true
    }
    return false
  }

  const handleMakeCurrent = async () => {
    if (!userId || !selected || selected.isCurrent) return
    if (isEditorDirty(selected)) {
      showToast('Save Changes before making this configuration Current.', 'error')
      return
    }
    if (!isConfigurationFinanciallyComplete(selected)) {
      showToast('Add a valid GP rule set before making this Current.', 'error')
      return
    }

    const confirmed = window.confirm(
      `Make “${selected.name}” Current Pricing?\n\n` +
        '• The Calculator will use this configuration.\n' +
        '• Future Pricing Reviews will use it.\n' +
        '• The previous Current remains available as an alternative.'
    )
    if (!confirmed) return

    setActionBusy(true)
    const result = await makePricingConfigurationCurrent(selected.id)
    setActionBusy(false)

    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    await refreshList(userId, selected.id)
    showToast('Current Pricing updated.', 'success')
  }

  const handleArchive = async () => {
    if (!userId || !selected || selected.isCurrent) return
    if (!window.confirm(`Archive “${selected.name}”? You can restore it later.`)) return

    setActionBusy(true)
    const result = await archivePricingConfiguration(userId, selected.id, configs)
    setActionBusy(false)

    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    setArchivedOpen(true)
    await refreshList(userId, configs.find((c) => c.isCurrent)?.id)
    showToast('Configuration archived.', 'success')
  }

  const handleRestore = async (id: string) => {
    if (!userId) return
    setActionBusy(true)
    const result = await restorePricingConfiguration(userId, id, configs)
    setActionBusy(false)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }
    await refreshList(userId, id)
    showToast('Configuration restored.', 'success')
  }

  const handleCreate = async () => {
    if (!userId) return
    setCreateError(null)

    const source =
      createSource === 'blank'
        ? ({ kind: 'blank' } as const)
        : createSource === 'current'
          ? ({ kind: 'current' } as const)
          : ({ kind: 'configuration', configurationId: createFromId } as const)

    if (source.kind === 'configuration' && !createFromId) {
      setCreateError('Select a configuration to copy.')
      return
    }

    setActionBusy(true)
    const result = await createPricingConfiguration(
      userId,
      { name: createName, source },
      configs
    )
    setActionBusy(false)

    if (!result.ok) {
      setCreateError(result.error)
      showToast(result.error, 'error')
      return
    }

    setCreating(false)
    setCreateName('')
    setCreateSource('current')
    setCreateFromId('')
    await refreshList(userId, result.data.id)
    showToast('Configuration created.', 'success')
  }

  if (loading) {
    return (
      <main className="p-4 md:p-8 max-w-6xl mx-auto">
        <p className="text-gray-500">Loading pricing configurations…</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
        <AppNav active="pricing-configurations" />
        <p className="text-red-600">{loadError}</p>
      </main>
    )
  }

  const otherActiveForCopy = activeConfigs.filter((c) => !c.isCurrent)

  return (
    <main className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <AppNav active="pricing-configurations" />

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 min-h-[70vh]">
        {/* List */}
        <Card className="shadow-md h-fit">
          <CardContent className="py-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Configurations
            </h2>

            <div className="space-y-1">
              {activeConfigs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => loadEditor(c)}
                  className={`w-full text-left rounded-md px-3 py-2 border transition ${
                    selectedId === c.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900 truncate">{c.name}</div>
                  {c.isCurrent && (
                    <div className="text-xs font-semibold text-blue-700 mt-0.5">CURRENT</div>
                  )}
                  {!c.isCurrent && !isConfigurationFinanciallyComplete(c) && (
                    <div className="text-xs text-amber-700 mt-0.5">Incomplete</div>
                  )}
                </button>
              ))}
            </div>

            {archivedConfigs.length > 0 && (
              <div className="pt-2 border-t">
                <button
                  type="button"
                  className="text-sm text-gray-700 font-medium w-full text-left py-1"
                  onClick={() => setArchivedOpen((o) => !o)}
                >
                  Archived {archivedOpen ? '▾' : '▸'}
                </button>
                {archivedOpen && (
                  <div className="space-y-1 mt-1">
                    {archivedConfigs.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-gray-50"
                      >
                        <button
                          type="button"
                          className="text-sm text-gray-700 truncate text-left flex-1"
                          onClick={() => loadEditor(c)}
                        >
                          {c.name}
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionBusy}
                          onClick={() => void handleRestore(c.id)}
                        >
                          Restore
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t">
              {!creating ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setCreating(true)
                    setCreateError(null)
                    const firstOther = otherActiveForCopy[0]?.id ?? ''
                    setCreateFromId(firstOther)
                  }}
                >
                  + New Configuration
                </Button>
              ) : (
                <div className="space-y-3 p-2 border rounded-md bg-gray-50">
                  <div className="text-sm font-medium">New Pricing Configuration</div>
                  <label className="block text-xs font-medium text-gray-700">
                    Name
                    <Input
                      className="mt-1"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="e.g. Higher GP Entry Wines"
                    />
                  </label>
                  <fieldset className="space-y-1">
                    <legend className="text-xs font-medium text-gray-700 mb-1">Start from</legend>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="create-source"
                        checked={createSource === 'current'}
                        onChange={() => setCreateSource('current')}
                      />
                      Current Pricing
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="create-source"
                        checked={createSource === 'another'}
                        onChange={() => setCreateSource('another')}
                        disabled={otherActiveForCopy.length === 0}
                      />
                      Another configuration
                    </label>
                    {createSource === 'another' && (
                      <select
                        className="w-full border rounded-md h-9 px-2 text-sm"
                        value={createFromId}
                        onChange={(e) => setCreateFromId(e.target.value)}
                      >
                        {otherActiveForCopy.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="create-source"
                        checked={createSource === 'blank'}
                        onChange={() => setCreateSource('blank')}
                      />
                      Blank
                    </label>
                  </fieldset>
                  {createError && <p className="text-xs text-red-600">{createError}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={actionBusy}
                      onClick={() => void handleCreate()}
                    >
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCreating(false)
                        setCreateError(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Detail */}
        <Card className="shadow-md">
          <CardContent className="py-6 space-y-6">
            {!selected ? (
              <p className="text-gray-500">Select or create a pricing configuration.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-gray-700">
                      Configuration name
                      <Input
                        className="mt-1 max-w-md"
                        value={nameInput}
                        disabled={selected.status === 'archived'}
                        onChange={(e) => setNameInput(e.target.value)}
                      />
                    </label>
                  </div>
                  {selected.isCurrent && (
                    <span className="text-xs font-bold tracking-wide text-blue-700 border border-blue-300 bg-blue-50 rounded px-2 py-1">
                      CURRENT
                    </span>
                  )}
                  {selected.status === 'archived' && (
                    <span className="text-xs font-bold tracking-wide text-gray-600 border border-gray-300 bg-gray-50 rounded px-2 py-1">
                      ARCHIVED
                    </span>
                  )}
                </div>

                {selected.status === 'archived' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Archived configurations are read-only here. Restore to edit or make Current.
                    </p>
                    <Button disabled={actionBusy} onClick={() => void handleRestore(selected.id)}>
                      Restore
                    </Button>
                  </div>
                ) : (
                  <>
                    <RuleSetEditor
                      key={selected.id}
                      ref={ruleEditorRef}
                      rules={rules}
                      onChange={setRules}
                      allowEmpty={!selected.isCurrent}
                      error={ruleError}
                      onError={setRuleError}
                    />

                    <PricingPolicyFields state={policyState} onChange={setPolicyState} />

                    {editorError && <p className="text-sm text-red-600">{editorError}</p>}

                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button onClick={() => void handleSave()} disabled={saving || actionBusy}>
                        {saving ? 'Saving…' : 'Save Changes'}
                      </Button>
                      {!selected.isCurrent && (
                        <>
                          <Button
                            variant="outline"
                            disabled={actionBusy || !isConfigurationFinanciallyComplete({
                              rules,
                              pricingPolicy:
                                fieldStateToPolicy(policyState) ?? selected.pricingPolicy,
                            })}
                            onClick={() => void handleMakeCurrent()}
                          >
                            Make Current
                          </Button>
                          <Button
                            variant="outline"
                            className="text-red-700 border-red-300"
                            disabled={actionBusy}
                            onClick={() => void handleArchive()}
                          >
                            Archive
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
