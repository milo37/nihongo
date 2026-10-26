import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import { createSharedViteConfig } from '../../packages/browser/vite.config.ts'

export default mergeConfig(
  createSharedViteConfig(import.meta.dirname, true),
  defineConfig({
    define: {
      __NIHONGO_API_MODE__: JSON.stringify('real'),
      __NIHONGO_PRODUCTION_BUILD__: JSON.stringify(false),
      __NIHONGO_RELEASE_ID__: JSON.stringify(
        '0000000000000000000000000000000000000000'
      )
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      restoreMocks: true
    }
  })
)
