import { defineConfig, mergeConfig } from 'vite'
import { createBrowserViteConfig } from '../../packages/browser/vite.config.ts'

// Same as apps/web: every `zod` import goes through src/zodJitless.ts.
const zodJitless = {
  resolve: {
    alias: [
      {
        find: /^zod$/u,
        replacement: `${import.meta.dirname}/src/zodJitless.ts`
      }
    ]
  }
}

const browserViteConfig = createBrowserViteConfig(import.meta.dirname, true)
export default defineConfig((environment) =>
  mergeConfig(browserViteConfig(environment), zodJitless)
)
