'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toast-provider'
import {
  countImportsForDataMonth,
  currentDataMonthIso,
  dataMonthFromMonthInput,
  formatDataMonth,
  monthInputFromDataMonth,
} from '@/lib/pricingImport/dataMonth'
import { buildImportIssuesCsv, issueDisplayName } from '@/lib/pricingImport/issueDisplay'
import {
  completePricingDataImport,
  deletePricingDataImport,
  listPricingDataImports,
  listPricingImportIssues,
  validatePricingDataImport,
  type PricingDataImportListItem,
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

  const [dataMonth, setDataMonth] = useState(currentDataMonthIso())
  const [fnbshopFile, setFnbshopFile] = useState<File | null>(null)
  const [masterFile, setMasterFile] = useState<File | null>(null)
  const [definitionFile, setDefinitionFile] = useState<File | null>(null)
  const [priceFile, setPriceFile] = useState<File | null>(null)

  const [summary, setSummary] = useState<PricingImportSummary | null>(null)
  const [issues, setIssues] = useState<PricingImportIssue[]>([])
  const [result, setResult] = useState<PricingDataImportResult | null>(null)
  const [recentImports, setRecentImports] = useState<PricingDataImportListItem[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sameMonthCount = useMemo(
    () => countImportsForDataMonth(recentImports, dataMonth),
    [recentImports, dataMonth]
  )

  const reloadImports = async (uid: string) => {
    const listed = await listPricingDataImports(uid)
    if (listed.ok) setRecentImports(listed.data)
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
      await reloadImports(session.user.id)
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
    const validated = await validatePricingDataImport(files, dataMonth)
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
    const completed = await completePricingDataImport(files, dataMonth)
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

    await reloadImports(userId)

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

  const onDeleteImport = async (importRow: PricingDataImportListItem) => {
    if (!userId) return
    const label = formatDataMonth(importRow.dataMonth)
    const confirmed = window.confirm(
      `Delete the ${label} import from ${new Date(importRow.importedAt).toLocaleString()}?\n\n` +
        'This removes its observations and issues. Draft Pricing Reviews that use this import are also deleted.\n' +
        'Completed Pricing Reviews that depend on this import will block deletion.'
    )
    if (!confirmed) return

    setDeletingId(importRow.id)
    const deleted = await deletePricingDataImport(importRow.id)
    setDeletingId(null)
    if (!deleted.ok) {
      showToast(deleted.error)
      return
    }
    showToast(
      deleted.data.draftReviewsDeleted > 0
        ? `Import deleted (${deleted.data.draftReviewsDeleted} draft review(s) removed).`
        : 'Import deleted.'
    )
    await reloadImports(userId)
    if (result?.importId === importRow.id) onReset()
  }

  const onExportIssuesCsv = () => {
    if (issues.length === 0) return
    const csv = buildImportIssuesCsv(issues)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pricing-import-issues-${result?.importId?.slice(0, 8) ?? 'preview'}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
          snapshot for a chosen data month.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Source files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-800">Data month</span>
            <Input
              type="month"
              disabled={busy || step === 'completed'}
              value={monthInputFromDataMonth(dataMonth)}
              onChange={(e) => {
                const next = dataMonthFromMonthInput(e.target.value)
                if (next) setDataMonth(next)
              }}
            />
            <span className="text-xs text-slate-500">
              Dataset month: {formatDataMonth(dataMonth)} (upload time is stored separately)
            </span>
          </label>

          {sameMonthCount > 0 && step !== 'completed' && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              There {sameMonthCount === 1 ? 'is already' : 'are already'} {sameMonthCount} completed
              import{sameMonthCount === 1 ? '' : 's'} for {formatDataMonth(dataMonth)}. Another
              import is allowed; the latest upload for that month becomes the current dataset.
            </div>
          )}

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
                {formatDataMonth(result.dataMonth)} · imported{' '}
                {new Date(result.importedAt).toLocaleString()}.
              </p>
            )}
            <SummaryList summary={summary} />
            {issues.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowIssues((v) => !v)}>
                    {showIssues ? 'Hide issue details' : `Show issue details (${issues.length})`}
                  </Button>
                  <Button variant="outline" size="sm" onClick={onExportIssuesCsv}>
                    Export Issues CSV
                  </Button>
                </div>
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
            {recentImports.slice(0, 12).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 py-2 last:border-0"
              >
                <div>
                  <div className="font-medium">{formatDataMonth(row.dataMonth)}</div>
                  <div className="text-xs text-slate-500">
                    Uploaded {new Date(row.importedAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {row.summary.matchedCount} matched · {row.summary.excludedExceptionCount}{' '}
                    excluded · {row.summary.fnbshopWineRecipeCount} wine recipes
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deletingId === row.id}
                  onClick={() => void onDeleteImport(row)}
                >
                  {deletingId === row.id ? 'Deleting…' : 'Delete'}
                </Button>
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
  return (
    <div className="max-h-96 overflow-auto rounded border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left sticky top-0">
          <tr className="border-b">
            <th className="px-2 py-1.5 font-medium">PLU</th>
            <th className="px-2 py-1.5 font-medium">Wine</th>
            <th className="px-2 py-1.5 font-medium">Severity</th>
            <th className="px-2 py-1.5 font-medium">Issue type</th>
            <th className="px-2 py-1.5 font-medium">Message</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, idx) => (
            <tr key={`${issue.externalPlu ?? 'x'}-${idx}`} className="border-b align-top">
              <td className="px-2 py-1.5 whitespace-nowrap">{issue.externalPlu ?? '—'}</td>
              <td className="px-2 py-1.5">{issueDisplayName(issue)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                {issue.severity === 'item_exception' ? 'Exception' : 'Informational'}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">{issue.issueType}</td>
              <td className="px-2 py-1.5 text-slate-700">{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
