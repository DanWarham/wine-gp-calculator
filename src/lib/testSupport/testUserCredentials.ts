/**
 * Local authenticated test-account credentials.
 *
 * Loaded from process env (typically `.env.test.local` via Vitest / Node --env-file).
 * Never use NEXT_PUBLIC_* for these values. Never require this file for unit tests.
 */

export type TestUserCredentials = {
  email: string
  password: string
}

export function readTestUserCredentials(): TestUserCredentials | null {
  const email = process.env.TEST_USER_EMAIL?.trim() ?? ''
  const password = process.env.TEST_USER_PASSWORD ?? ''
  if (!email || !password) return null
  return { email, password }
}

export function requireTestUserCredentials(): TestUserCredentials {
  const credentials = readTestUserCredentials()
  if (!credentials) {
    throw new Error(
      'Missing TEST_USER_EMAIL / TEST_USER_PASSWORD. Add them to git-ignored .env.test.local.'
    )
  }
  return credentials
}

export function hasTestUserCredentials(): boolean {
  return readTestUserCredentials() !== null
}
