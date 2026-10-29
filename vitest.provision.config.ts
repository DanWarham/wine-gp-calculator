import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Isolated runner for one-shot test-account provisioning.
 * Default `npm test` does not include this file.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/testSupport/provisionTestUser.provision.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
