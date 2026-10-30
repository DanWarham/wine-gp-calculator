import {
  currentDataMonthIso,
  dataMonthFromMonthInput,
} from '@/lib/pricingImport/dataMonth'

/** Read required data month from multipart form (`dataMonth` as YYYY-MM or YYYY-MM-01). */
export function parseDataMonthFromForm(
  form: FormData
): { ok: true; dataMonth: string } | { ok: false; error: string } {
  const raw = String(form.get('dataMonth') ?? '').trim()
  if (!raw) {
    return { ok: true, dataMonth: currentDataMonthIso() }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const monthStart = `${raw.slice(0, 7)}-01`
    if (raw.slice(8) !== '01' && raw !== monthStart) {
      // Accept any day but normalise to month start.
    }
    return { ok: true, dataMonth: monthStart }
  }
  const fromInput = dataMonthFromMonthInput(raw)
  if (!fromInput) {
    return { ok: false, error: 'dataMonth must be YYYY-MM or YYYY-MM-01.' }
  }
  return { ok: true, dataMonth: fromInput }
}
