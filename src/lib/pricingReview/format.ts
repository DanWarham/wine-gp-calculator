/** Display helpers for Pricing Review cells. Calculation values stay full precision. */

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

/** Cost increase adverse (red), decrease favourable (green). */
export function costDeltaClass(delta: number): string {
  if (delta > 0) return 'text-red-700'
  if (delta < 0) return 'text-emerald-700'
  return 'text-muted-foreground'
}

/** GP decrease / below target → red; increase / above target → green. */
export function gpDeltaClass(delta: number): string {
  if (delta < 0) return 'text-red-700'
  if (delta > 0) return 'text-emerald-700'
  return 'text-muted-foreground'
}

/** Recommended price movement stays neutral/blue — not adverse red. */
export function priceDeltaClass(delta: number): string {
  if (delta === 0) return 'text-muted-foreground'
  return 'text-sky-700'
}
