import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EnvironmentValidationError,
  parseApiEnvironment
} from '../config/env.js'
import { createJsonLogger } from '../observability/logger.js'
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
const environmentInput = {
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/unused_test?schema=public',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890'
}
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

  // The mode no longer reads DEPLOYMENT_ENVIRONMENT, so STAGING enforces too.
  it('enforces unless CSP_MODE asks for report-only', () => {
    expect(resolveContentSecurityPolicyMode({})).toBe('enforce')
    expect(resolveContentSecurityPolicyMode({ CSP_MODE: 'enforce' })).toBe(
      'enforce'
    )
    expect(resolveContentSecurityPolicyMode({ CSP_MODE: 'report-only' })).toBe(
      'report-only'
    )
  })

  it('reads an empty CSP_MODE as unset and refuses to start on a typo', () => {
    const mode = (CSP_MODE?: string) =>
      resolveContentSecurityPolicyMode(
        parseApiEnvironment({
          ...environmentInput,
          ...(CSP_MODE === undefined ? {} : { CSP_MODE })
        })
      )
    expect(mode()).toBe('enforce')
    expect(mode('')).toBe('enforce')
    expect(mode('report-only')).toBe('report-only')
    for (const typo of ['report_only', 'Enforce', 'off'])
      expect(() => mode(typo)).toThrow(EnvironmentValidationError)
  })
})
