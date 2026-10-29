import { supabase } from '@/lib/supabaseClient'
import type {
  PricingDataImportResult,
  PricingDataImportRow,
  PricingImportIssue,
  PricingImportSummary,
} from '@/types/pricingDataImport'

export type PricingDataImportStoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function rowToSummary(row: PricingDataImportRow): PricingImportSummary {
  return {
    fnbshopWineRecipeCount: row.fnbshop_wine_recipe_count,
    fullBottleCount: row.full_bottle_count,
    partialServeCount: row.partial_serve_count,
    matchedCount: row.matched_count,
    excludedExceptionCount: row.excluded_exception_count,
    ignoredMicrosOnlyCount: row.ignored_micros_only_count,
    informationalIssueCount: row.informational_issue_count,
  }
}

export function rowToPricingDataImport(row: PricingDataImportRow): {
  id: string
  importedAt: string
  status: 'completed'
  sourceFilenames: Record<string, string>
  summary: PricingImportSummary
} {
  return {
    id: row.id,
    importedAt: row.imported_at,
    status: 'completed',
    sourceFilenames: row.source_filenames ?? {},
    summary: rowToSummary(row),
  }
}

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? `Bearer ${token}` : null
}

function appendFiles(form: FormData, files: {
  fnbshopRecipeDetail: File
  microsMenuItemMaster: File
  microsMenuItemDefinition: File
  microsMenuItemPrice: File
}) {
  form.append('fnbshopRecipeDetail', files.fnbshopRecipeDetail)
  form.append('microsMenuItemMaster', files.microsMenuItemMaster)
  form.append('microsMenuItemDefinition', files.microsMenuItemDefinition)
  form.append('microsMenuItemPrice', files.microsMenuItemPrice)
}

export async function validatePricingDataImport(files: {
  fnbshopRecipeDetail: File
  microsMenuItemMaster: File
  microsMenuItemDefinition: File
  microsMenuItemPrice: File
}): Promise<
  | { ok: true; preview: Omit<PricingDataImportResult, 'importId' | 'importedAt' | 'status'> & { observationCount: number } }
  | { ok: false; blocked: boolean; error: string; issues?: PricingImportIssue[] }
> {
  const header = await authHeader()
  if (!header) return { ok: false, blocked: true, error: 'Authentication required.' }

  const form = new FormData()
  appendFiles(form, files)

  const response = await fetch('/api/pricing-data/validate', {
    method: 'POST',
    headers: { Authorization: header },
    body: form,
  })

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || body.ok === false) {
    return {
      ok: false,
      blocked: true,
      error: String(body.message ?? body.error ?? 'Validation failed.'),
      issues: (body.issues as PricingImportIssue[] | undefined) ?? [],
    }
  }

  return {
    ok: true,
    preview: {
      sourceFilenames: body.sourceFilenames as Record<string, string>,
      summary: body.summary as PricingImportSummary,
      issues: (body.issues as PricingImportIssue[]) ?? [],
      observationCount: Number(body.observationCount ?? 0),
    },
  }
}

export async function completePricingDataImport(files: {
  fnbshopRecipeDetail: File
  microsMenuItemMaster: File
  microsMenuItemDefinition: File
  microsMenuItemPrice: File
}): Promise<
  | { ok: true; result: PricingDataImportResult }
  | { ok: false; blocked: boolean; error: string; issues?: PricingImportIssue[] }
> {
  const header = await authHeader()
  if (!header) return { ok: false, blocked: true, error: 'Authentication required.' }

  const form = new FormData()
  appendFiles(form, files)

  const response = await fetch('/api/pricing-data/import', {
    method: 'POST',
    headers: { Authorization: header },
    body: form,
  })

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || body.ok === false) {
    return {
      ok: false,
      blocked: true,
      error: String(body.message ?? body.error ?? 'Import failed.'),
      issues: (body.issues as PricingImportIssue[] | undefined) ?? [],
    }
  }

  return {
    ok: true,
    result: {
      importId: String(body.importId),
      importedAt: String(body.importedAt),
      status: 'completed',
      sourceFilenames: body.sourceFilenames as Record<string, string>,
      summary: body.summary as PricingImportSummary,
      issues: (body.issues as PricingImportIssue[]) ?? [],
    },
  }
}

export async function listPricingDataImports(
  userId: string
): Promise<PricingDataImportStoreResult<ReturnType<typeof rowToPricingDataImport>[]>> {
  const { data, error } = await supabase
    .from('pricing_data_imports')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('imported_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    data: ((data ?? []) as PricingDataImportRow[]).map(rowToPricingDataImport),
  }
}

export async function listPricingImportIssues(
  importId: string,
  userId: string
): Promise<PricingDataImportStoreResult<PricingImportIssue[]>> {
  const { data, error } = await supabase
    .from('pricing_import_issues')
    .select('external_plu, severity, issue_type, message')
    .eq('import_id', importId)
    .eq('user_id', userId)
    .order('severity', { ascending: true })
    .order('external_plu', { ascending: true })

  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      externalPlu: (row.external_plu as string | null) ?? null,
      severity: row.severity as PricingImportIssue['severity'],
      issueType: String(row.issue_type),
      message: String(row.message),
    })),
  }
}

/**
 * Stage 6B foundation: previous completed import for the same user.
 */
export async function getPreviousCompletedPricingDataImport(
  importId: string
): Promise<PricingDataImportStoreResult<ReturnType<typeof rowToPricingDataImport> | null>> {
  const { data, error } = await supabase.rpc('get_previous_completed_pricing_data_import', {
    p_import_id: importId,
  })

  if (error) return { ok: false, error: error.message }
  // PostgREST may materialise a composite NULL as an object of null fields.
  if (!data || !(data as PricingDataImportRow).id) return { ok: true, data: null }
  return { ok: true, data: rowToPricingDataImport(data as PricingDataImportRow) }
}
