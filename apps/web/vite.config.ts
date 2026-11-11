import { defineConfig, mergeConfig } from 'vite'
import {
  createBrowserViteConfig,
  createSharedViteConfig
} from '../../packages/browser/vite.config.ts'

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

export const sharedViteConfig = mergeConfig(
  createSharedViteConfig(import.meta.dirname),
  zodJitless
)
const browserViteConfig = createBrowserViteConfig(import.meta.dirname)
export default defineConfig((environment) =>
  mergeConfig(browserViteConfig(environment), zodJitless)
)
