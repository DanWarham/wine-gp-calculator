import { NextResponse } from 'next/server'
import { buildLimeWoodPricingImport } from '@/lib/pricingImport/limeWoodImport'
import { readPricingImportFormData } from '@/lib/pricingImport/uploadFiles'
import { requireAuthenticatedUser } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

/**
 * Validate Lime Wood pricing source files without persisting.
 * Authoritative parse runs only on the trusted server boundary.
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
  if (!built.validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        message: built.validation.message,
        issues: built.validation.issues,
      },
      { status: 422 }
    )
  }

  return NextResponse.json({
    ok: true,
    sourceFilenames: built.validation.sourceFilenames,
    summary: built.validation.summary,
    issues: built.validation.issues,
    observationCount: built.validation.observationCount,
  })
}
