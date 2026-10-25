import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono, type MiddlewareHandler } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiVariables } from '../middleware/requestContext.js'
import { installStaticWeb } from './staticWeb.js'

type StaticEnvironment = { Variables: ApiVariables }
const releaseId = '1'.repeat(40)
const html = (label: string, release = releaseId) =>
  `<html><head><meta name="nihongo-release-id" content="${release}"></head><body>${label}</body></html>`
let directory: string
let web: string
let admin: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nihongo-admin-static-'))
  web = join(directory, 'web')
  admin = join(directory, 'admin')
  for (const root of [web, admin])
    mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(web, 'index.html'), html('LEARNER_ONLY'))
  writeFileSync(join(admin, 'index.html'), html('ADMIN_HTML_ONLY'))
  writeFileSync(join(web, 'assets/app.js'), 'LEARNER_ASSET_ONLY')
  writeFileSync(join(admin, 'assets/app.js'), 'ADMIN_ASSET_ONLY')
  mkdirSync(join(admin, 'nested'))
  writeFileSync(join(admin, '.env'), 'ADMIN_SECRET_ONLY')
  writeFileSync(join(admin, 'nested/.secret'), 'ADMIN_SECRET_ONLY')
  writeFileSync(join(admin, 'mockServiceWorker.js'), 'ADMIN_WORKER_ONLY')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const server = ({
  protectedAssets = true,
  rawTarget,
  guard = vi.fn<MiddlewareHandler<StaticEnvironment>>(
    async (_context, next) => {
      await next()
    }
  )
}: {
  protectedAssets?: boolean
  rawTarget?: string
  guard?: MiddlewareHandler<StaticEnvironment>
} = {}) => {
  const app = new Hono<StaticEnvironment>()
  app.use('*', async (context, next) => {
    context.set('rawRequestTarget', rawTarget ?? context.req.raw.url)
    await next()
  })
  app.notFound((context) => context.text('NOT_FOUND', 404))
  installStaticWeb({
    app,
    releaseId,
    webAssetsDirectory: web,
    ...(protectedAssets
      ? { adminAssetsDirectory: admin, adminGuard: guard }
      : {})
  })
  return { app, guard }
}

describe('separate protected admin static assets', () => {
  it.each([
    '/admin',
    '/admin/',
    '/admin/questions/123/edit',
    '/admin/assets/app.js'
  ])('serves only the protected build at %s after its guard', async (path) => {
    const { app, guard } = server()
    const response = await app.request(path)
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain(
      path.includes('/assets/') ? 'ADMIN_ASSET_ONLY' : 'ADMIN_HTML_ONLY'
    )
    expect(body).not.toContain('LEARNER_ONLY')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Vary')).toBe('Cookie, Authorization')
    expect(response.headers.get('Last-Modified')).toBeNull()
    expect(guard).toHaveBeenCalledOnce()
  })

  it('keeps learner HTML and public assets on their own root', async () => {
    const { app, guard } = server()
    for (const path of ['/login', '/practice/session/123', '/administrator']) {
      const response = await app.request(path)
      expect(await response.text()).toContain('LEARNER_ONLY')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    const asset = await app.request('/assets/app.js')
    expect(await asset.text()).toBe('LEARNER_ASSET_ONLY')
    expect(asset.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(guard).not.toHaveBeenCalled()
  })

  it.each(['/admin', '/admin/questions', '/admin/assets/app.js'])(
    'never falls back to the learner build without a configured admin root at %s',
    async (path) => {
      const { app } = server({ protectedAssets: false })
      const response = await app.request(path)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('NOT_FOUND')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  )

  it.each([
    '/ADMIN/questions',
    '/%61dmin/questions',
    '/admin%2Fassets/app.js',
    '/admin/../assets/app.js',
    '/admin/%2e%2e/assets/app.js',
    '/admin/%252e%252e/assets/app.js',
    '//admin/questions',
    '/admin\\assets/app.js',
    '/%61dmin/%FF',
    '/admin/.env',
    '/admin/nested/.secret',
    '/admin/mockServiceWorker.js'
  ])(
    'rejects aliases or hidden content without either SPA fallback: %s',
    async (rawTarget) => {
      const canonicalUrl = new URL(
        rawTarget.replaceAll('\\', '/'),
        'http://localhost'
      )
      const { app } = server({ rawTarget })
      const response = await app.request(canonicalUrl.toString())
      expect(response.status).toBe(404)
      const body = await response.text()
      expect(body).not.toContain('ADMIN_')
      expect(body).not.toContain('LEARNER_')
    }
  )

  it.each([
    '/api/v1/admin/questions',
    '/health/ready',
    '/__test/error',
    '/assets/missing.js',
    '/admin/assets/missing.js'
  ])(
    'does not turn API or missing asset requests into HTML: %s',
    async (path) => {
      const response = await server().app.request(path)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('NOT_FOUND')
    }
  )

  it('checks current authorization again for HEAD, range and conditional asset requests', async () => {
    let permitted = true
    const guard: MiddlewareHandler<StaticEnvironment> = async (
      context,
      next
    ) => {
      if (!permitted) return context.text('DENIED', 401)
      await next()
    }
    const { app } = server({ guard })
    const head = await app.request('/admin/assets/app.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(head.headers.get('Cache-Control')).toBe('private, no-store')
    const range = await app.request('/admin/assets/app.js', {
      headers: { Range: 'bytes=0-4' }
    })
    expect(range.status).toBe(206)
    expect(await range.text()).toBe('ADMIN')
    permitted = false
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request('/admin/assets/app.js', {
        method,
        headers: {
          Range: 'bytes=0-4',
          'If-Modified-Since': new Date().toUTCString(),
          'If-None-Match': 'old-admin'
        }
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await response.text()).not.toContain('ADMIN_ASSET_ONLY')
    }
  })

  it('rejects symlink escapes through public and protected asset paths', async () => {
    symlinkSync(join(admin, 'assets/app.js'), join(web, 'leak.js'))
    symlinkSync(admin, join(web, 'leaked-directory'), 'dir')
    symlinkSync(join(web, 'assets/app.js'), join(admin, 'assets/outside.js'))
    const { app } = server()
    for (const path of [
      '/leak.js',
      '/leaked-directory/assets/app.js',
      '/admin/assets/outside.js'
    ]) {
      const response = await app.request(path)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('NOT_FOUND')
    }
  })

  it('rejects overlapping roots and mismatched release markers at startup', () => {
    const app = new Hono<StaticEnvironment>()
    expect(() =>
      installStaticWeb({
        app,
        releaseId,
        webAssetsDirectory: web,
        adminAssetsDirectory: web
      })
    ).toThrow('separate')
    const nested = join(web, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'index.html'), html('ADMIN'))
    expect(() =>
      installStaticWeb({
        app,
        releaseId,
        webAssetsDirectory: web,
        adminAssetsDirectory: nested
      })
    ).toThrow('separate')
    writeFileSync(join(admin, 'index.html'), html('ADMIN', '2'.repeat(40)))
    expect(() =>
      installStaticWeb({
        app,
        releaseId,
        webAssetsDirectory: web,
        adminAssetsDirectory: admin
      })
    ).toThrow('release ID')
    expect(() =>
      installStaticWeb({ app, releaseId, webAssetsDirectory: 'relative' })
    ).toThrow('absolute')
  })

  it('rejects an index symlink outside its own artifact root', () => {
    rmSync(join(admin, 'index.html'))
    symlinkSync(join(web, 'index.html'), join(admin, 'index.html'))
    expect(() => server()).toThrow('release ID')
  })
})
