import { supabase } from '@/lib/supabaseClient'
import { fetchAllPagedRows } from '@/lib/supabasePagedSelect'
import { resolveImportItemName } from '@/lib/pricingImport/issueDisplay'
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
  dataMonth: string
  status: 'completed'
  sourceFilenames: Record<string, string>
  summary: PricingImportSummary
} {
  return {
    id: row.id,
    importedAt: row.imported_at,
    dataMonth: String(row.data_month).slice(0, 10),
    status: 'completed',
    sourceFilenames: row.source_filenames ?? {},
    summary: rowToSummary(row),
  }
}

export type PricingDataImportListItem = ReturnType<typeof rowToPricingDataImport>

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? `Bearer ${token}` : null
}

function appendFiles(
  form: FormData,
  files: {
    fnbshopRecipeDetail: File
    microsMenuItemMaster: File
    microsMenuItemDefinition: File
    microsMenuItemPrice: File
  },
  dataMonth: string
) {
  form.append('fnbshopRecipeDetail', files.fnbshopRecipeDetail)
  form.append('microsMenuItemMaster', files.microsMenuItemMaster)
  form.append('microsMenuItemDefinition', files.microsMenuItemDefinition)
  form.append('microsMenuItemPrice', files.microsMenuItemPrice)
  form.append('dataMonth', dataMonth)
}

export async function validatePricingDataImport(
  files: {
    fnbshopRecipeDetail: File
    microsMenuItemMaster: File
    microsMenuItemDefinition: File
    microsMenuItemPrice: File
  },
  dataMonth: string
): Promise<
  | {
      ok: true
      preview: Omit<PricingDataImportResult, 'importId' | 'importedAt' | 'status'> & {
        observationCount: number
      }
    }
  | { ok: false; blocked: boolean; error: string; issues?: PricingImportIssue[] }
> {
  const header = await authHeader()
  if (!header) return { ok: false, blocked: true, error: 'Authentication required.' }

  const form = new FormData()
  appendFiles(form, files, dataMonth)

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
      dataMonth: String(body.dataMonth ?? dataMonth),
      sourceFilenames: body.sourceFilenames as Record<string, string>,
      summary: body.summary as PricingImportSummary,
      issues: (body.issues as PricingImportIssue[]) ?? [],
      observationCount: Number(body.observationCount ?? 0),
    },
  }
}

export async function completePricingDataImport(
  files: {
    fnbshopRecipeDetail: File
    microsMenuItemMaster: File
    microsMenuItemDefinition: File
    microsMenuItemPrice: File
  },
  dataMonth: string
): Promise<
  | { ok: true; result: PricingDataImportResult }
  | { ok: false; blocked: boolean; error: string; issues?: PricingImportIssue[] }
> {
  const header = await authHeader()
  if (!header) return { ok: false, blocked: true, error: 'Authentication required.' }

  const form = new FormData()
  appendFiles(form, files, dataMonth)

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
      dataMonth: String(body.dataMonth ?? dataMonth),
      status: 'completed',
      sourceFilenames: body.sourceFilenames as Record<string, string>,
      summary: body.summary as PricingImportSummary,
      issues: (body.issues as PricingImportIssue[]) ?? [],
    },
  }
}

export async function listPricingDataImports(
  userId: string
): Promise<PricingDataImportStoreResult<PricingDataImportListItem[]>> {
  const { data, error } = await supabase
    .from('pricing_data_imports')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('data_month', { ascending: false })
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
  const paged = await fetchAllPagedRows<{
    external_plu: string | null
    item_name: string | null
    severity: string
    issue_type: string
    message: string
  }>((from, to) =>
    supabase
      .from('pricing_import_issues')
      .select('external_plu, item_name, severity, issue_type, message')
      .eq('import_id', importId)
      .eq('user_id', userId)
      .order('severity', { ascending: true })
      .order('external_plu', { ascending: true })
      .range(from, to)
  )

  if (!paged.ok) return paged

  // Backfill names for older rows from observations when item_name is null.
  const needsLookup = paged.data.filter((row) => !row.item_name && row.external_plu)
  const nameByPlu = new Map<string, string>()
  if (needsLookup.length > 0) {
    const obs = await fetchAllPagedRows<{
      external_plu: string
      fnbshop_description: string | null
      micros_description: string | null
    }>((from, to) =>
      supabase
        .from('pricing_observations')
        .select('external_plu, fnbshop_description, micros_description')
        .eq('import_id', importId)
        .eq('user_id', userId)
        .range(from, to)
    )
    if (obs.ok) {
      for (const row of obs.data) {
        const name = resolveImportItemName(row.fnbshop_description, row.micros_description)
        if (name) nameByPlu.set(row.external_plu, name)
      }
    }
  }

  return {
    ok: true,
    data: paged.data.map((row) => ({
      externalPlu: row.external_plu ?? null,
      itemName:
        row.item_name ??
        (row.external_plu ? nameByPlu.get(row.external_plu) ?? null : null),
      severity: row.severity as PricingImportIssue['severity'],
      issueType: String(row.issue_type),
      message: String(row.message),
    })),
  }
}

/**
 * Previous completed import for Cost Change: latest import in the previous
 * available data month (not merely previous upload timestamp).
 */
export async function getPreviousCompletedPricingDataImport(
  importId: string
): Promise<PricingDataImportStoreResult<PricingDataImportListItem | null>> {
  const { data, error } = await supabase.rpc('get_previous_completed_pricing_data_import', {
    p_import_id: importId,
  })

  if (error) return { ok: false, error: error.message }
  if (!data || !(data as PricingDataImportRow).id) return { ok: true, data: null }
  return { ok: true, data: rowToPricingDataImport(data as PricingDataImportRow) }
}

/**
 * Delete an import when no completed Pricing Review depends on it.
 * Draft reviews referencing the import are removed with it.
 */
export async function deletePricingDataImport(
  importId: string
): Promise<PricingDataImportStoreResult<{ importId: string; draftReviewsDeleted: number }>> {
  const { data, error } = await supabase.rpc('delete_pricing_data_import', {
    p_import_id: importId,
  })

  if (error) return { ok: false, error: error.message }
  const result = data as {
    import_id: string
    draft_reviews_deleted?: number
  }
  return {
    ok: true,
    data: {
      importId: result.import_id,
      draftReviewsDeleted: Number(result.draft_reviews_deleted ?? 0),
    },
  }
}
