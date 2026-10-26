/**
 * Map Auth/client failures to non-enumerating user-facing login messages.
 * Do not distinguish unknown email vs wrong password.
 */
export function mapLoginError(error: {
  message?: string
  status?: number
  name?: string
} | null): string {
  if (!error) {
    return 'Unable to sign in. Please try again.'
  }

  const message = (error.message || '').toLowerCase()

  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    error.name === 'AuthRetryableFetchError'
  ) {
    return 'Network error. Check your connection and try again.'
  }

  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid credentials') ||
    message.includes('email not confirmed') ||
    message.includes('user not found')
  ) {
    return 'Invalid email or password.'
  }

  // Unexpected Auth/server errors — keep generic; never dump raw objects.
  return 'Unable to sign in. Please try again.'
}
