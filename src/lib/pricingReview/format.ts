/** Display helpers for Cost Change Review cells. Calculation values stay full precision. */

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const body = abs.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `£${body}`
}

export function formatGp(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const display = Math.round(value * 10) / 10
  return Number.isInteger(display) ? `${display}%` : `${display.toFixed(1)}%`
}

export function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatMoney(Math.abs(value))}`
}

export function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const display = Math.round(Math.abs(value) * 10) / 10
  const body = Number.isInteger(display) ? String(display) : display.toFixed(1)
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${body}%`
}

export function formatSignedPoints(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const display = Math.round(Math.abs(value) * 10) / 10
  const body = Number.isInteger(display) ? String(display) : display.toFixed(1)
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${body} pts`
}

export function arrowForDelta(value: number): '↑' | '↓' | '→' {
  if (value > 0) return '↑'
  if (value < 0) return '↓'
  return '→'
}
