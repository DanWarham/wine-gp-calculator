'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toast-provider'
import {
  completePricingDataImport,
  listPricingDataImports,
  listPricingImportIssues,
  validatePricingDataImport,
} from '@/lib/pricingDataImportStore'
import { supabase } from '@/lib/supabaseClient'
import type {
  PricingDataImportResult,
  PricingImportIssue,
  PricingImportSummary,
} from '@/types/pricingDataImport'

type Step = 'select' | 'validated' | 'completed'

export default function PricingDataPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState<string | null>(null)

  const [fnbshopFile, setFnbshopFile] = useState<File | null>(null)
  const [masterFile, setMasterFile] = useState<File | null>(null)
  const [definitionFile, setDefinitionFile] = useState<File | null>(null)
  const [priceFile, setPriceFile] = useState<File | null>(null)

  const [summary, setSummary] = useState<PricingImportSummary | null>(null)
  const [issues, setIssues] = useState<PricingImportIssue[]>([])
  const [result, setResult] = useState<PricingDataImportResult | null>(null)
  const [recentImports, setRecentImports] = useState<
    { id: string; importedAt: string; summary: PricingImportSummary }[]
  >([])
  const [showIssues, setShowIssues] = useState(false)

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
      const listed = await listPricingDataImports(session.user.id)
      if (listed.ok) {
        setRecentImports(
          listed.data.slice(0, 5).map((row) => ({
            id: row.id,
            importedAt: row.importedAt,
            summary: row.summary,
          }))
        )
      }
      setLoading(false)
    }
    void load()
  }, [router])

  const filesReady = Boolean(fnbshopFile && masterFile && definitionFile && priceFile)

  const selectedFiles = () => {
    if (!fnbshopFile || !masterFile || !definitionFile || !priceFile) return null
    return {
      fnbshopRecipeDetail: fnbshopFile,
      microsMenuItemMaster: masterFile,
      microsMenuItemDefinition: definitionFile,
      microsMenuItemPrice: priceFile,
    }
  }

  const onValidate = async () => {
    const files = selectedFiles()
    if (!files) return
    setBusy(true)
    setError(null)
    const validated = await validatePricingDataImport(files)
    setBusy(false)
    if (!validated.ok) {
      setStep('select')
      setSummary(null)
      setIssues(validated.issues ?? [])
      setError(validated.error)
      setShowIssues(true)
      return
    }
    setSummary(validated.preview.summary)
    setIssues(validated.preview.issues)
    setStep('validated')
    setShowIssues(validated.preview.issues.length > 0)
    showToast('Files validated — review the summary before completing.')
  }

  const onComplete = async () => {
    const files = selectedFiles()
    if (!files || !userId) return
    setBusy(true)
    setError(null)
    const completed = await completePricingDataImport(files)
    setBusy(false)
    if (!completed.ok) {
      setError(completed.error)
      setIssues(completed.issues ?? [])
      setShowIssues(true)
      return
    }
    setResult(completed.result)
    setSummary(completed.result.summary)
    setIssues(completed.result.issues)
    setStep('completed')
    setShowIssues(completed.result.issues.length > 0)
    showToast('Pricing data import completed.')

    const listed = await listPricingDataImports(userId)
    if (listed.ok) {
      setRecentImports(
        listed.data.slice(0, 5).map((row) => ({
          id: row.id,
          importedAt: row.importedAt,
          summary: row.summary,
        }))
      )
    }

    // Confirm issues were persisted for this import
    const persisted = await listPricingImportIssues(completed.result.importId, userId)
    if (persisted.ok && persisted.data.length > 0) {
      setIssues(persisted.data)
    }
  }

  const onReset = () => {
    setStep('select')
    setError(null)
    setSummary(null)
    setIssues([])
    setResult(null)
    setShowIssues(false)
    setFnbshopFile(null)
    setMasterFile(null)
    setDefinitionFile(null)
    setPriceFile(null)
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-slate-600">Loading…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <AppNav active="pricing-data" />

      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Pricing Data</h1>
        <p className="mt-1 text-sm text-slate-600">
          Import FnbShop Recipe Detail and Micros menu item reports into an immutable pricing
          snapshot. Pricing Review itself is not built yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Source files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileField
            label="FnbShop Recipe Detail (.xlsx)"
            accept=".xlsx"
            disabled={busy || step === 'completed'}
            file={fnbshopFile}
            onChange={setFnbshopFile}
          />
          <FileField
            label="Micros Menu Item Master (.csv)"
            accept=".csv"
            disabled={busy || step === 'completed'}
            file={masterFile}
            onChange={setMasterFile}
          />
          <FileField
            label="Micros Menu Item Definition (.csv)"
            accept=".csv"
            disabled={busy || step === 'completed'}
            file={definitionFile}
            onChange={setDefinitionFile}
          />
          <FileField
            label="Micros Menu Item Price (.csv)"
            accept=".csv"
            disabled={busy || step === 'completed'}
            file={priceFile}
            onChange={setPriceFile}
          />

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {step !== 'completed' && (
              <Button onClick={() => void onValidate()} disabled={!filesReady || busy}>
                {busy && step === 'select' ? 'Validating…' : 'Validate'}
              </Button>
            )}
            {step === 'validated' && (
              <Button onClick={() => void onComplete()} disabled={busy}>
                {busy ? 'Importing…' : 'Complete import'}
              </Button>
            )}
            {(step === 'validated' || step === 'completed' || error) && (
              <Button variant="outline" onClick={onReset} disabled={busy}>
                Start over
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {step === 'completed' ? 'Import result' : 'Validation summary'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result && (
              <p className="text-slate-600">
                Import completed at {new Date(result.importedAt).toLocaleString()}.
              </p>
            )}
            <SummaryList summary={summary} />
            {issues.length > 0 && (
              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={() => setShowIssues((v) => !v)}>
                  {showIssues ? 'Hide issue details' : `Show issue details (${issues.length})`}
                </Button>
                {showIssues && <IssueList issues={issues} />}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {recentImports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent imports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            {recentImports.map((row) => (
              <div key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
                <span>{new Date(row.importedAt).toLocaleString()}</span>
                <span>
                  {row.summary.matchedCount} matched · {row.summary.excludedExceptionCount}{' '}
                  excluded · {row.summary.fnbshopWineRecipeCount} wine recipes
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  )
}

function FileField({
  label,
  accept,
  file,
  disabled,
  onChange,
}: {
  label: string
  accept: string
  file: File | null
  disabled?: boolean
  onChange: (file: File | null) => void
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      <Input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && <span className="text-xs text-slate-500">{file.name}</span>}
    </label>
  )
}

function SummaryList({ summary }: { summary: PricingImportSummary }) {
  const rows: [string, number][] = [
    ['FnbShop wine recipes', summary.fnbshopWineRecipeCount],
    ['Full bottles', summary.fullBottleCount],
    ['Partial serves', summary.partialServeCount],
    ['Successfully matched', summary.matchedCount],
    ['Excluded item exceptions', summary.excludedExceptionCount],
    ['Ignored Micros-only items', summary.ignoredMicrosOnlyCount],
    ['Informational issues', summary.informationalIssueCount],
  ]
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 rounded bg-slate-50 px-3 py-2">
          <dt>{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function IssueList({ issues }: { issues: PricingImportIssue[] }) {
  const exceptions = issues.filter((i) => i.severity === 'item_exception')
  const info = issues.filter((i) => i.severity === 'informational')
  return (
    <div className="max-h-80 space-y-3 overflow-auto rounded border border-slate-200 p-3">
      {exceptions.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Item exceptions ({exceptions.length})
          </h3>
          <ul className="space-y-1 text-xs text-slate-700">
            {exceptions.map((issue, idx) => (
              <li key={`ex-${idx}`}>
                {issue.externalPlu ? `PLU ${issue.externalPlu}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {info.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Informational ({info.length})
          </h3>
          <ul className="space-y-1 text-xs text-slate-600">
            {info.map((issue, idx) => (
              <li key={`info-${idx}`}>
                {issue.externalPlu ? `PLU ${issue.externalPlu}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
