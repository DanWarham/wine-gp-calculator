import { NextResponse } from 'next/server'
import { buildLimeWoodPricingImport } from '@/lib/pricingImport/limeWoodImport'
import { readPricingImportFormData } from '@/lib/pricingImport/uploadFiles'
import { requireAuthenticatedUser } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

/**
 * Parse Lime Wood pricing source files and atomically commit a completed import.
 * Raw uploads are discarded after processing (canonical rows + metadata only).
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart upload.' }, { status: 400 })
  }

  const files = await readPricingImportFormData(form)
  if (!files.ok) {
    return NextResponse.json({ error: files.error, blocked: true }, { status: 400 })
  }

  const built = await buildLimeWoodPricingImport(files.data)
  if (!built.validation.ok || !built.commitPayload) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        message: built.validation.ok ? 'Import could not be prepared.' : built.validation.message,
        issues: built.validation.ok ? [] : built.validation.issues,
      },
      { status: 422 }
    )
  }

  const { data, error } = await auth.supabase.rpc('commit_pricing_data_import', {
    p_payload: built.commitPayload,
  })

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        message: `Import persistence failed: ${error.message}`,
        issues: [],
      },
      { status: 500 }
    )
  }

  const payload = data as {
    import_id: string
    imported_at: string
    status: string
    summary: Record<string, number>
  }

  return NextResponse.json({
    ok: true,
    importId: payload.import_id,
    importedAt: payload.imported_at,
    status: payload.status,
    sourceFilenames: built.validation.sourceFilenames,
    summary: built.validation.summary,
    issues: built.validation.issues,
  })
}
