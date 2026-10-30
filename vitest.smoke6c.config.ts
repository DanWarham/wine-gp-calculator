import path from 'node:path'
import { defineConfig } from 'vitest/config'

/** Isolated runner for authenticated Stage 6C smoke. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/pricingReview/fullPricingReview.smoke.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
