import path from 'node:path'
import { readFile } from 'node:fs/promises'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { resolveApiMode } from './src/libs/resolveApiMode.ts'
import { resolveReleaseId } from './src/libs/resolveReleaseId.ts'
import { assertBrowserBuildGraph } from '../../scripts/operations/browser-artifact-check.mjs'

const approvedBrandAssetPaths = [
  'auth/apple-mark.svg',
  'auth/google-mark.svg',
  'brand/harumaru-lockup-160.png',
  'brand/harumaru-lockup-320.png',
  'brand/harumaru-lockup.svg',
  'brand/harumaru-symbol-16.png',
  'brand/harumaru-symbol-32.png',
  'brand/harumaru-symbol.svg',
  'favicon.ico',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
] as const

const workspaceRoot = path.resolve(import.meta.dirname, '../..')

export const createSharedViteConfig = (root: string, admin = false) => {
  const aliases = Object.fromEntries(
    Object.entries({
      '@': '',
      '@api': 'api',
      '@app': 'app',
      '@common': 'common',
      '@provider': 'provider',
      '@store': 'store',
      '@libs': 'libs',
      '@mocks': 'mocks',
      '@util': 'util',
      '@assets': 'assets'
    }).map(([key, value]) => [key, path.resolve(root, 'src', value)])
  )
  const proxy = {
    '/api': {
      target: process.env.NIHONGO_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
      changeOrigin: false
    }
  }
  const adminProxyContext = '^/admin(?:/|\\?|$)'
  const adminProxy = {
    target: 'http://localhost:5175',
    changeOrigin: false,
    ws: true,
    rewrite: (requestPath: string) =>
      requestPath.replace(/^\/admin(?=\?|$)/u, '/admin/')
  }
  return {
    root,
    base: admin ? '/admin/' : '/',
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    resolve: { alias: aliases },
    server: {
      port: admin ? 5175 : 5173,
      strictPort: admin,
      proxy: {
        ...proxy,
        ...(admin ? {} : { [adminProxyContext]: adminProxy }),
        '/health': {
          target:
            process.env.NIHONGO_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
          changeOrigin: false
        }
      }
    },
    preview: {
      port: admin ? 4175 : 4173,
      strictPort: admin,
      proxy: {
        ...proxy,
        ...(admin
          ? {}
          : {
              [adminProxyContext]: {
                ...adminProxy,
                target: 'http://localhost:4175'
              }
            })
      }
    }
  }
}

export const createBrowserViteConfig = (root: string, admin = false) =>
  defineConfig(({ command, mode }) => {
    const environment = loadEnv(mode, root, 'VITE_')
    const isProductionBuild = command === 'build'
    const isReleaseBuild = process.env.NIHONGO_RELEASE_BUILD === '1'
    const apiMode = resolveApiMode({
      configuredMode: environment.VITE_API_MODE ?? (admin ? 'real' : undefined),
      isProduction: isProductionBuild
    })
    if (admin && apiMode !== 'real') {
      throw new Error('Admin builds and development require real API mode.')
    }
    if (
      admin &&
      environment.VITE_API_BASE_URL &&
      environment.VITE_API_BASE_URL !== '/api'
    ) {
      throw new Error('Admin requires VITE_API_BASE_URL=/api.')
    }
    const releaseId = resolveReleaseId(environment.VITE_RELEASE_ID, {
      requireDeployable: isReleaseBuild
    })
    if (isReleaseBuild && environment.VITE_API_BASE_URL !== '/api') {
      throw new Error('Release builds require VITE_API_BASE_URL=/api.')
    }
    const artifact = admin ? 'admin' : 'web'
    const buildBoundary: Plugin = {
      name: 'nihongo-browser-boundary',
      apply: 'build',
      generateBundle(_options, bundle) {
        const modules = Object.values(bundle)
          .flatMap((entry) =>
            entry.type === 'chunk' ? Object.keys(entry.modules) : []
          )
          .map((id) =>
            path
              .relative(workspaceRoot, id.split('?')[0])
              .split(path.sep)
              .join('/')
          )
        assertBrowserBuildGraph(artifact, modules)
        this.emitFile({
          type: 'asset',
          fileName: 'browser-build-manifest.json',
          source: JSON.stringify({
            artifact,
            releaseId,
            modules: [...new Set(modules)].sort()
          })
        })
      }
    }
    const brandAssets: Plugin = {
      name: 'nihongo-approved-brand-assets',
      apply: 'build',
      async generateBundle() {
        for (const fileName of approvedBrandAssetPaths) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: await readFile(
              path.join(workspaceRoot, 'apps/web/public', fileName)
            )
          })
        }
      }
    }
    const sharedConfig = createSharedViteConfig(root, admin)
    return {
      ...sharedConfig,
      publicDir: isProductionBuild || admin ? false : undefined,
      plugins: [
        ...sharedConfig.plugins,
        brandAssets,
        buildBoundary,
        {
          name: 'nihongo-release-metadata',
          transformIndexHtml: {
            order: 'pre' as const,
            handler: () => [
              {
                tag: 'meta',
                attrs: { name: 'nihongo-release-id', content: releaseId },
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
  })
