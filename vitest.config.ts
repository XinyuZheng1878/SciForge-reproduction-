import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('frontend'),
      '@shared': resolve('backend/shared')
    }
  },
  test: {
    environment: 'node',
    include: [
      'frontend/**/*.test.ts',
      'backend/main/**/*.test.ts',
      'backend/preload/**/*.test.ts',
      'backend/shared/**/*.test.ts',
      'workers/evidence-dag/desktop/**/*.test.ts'
    ]
  }
})
