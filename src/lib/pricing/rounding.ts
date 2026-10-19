/**
 * Round a monetary amount to the nearest commercial increment.
 *
 * Examples (increment 1): 82.40 → 82, 82.50 → 83
 * Examples (increment 0.5): 12.24 → 12, 12.25 → 12.5, 12.75 → 13
 */
export function roundToIncrement(value: number, increment: number): number {
  if (!(increment > 0) || !Number.isFinite(increment)) {
    throw new Error('Rounding increment must be a positive finite number')
  }
  if (!Number.isFinite(value)) {
    throw new Error('Value to round must be finite')
  }

  return Math.round(value / increment) * increment
}
