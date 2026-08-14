import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: { alias: aliases },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false
      }
    }
  },
  preview: { port: 4173 }
})
