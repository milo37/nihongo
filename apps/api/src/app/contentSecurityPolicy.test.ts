import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import {
  resolveContentSecurityPolicyMode,
  type ContentSecurityPolicyMode
} from './contentSecurityPolicy.js'
import { createApiApp } from './createApp.js'

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
  "frame-ancestors 'none'; form-action 'self'"
const releaseId = '1'.repeat(40)
let web: string

beforeEach(() => {
  web = mkdtempSync(join(tmpdir(), 'nihongo-csp-web-'))
  mkdirSync(join(web, 'assets'))
  writeFileSync(
    join(web, 'index.html'),
    `<html><head><meta name="nihongo-release-id" content="${releaseId}"></head><body>LEARNER</body></html>`
  )
})
afterEach(() => rmSync(web, { recursive: true, force: true }))

const app = (contentSecurityPolicyMode?: ContentSecurityPolicyMode) =>
  createApiApp({
    checkReadiness: async () => undefined,
    ...(contentSecurityPolicyMode ? { contentSecurityPolicyMode } : {}),
    logger: createJsonLogger('error', () => undefined),
    questionReader: {} as QuestionReader,
    releaseId,
    webAssetsDirectory: web
  })

const otherHeaders = (headers: Headers) =>
  Object.fromEntries(
    [...headers].filter(
      ([name]) =>
        name !== 'content-security-policy' &&
        name !== 'content-security-policy-report-only'
    )
  )

describe('Content-Security-Policy (JLP-788)', () => {
  it.each(['/', '/practice', '/api/v1/health/live'])(
    'enforces the policy on %s by default',
    async (path) => {
      const response = await app().request(path)
      expect(response.headers.get('Content-Security-Policy')).toBe(policy)
      expect(
        response.headers.get('Content-Security-Policy-Report-Only')
      ).toBeNull()
    }
  )

  it('only reports in report-only mode', async () => {
    const response = await app('report-only').request('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toBe(
      policy
    )
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
  })

  it('keeps every other security header at the Hono default', async () => {
    const defaults = new Hono()
    defaults.use('*', secureHeaders())
    defaults.get('/', (context) => context.text('ok'))
    const expected = (await defaults.request('/')).headers
    for (const mode of ['enforce', 'report-only'] as const) {
      const actual = (await app(mode).request('/')).headers
      for (const [name, value] of Object.entries(otherHeaders(expected)))
        if (name !== 'content-type' && name !== 'content-length')
          expect([name, actual.get(name)]).toEqual([name, value])
    }
  })

  it('reports only on STAGING unless CSP_MODE says otherwise', () => {
    expect(
      resolveContentSecurityPolicyMode({ DEPLOYMENT_ENVIRONMENT: 'STAGING' })
    ).toBe('report-only')
    expect(resolveContentSecurityPolicyMode({})).toBe('enforce')
    for (const deployment of [
      'PRODUCTION',
      'DEVELOPMENT',
      'LOCAL',
      'TEST'
    ] as const)
      expect(
        resolveContentSecurityPolicyMode({
          DEPLOYMENT_ENVIRONMENT: deployment
        })
      ).toBe('enforce')
    expect(
      resolveContentSecurityPolicyMode({
        CSP_MODE: 'enforce',
        DEPLOYMENT_ENVIRONMENT: 'STAGING'
      })
    ).toBe('enforce')
    expect(
      resolveContentSecurityPolicyMode({
        CSP_MODE: 'report-only',
        DEPLOYMENT_ENVIRONMENT: 'PRODUCTION'
      })
    ).toBe('report-only')
  })
})
