import { describe, expect, it } from 'vitest'
import { mapLoginError } from './authErrors'

describe('mapLoginError', () => {
  it('returns the same generic message for unknown email and wrong password style errors', () => {
    expect(mapLoginError({ message: 'Invalid login credentials' })).toBe(
      'Invalid email or password.'
    )
    expect(mapLoginError({ message: 'Invalid credentials' })).toBe(
      'Invalid email or password.'
    )
    expect(mapLoginError({ message: 'User not found' })).toBe(
      'Invalid email or password.'
    )
  })

  it('distinguishes network failures without revealing account existence', () => {
    expect(mapLoginError({ message: 'Failed to fetch', name: 'TypeError' })).toBe(
      'Network error. Check your connection and try again.'
    )
    expect(
      mapLoginError({ message: 'Network request failed', name: 'AuthRetryableFetchError' })
    ).toBe('Network error. Check your connection and try again.')
  })

  it('uses a generic fallback for unexpected errors', () => {
    expect(mapLoginError({ message: 'Unexpected upstream failure' })).toBe(
      'Unable to sign in. Please try again.'
    )
    expect(mapLoginError(null)).toBe('Unable to sign in. Please try again.')
  })
})
