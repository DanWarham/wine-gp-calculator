import { describe, expect, it } from 'vitest'
import {
  countImportsForDataMonth,
  currentDataMonthIso,
  dataMonthFromMonthInput,
  formatDataMonth,
  monthInputFromDataMonth,
  selectLatestAndPreviousByDataMonth,
  selectLatestImportForDataMonth,
} from './dataMonth'

describe('data month helpers', () => {
  it('formats display names', () => {
    expect(formatDataMonth('2026-10-01')).toBe('October 2026')
    expect(formatDataMonth('2026-01-01')).toBe('January 2026')
  })

  it('round-trips month inputs', () => {
    expect(dataMonthFromMonthInput('2026-10')).toBe('2026-10-01')
    expect(monthInputFromDataMonth('2026-10-01')).toBe('2026-10')
    expect(dataMonthFromMonthInput('bad')).toBeNull()
  })

  it('defaults current month to first-of-month', () => {
    expect(currentDataMonthIso(new Date('2026-10-29T12:00:00'))).toBe('2026-10-01')
  })

  it('selects previous available data month, not previous upload timestamp', () => {
    const pair = selectLatestAndPreviousByDataMonth([
      { id: 'oct-2', dataMonth: '2026-10-01', importedAt: '2026-10-20T00:00:00Z' },
      { id: 'oct-1', dataMonth: '2026-10-01', importedAt: '2026-10-05T00:00:00Z' },
      { id: 'aug', dataMonth: '2026-08-01', importedAt: '2026-08-01T00:00:00Z' },
      { id: 'sep', dataMonth: '2026-09-01', importedAt: '2026-09-15T00:00:00Z' },
    ])
    expect(pair?.latest.id).toBe('oct-2')
    expect(pair?.previous.id).toBe('sep')
  })

  it('counts duplicate-month imports for warnings', () => {
    const rows = [
      { dataMonth: '2026-10-01' },
      { dataMonth: '2026-10-01' },
      { dataMonth: '2026-09-01' },
    ]
    expect(countImportsForDataMonth(rows, '2026-10-01')).toBe(2)
    expect(selectLatestImportForDataMonth(
      [
        { id: 'a', dataMonth: '2026-10-01', importedAt: '2026-10-01T00:00:00Z' },
        { id: 'b', dataMonth: '2026-10-01', importedAt: '2026-10-10T00:00:00Z' },
      ],
      '2026-10-01'
    )?.id).toBe('b')
  })
})
