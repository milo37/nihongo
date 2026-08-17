import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import { sharedViteConfig } from './vite.config.ts'

export default mergeConfig(
  sharedViteConfig,
  defineConfig({
    define: {
      __NIHONGO_API_MODE__: JSON.stringify('mock'),
      __NIHONGO_PRODUCTION_BUILD__: JSON.stringify(false)
    },
    test: {
      environment: 'jsdom',
      globals: true,
      maxWorkers: 4,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      restoreMocks: true
    }
  })
)
