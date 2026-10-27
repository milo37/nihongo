import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProxyOptions } from 'vite'
import {
  createBrowserViteConfig,
  createSharedViteConfig
} from '../../packages/browser/vite.config.ts'

const webRoot = path.resolve(import.meta.dirname, '../web')
const adminRoot = import.meta.dirname

afterEach(() => vi.unstubAllEnvs())

it('routes only the exact admin subtree on the public dev and preview origin', () => {
  const web = createSharedViteConfig(webRoot)
  const context = Object.keys(web.server.proxy).find((key) =>
    key.startsWith('^')
  )
  expect(context).toBeDefined()
  const matcher = new RegExp(context ?? '')
  for (const request of [
    '/admin',
    '/admin?redirect=%2Fdashboard',
    '/admin/questions',
    '/admin/assets/index.js',
    '/admin/@vite/client'
  ])
    expect(matcher.test(request), request).toBe(true)
  for (const request of [
    '/administrator',
    '/admin-api',
    '/admin%2Fquestions',
    '/api/v1/me',
    '/health',
    '/login?redirect=%2Fadmin%2Fquestions'
  ])
    expect(matcher.test(request), request).toBe(false)
  const dev = web.server.proxy[context ?? ''] as ProxyOptions
  const preview = web.preview.proxy[context ?? ''] as ProxyOptions
  expect(dev).toMatchObject({
    target: 'http://localhost:5175',
    changeOrigin: false,
    ws: true
  })
  expect(preview).toMatchObject({
    target: 'http://localhost:4175',
    changeOrigin: false
  })
  expect(dev.rewrite?.('/admin')).toBe('/admin/')
  expect(dev.rewrite?.('/admin?redirect=%2Fdashboard')).toBe(
    '/admin/?redirect=%2Fdashboard'
  )
  expect(dev.rewrite?.('/admin/questions?cursor=a%2Fb')).toBe(
    '/admin/questions?cursor=a%2Fb'
  )
})

it('keeps upstream API settings, fixed admin ports and no admin self-proxy', () => {
  const web = createSharedViteConfig(webRoot)
  const admin = createSharedViteConfig(adminRoot, true)
  expect(web.server.port).toBe(5173)
  expect(web.preview.port).toBe(4173)
  expect(admin.server).toMatchObject({ port: 5175, strictPort: true })
  expect(admin.preview).toMatchObject({ port: 4175, strictPort: true })
  expect(admin.base).toBe('/admin/')
  expect(
    Object.keys(admin.server.proxy).some((key) => key.startsWith('^'))
  ).toBe(false)
  expect(
    Object.keys(admin.preview.proxy).some((key) => key.startsWith('^'))
  ).toBe(false)
  expect(web.server.proxy['/api']).toEqual(admin.server.proxy['/api'])
  expect(web.server.proxy['/health']).toEqual(admin.server.proxy['/health'])
  expect(web.server.proxy['/api'].changeOrigin).toBe(false)
})

it('retains default web mock and real-only admin configuration', async () => {
  vi.stubEnv('VITE_API_MODE', undefined)
  const webFactory = createBrowserViteConfig(webRoot)
  const adminFactory = createBrowserViteConfig(adminRoot, true)
  if (typeof webFactory !== 'function' || typeof adminFactory !== 'function')
    throw new Error('Expected the existing Vite config factories.')
  const web = await webFactory({ command: 'serve', mode: 'development' })
  const admin = await adminFactory({ command: 'serve', mode: 'development' })
  expect(web.define?.__NIHONGO_API_MODE__).toBe('"mock"')
  expect(admin.define?.__NIHONGO_API_MODE__).toBe('"real"')
  vi.stubEnv('VITE_API_MODE', 'mock')
  expect(() => adminFactory({ command: 'serve', mode: 'development' })).toThrow(
    'Admin builds and development require real API mode.'
  )
})
