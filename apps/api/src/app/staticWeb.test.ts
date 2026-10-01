import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createApiApp } from './createApp.js'

const releaseId = '1234567890abcdef1234567890abcdef12345678'
const temporaryDirectories: string[] = []

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const createWebFixture = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-static-web-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'assets'))
  writeFileSync(
    join(directory, 'index.html'),
    `<!doctype html><meta name="nihongo-release-id" content="${releaseId}"><script src="/assets/app-ABC.js"></script>`
  )
  writeFileSync(join(directory, 'assets', 'app-ABC.js'), 'export {}\n')
  return directory
}

const createApp = (webAssetsDirectory: string) =>
  createApiApp({
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    logger: createJsonLogger('silent'),
    questionReader,
    releaseId,
    webAssetsDirectory
  })

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('same-origin static Web runtime', () => {
  it('serves the shell, SPA fallback and immutable Vite assets', async () => {
    const app = createApp(createWebFixture())

    const [root, fallback, asset, head] = await Promise.all([
      app.request('/'),
      app.request('/login'),
      app.request('/assets/app-ABC.js'),
      app.request('/login', { method: 'HEAD' })
    ])

    expect(root.status).toBe(200)
    expect(root.headers.get('Cache-Control')).toBe('no-store')
    expect(await root.text()).toContain(releaseId)
    expect(fallback.status).toBe(200)
    expect(fallback.headers.get('Cache-Control')).toBe('no-store')
    expect(await fallback.text()).toContain(releaseId)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('keeps reserved, missing asset and non-GET requests on the JSON 404 boundary', async () => {
    const app = createApp(createWebFixture())
    const responses = await Promise.all([
      app.request('/api/not-real'),
      app.request('/health/not-real'),
      app.request('/mockServiceWorker.js'),
      app.request('/assets/missing.js'),
      app.request('/api%2Fnot-real'),
      app.request('/api%252Fnot-real'),
      app.request('/health%2Fready'),
      app.request('/..%2Fapi/not-real'),
      app.request('/', { method: 'POST' })
    ])

    for (const response of responses) {
      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toContain('application/json')
      expect(await response.json()).toMatchObject({
        code: 'RESOURCE_NOT_FOUND'
      })
    }
  })

  it('requires exactly one real lowercase Web release marker', () => {
    const directory = createWebFixture()
    for (const invalidHtml of [
      `<!-- <meta name="nihongo-release-id" content="${releaseId}"> -->`,
      `<script>const marker = '<meta name="nihongo-release-id" content="${releaseId}">'</script>`,
      `<meta name="nihongo-release-id" content="${releaseId}"><meta name="nihongo-release-id" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">`,
      `<meta name="nihongo-release-id" content="${releaseId.toUpperCase()}">`
    ]) {
      writeFileSync(join(directory, 'index.html'), invalidHtml)
      expect(() => createApp(directory)).toThrow(
        'Web assets do not match the API release ID.'
      )
    }
  })
})
