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

// #1346: five first-screen modules of a few hundred bytes each were their own
// files (each shared by a different set of screens). They all load on the
// first screen anyway, so one file holds them: same code, fewer requests.
const smallFirstScreenModules = [
  '/packages/browser/src/common/components/FieldError.tsx',
  '/packages/contracts/dist/common/pagination.js',
  '/apps/web/src/app/operations/operationsContent.ts',
  '/packages/browser/src/app/login/authFlowErrors.ts',
  '/packages/browser/src/libs/socialAuthNavigation.ts',
  '/apps/web/src/app/practice/draft/studyDraftPrincipalScope.ts'
]
const firstScreenSmallChunk = {
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'first-screen-small',
              test: (id: string) =>
                smallFirstScreenModules.some((module) => id.endsWith(module)),
              includeDependenciesRecursively: false
            }
          ]
        }
      }
    }
  }
}

export const sharedViteConfig = mergeConfig(
  createSharedViteConfig(import.meta.dirname),
  zodJitless
)
const browserViteConfig = createBrowserViteConfig(import.meta.dirname)
export default defineConfig((environment) =>
  mergeConfig(
    mergeConfig(browserViteConfig(environment), zodJitless),
    firstScreenSmallChunk
  )
)
