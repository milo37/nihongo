import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveApiMode } from './src/libs/resolveApiMode.ts'

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
    target: 'http://127.0.0.1:3001',
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
  const apiMode = resolveApiMode({
    configuredMode: environment.VITE_API_MODE,
    isProduction: isProductionBuild
  })

  const resolvedConfig = {
    ...sharedViteConfig,
    define: {
      __NIHONGO_API_MODE__: JSON.stringify(apiMode),
      __NIHONGO_PRODUCTION_BUILD__: JSON.stringify(isProductionBuild)
    }
  }

  return isProductionBuild
    ? { ...resolvedConfig, publicDir: false }
    : resolvedConfig
})
