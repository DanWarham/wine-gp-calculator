/** Data-month helpers. Stored as first-of-month ISO date (YYYY-MM-DD). */

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Current calendar month as first-of-month UTC ISO date. */
export function currentDataMonthIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = now.getMonth() // 0-based local calendar month for UX default
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Convert `<input type="month">` value `YYYY-MM` → first-of-month ISO date. */
export function dataMonthFromMonthInput(yyyyMm: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yyyyMm.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || month < 1 || month > 12) return null
  return `${match[1]}-${match[2]}-01`
}

/** First-of-month ISO → `YYYY-MM` for month inputs. */
export function monthInputFromDataMonth(dataMonthIso: string): string {
  return dataMonthIso.slice(0, 7)
}

/** Display e.g. `October 2026`. */
export function formatDataMonth(dataMonthIso: string): string {
  const d = new Date(`${dataMonthIso.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return dataMonthIso
  return MONTH_FORMATTER.format(d)
}

/**
 * Select Cost Change pair:
 * - latest = newest completed import overall (by data month, then imported_at)
 * - previous = latest completed import from the previous available data month
 */
export function selectLatestAndPreviousByDataMonth<
  T extends { id: string; dataMonth: string; importedAt: string },
>(completedImports: T[]): { latest: T; previous: T } | null {
  if (completedImports.length === 0) return null

  const sorted = [...completedImports].sort((a, b) => {
    const monthCmp = b.dataMonth.localeCompare(a.dataMonth)
    if (monthCmp !== 0) return monthCmp
    return b.importedAt.localeCompare(a.importedAt)
  })

  const latest = sorted[0]
  const previous = sorted.find((row) => row.dataMonth < latest.dataMonth)
  if (!previous) return null
  return { latest, previous }
}

/** Latest completed import within a data month (by imported_at). */
export function selectLatestImportForDataMonth<
  T extends { id: string; dataMonth: string; importedAt: string },
>(completedImports: T[], dataMonth: string): T | null {
  const inMonth = completedImports
    .filter((row) => row.dataMonth === dataMonth)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  return inMonth[0] ?? null
}

export function countImportsForDataMonth<T extends { dataMonth: string }>(
  completedImports: T[],
  dataMonth: string
): number {
  return completedImports.filter((row) => row.dataMonth === dataMonth).length
}
