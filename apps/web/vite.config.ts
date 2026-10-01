import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveApiMode } from './src/libs/resolveApiMode.ts'
import { resolveReleaseId } from './src/libs/resolveReleaseId.ts'

const aliases = {
  '@': path.resolve(import.meta.dirname, 'src'),
  '@api': path.resolve(import.meta.dirname, 'src/api'),
  '@app': path.resolve(import.meta.dirname, 'src/app'),
  '@common': path.resolve(import.meta.dirname, 'src/common'),
  '@provider': path.resolve(import.meta.dirname, 'src/provider'),
  '@store': path.resolve(import.meta.dirname, 'src/store'),
  '@libs': path.resolve(import.meta.dirname, 'src/libs'),
  '@mocks': path.resolve(import.meta.dirname, 'src/mocks'),
  '@util': path.resolve(import.meta.dirname, 'src/util'),
  '@assets': path.resolve(import.meta.dirname, 'src/assets')
}

const apiProxy = {
  '/api': {
    target: process.env.NIHONGO_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
    changeOrigin: false
  }
}

export const sharedViteConfig = defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: { alias: aliases },
  server: {
    port: 5173,
    proxy: apiProxy
  },
  preview: {
    port: 4173,
    proxy: apiProxy
  }
})

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, import.meta.dirname, 'VITE_')
  const isProductionBuild = command === 'build'
  const isReleaseBuild = process.env.NIHONGO_RELEASE_BUILD === '1'
  const apiMode = resolveApiMode({
    configuredMode: environment.VITE_API_MODE,
    isProduction: isProductionBuild
  })
  const releaseId = resolveReleaseId(environment.VITE_RELEASE_ID, {
    requireDeployable: isReleaseBuild
  })
  if (isReleaseBuild && environment.VITE_API_BASE_URL !== '/api') {
    throw new Error('Release builds require VITE_API_BASE_URL=/api.')
  }

  const resolvedConfig = {
    ...sharedViteConfig,
    plugins: [
      ...(sharedViteConfig.plugins ?? []),
      {
        name: 'nihongo-release-metadata',
        transformIndexHtml: {
          order: 'pre' as const,
          handler: () => [
            {
              tag: 'meta',
              attrs: {
                name: 'nihongo-release-id',
                content: releaseId
              },
              injectTo: 'head' as const
            }
          ]
        }
      }
    ],
    define: {
      __NIHONGO_API_MODE__: JSON.stringify(apiMode),
      __NIHONGO_PRODUCTION_BUILD__: JSON.stringify(isProductionBuild),
      __NIHONGO_RELEASE_ID__: JSON.stringify(releaseId)
    }
  }

  return isProductionBuild
    ? { ...resolvedConfig, publicDir: false }
    : resolvedConfig
})
