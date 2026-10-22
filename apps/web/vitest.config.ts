import { mergeConfig } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { sharedViteConfig } from './vite.config.ts'

export default mergeConfig(
  sharedViteConfig,
  defineConfig({
    define: {
      __NIHONGO_API_MODE__: JSON.stringify('mock'),
      __NIHONGO_PRODUCTION_BUILD__: JSON.stringify(false),
      __NIHONGO_RELEASE_ID__: JSON.stringify(
        '0000000000000000000000000000000000000000'
      )
    },
    test: {
      environment: 'jsdom',
      exclude: [
        ...configDefaults.exclude,
        'scripts/phase10-production-bundle-*.test.mjs'
      ],
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      restoreMocks: true
    }
  })
)
