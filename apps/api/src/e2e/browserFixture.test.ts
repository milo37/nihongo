import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminReadGuard } from '../admin/adminReadGuard.js'
import { createAdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createSsoAuthentication } from '../auth/createSsoAuthentication.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { ApplicationError } from '../errors/applicationError.js'
import {
  createBrowserFixture,
  createSsoAdminBrowserApiFixture,
  createSsoBrowserApiTestFixture
} from './browserFixture.js'

const f = vi.hoisted(() => ({
  ownerQuery: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  connect: vi.fn(async () => undefined),
  end: vi.fn(async () => undefined),
  query: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  disconnect: vi.fn(async () => undefined),
  gatewayDisconnect: vi.fn(async () => undefined),
  ready: vi.fn(async () => undefined),
  maintenance: vi.fn(async () => undefined),
  adminReadConsume: vi.fn(async () => undefined)
}))
vi.mock('pg', () => ({
  Client: class {
    connect = f.connect
    end = f.end
    query = f.ownerQuery
  }
}))
vi.mock('../db/database.js', () => ({
  createDatabaseRuntime: vi.fn(() => ({
    client: { $queryRawUnsafe: f.query },
    disconnect: f.disconnect,
    checkReadiness: f.ready
  })),
  createRoleDatabaseRuntime: vi.fn(() => ({
    client: { $queryRawUnsafe: f.query },
    disconnect: f.gatewayDisconnect
  }))
}))
vi.mock('../middleware/applicationRateLimiter.js', () => ({
  createApplicationRateLimiter: () => ({ consume: async () => undefined })
}))
vi.mock('../admin/adminReadRateLimiter.js', () => ({
  createAdminReadRateLimiter: vi.fn(() => ({ consume: f.adminReadConsume }))
}))
vi.mock('../admin/adminReadGuard.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../admin/adminReadGuard.js')>()
  return { ...actual, createAdminReadGuard: vi.fn(actual.createAdminReadGuard) }
})
vi.mock('../auth/reauthenticationStartupMaintenance.js', () => ({
  runReauthenticationStartupMaintenance: f.maintenance
}))
vi.mock('../auth/createSsoAuthentication.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../auth/createSsoAuthentication.js')>()
  return {
    ...actual,
    createSsoAuthentication: vi.fn(actual.createSsoAuthentication)
  }
})

const schema = `nihongo_${'a'.repeat(32)}_test`
const url = (login: string) =>
  `postgresql://${login}:test-only@127.0.0.1:5432/nihongo_test?schema=${schema}`
const options = () => {
  const databaseUrl = url('nihongo_test_app_login')
  const appFixtureDatabaseUrl = url('nihongo_test_app_login')
  return {
    databaseUrl,
    appFixtureDatabaseUrl,
    adminDatabaseUrl: url('fixture_owner'),
    environment: parseApiEnvironment({
      NODE_ENV: 'test',
      DEPLOYMENT_ENVIRONMENT: 'TEST',
      DATABASE_URL: databaseUrl,
      TEST_APP_FIXTURE_DATABASE_URL: appFixtureDatabaseUrl,
      BETTER_AUTH_URL: 'http://127.0.0.1:4100',
      TRUSTED_ORIGINS: 'http://127.0.0.1:4200',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      GUEST_COOKIE_SECRET: 'b'.repeat(32)
    })
  }
}
const provider = () => {
  const input = vi.mocked(createSsoAuthentication).mock.calls.at(-1)?.[0]
  const google = input?.providers?.google
  if (!google)
    throw new Error('Existing Google TEST provider was not composed.')
  return google
}
const exchange = (code: string) =>
  provider().exchange({
    code,
    nonce: 'n'.repeat(43),
    codeVerifier: 'v'.repeat(86)
  })

beforeEach(() => {
  vi.clearAllMocks()
  f.ownerQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 })
  f.adminReadConsume.mockReset().mockResolvedValue(undefined)
})

const guardedAdminFixture = async (role: 'USER' | 'ADMIN' | null) => {
  const created = await createSsoAdminBrowserApiFixture(options())
  const authentication = vi
    .mocked(createSsoAuthentication)
    .mock.results.at(-1)!.value
  const resolve = vi
    .spyOn(authentication.principalService, 'resolveAuthenticatedUser')
    .mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user:
        role === null
          ? null
          : {
              id:
                role === 'ADMIN'
                  ? created.fixture.author.userId
                  : created.fixture.learner.userId,
              name: 'Guard fixture actor',
              role,
              targetLevel: null
            },
      ownedSessionProof: {
        id: '22222222-2222-4222-8222-222222222222',
        token: 'guard-unit-session-only',
        createdAt: new Date(0),
        expiresAt: new Date(60_000),
        isFresh: false
      }
    })
  if (!created.adminGuard) throw new Error('Admin guard missing from fixture.')
  const served = vi.fn(() => new Response('protected-admin'))
  created.app.get('/__unit/admin-static', created.adminGuard, served)
  return { created, resolve, served }
}

describe('production admin static guard handoff', () => {
  it('shares production guard dependencies with the existing CMS API guards', async () => {
    const input = options()
    const created = await createSsoAdminBrowserApiFixture(input)
    expect(typeof created.adminGuard).toBe('function')
    const guards = vi
      .mocked(createAdminReadGuard)
      .mock.calls.map(([dependencies]) => dependencies)
    expect(guards.length).toBeGreaterThan(1)
    for (const dependencies of guards) expect(dependencies).toEqual(guards[0])
    expect(guards.at(-1)?.environment).toBe(input.environment)
    expect(guards.at(-1)?.rateLimiter).toBe(
      vi.mocked(createAdminReadRateLimiter).mock.results.at(-1)?.value
    )
    expect(vi.mocked(createAdminReadGuard).mock.results.at(-1)?.value).toBe(
      created.adminGuard
    )
    await created.disconnect()
  })

  it('does not expose an admin guard from the CMS-disabled USER fixture', async () => {
    const created = await createSsoBrowserApiTestFixture(options())
    expect(created.adminGuard).toBeUndefined()
    expect(createAdminReadGuard).not.toHaveBeenCalled()
    expect(createAdminReadRateLimiter).not.toHaveBeenCalled()
    await created.disconnect()
  })

  it.each([
    { role: null, status: 401 },
    { role: 'USER' as const, status: 403 },
    { role: 'ADMIN' as const, status: 200 }
  ])(
    'enforces principal role $role with status $status',
    async ({ role, status }) => {
      const { created, resolve, served } = await guardedAdminFixture(role)
      const response = await created.app.request('/__unit/admin-static')
      expect(response.status).toBe(status)
      expect(resolve).toHaveBeenCalledWith(expect.any(Headers), {
        classifyAdminAuthorityLoss: true
      })
      expect(served).toHaveBeenCalledTimes(role === 'ADMIN' ? 1 : 0)
      expect(f.query).toHaveBeenCalledTimes(role === 'ADMIN' ? 1 : 0)
      expect(f.adminReadConsume).toHaveBeenCalledTimes(role === 'ADMIN' ? 1 : 0)
      if (role === 'ADMIN') {
        expect(f.query).toHaveBeenCalledWith('SELECT "require_runtime_ready"()')
        expect(f.adminReadConsume).toHaveBeenCalledWith({
          actorId: created.fixture.author.userId,
          clientIp: expect.any(String)
        })
      }
      await created.disconnect()
    }
  )

  it.each(['principal', 'capability', 'limiter'] as const)(
    'fails closed at the %s boundary',
    async (stage) => {
      const { created, resolve, served } = await guardedAdminFixture('ADMIN')
      if (stage === 'principal')
        resolve.mockRejectedValueOnce(
          new Error('fixture principal unavailable')
        )
      else if (stage === 'capability')
        f.query.mockRejectedValueOnce(
          new Error('fixture capability unavailable')
        )
      else
        f.adminReadConsume.mockRejectedValueOnce(
          new ApplicationError({
            code: 'RATE_LIMITED',
            message: 'fixture quota exhausted',
            retryable: true,
            retryAfterSeconds: 60
          })
        )
      const response = await created.app.request('/__unit/admin-static')
      expect(response.status).toBe(stage === 'limiter' ? 429 : 503)
      expect(served).not.toHaveBeenCalled()
      expect(f.query).toHaveBeenCalledTimes(stage === 'principal' ? 0 : 1)
      expect(f.adminReadConsume).toHaveBeenCalledTimes(
        stage === 'limiter' ? 1 : 0
      )
      await created.disconnect()
    }
  )

  it('permits ADMIN reads while retaining FRESH assurance on sensitive commands', async () => {
    const { created } = await guardedAdminFixture('ADMIN')
    expect((await created.app.request('/__unit/admin-static')).status).toBe(200)
    const command = await created.app.request(
      `/api/v1/admin/questions/${created.fixture.author.userId}/archive`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:4200'
        },
        body: '{}'
      }
    )
    expect(command.status).toBe(401)
    expect(await command.json()).toMatchObject({
      code: 'FRESH_ASSURANCE_REQUIRED'
    })
    expect(
      f.query.mock.calls.every(
        ([statement]) => statement === 'SELECT "require_runtime_ready"()'
      )
    ).toBe(true)
    expect(f.adminReadConsume).toHaveBeenCalledTimes(1)
    await created.disconnect()
  })
})

describe('Google CMS browser TEST handoff', () => {
  it('prepares distinct linked actors without passwords, promotion or manual session issuance', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    const actors = Object.values(created.fixture)
    expect(actors).toHaveLength(5)
    expect(new Set(actors.map((actor) => actor.userId)).size).toBe(5)
    expect(created.fixture.author.role).toBe('ADMIN')
    expect(created.fixture.reviewer.role).toBe('ADMIN')
    expect(created.fixture.learner.role).toBe('USER')
    expect(created.fixture.insightsLearner.targetLevel).toBe('N2')
    expect(created.fixture.journeyLearner.targetLevel).toBe('N5')
    expect(Object.isFrozen(created.fixture)).toBe(true)
    const calls = f.ownerQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls.at(-1)).toEqual(['COMMIT'])
    const users = calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO "User"')
    )
    const accounts = calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO "Account"')
    )
    expect(users).toHaveLength(5)
    expect(accounts).toHaveLength(5)
    expect(
      accounts.every(
        ([sql]) =>
          String(sql).includes("'google'") && !String(sql).includes('password')
      )
    ).toBe(true)
    expect(
      calls.some(([sql]) =>
        /UPDATE|issue_v1_session|confirm_v1_session|replication_role/u.test(
          String(sql)
        )
      )
    ).toBe(false)
    for (const actor of actors) {
      expect(actor.callbackCode).toMatch(/^test-google-/u)
      expect(Object.keys(actor).sort()).toEqual([
        'callbackCode',
        'role',
        'targetLevel',
        'userId'
      ])
      const identity = await exchange(actor.callbackCode)
      expect(identity?.provider).toBe('google')
      expect(
        accounts.some(
          ([, values]) =>
            Array.isArray(values) &&
            values[1] === identity?.accountId &&
            values[2] === actor.userId
        )
      ).toBe(true)
      expect(
        users.some(
          ([, values]) =>
            Array.isArray(values) &&
            values[0] === actor.userId &&
            values[3] === actor.role
        )
      ).toBe(true)
    }
    expect(
      new Set(
        (
          await Promise.all(actors.map((actor) => exchange(actor.callbackCode)))
        ).map((identity) => identity?.accountId)
      ).size
    ).toBe(5)
    await created.database.disconnect()
    await created.database.disconnect()
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.gatewayDisconnect).not.toHaveBeenCalled()
    expect(f.end).toHaveBeenCalledOnce()
  })

  it('rejects unknown or inherited-property callback codes without role selection', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    for (const code of [
      '',
      'author',
      'ADMIN',
      '__proto__',
      'constructor',
      'test-google-author-extra'
    ])
      expect(await exchange(code)).toBeNull()
    await created.disconnect()
  })

  it('keeps state, nonce and PKCE generation in the existing Google authorization provider', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    const target = new URL(
      await provider().authorizationURL({
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(86)
      })
    )
    expect(target.origin).toBe('https://accounts.google.com')
    expect(target.searchParams.get('state')).toBe('s'.repeat(43))
    expect(target.searchParams.get('nonce')).toBe('n'.repeat(43))
    expect(target.searchParams.get('code_challenge_method')).toBe('S256')
    expect(target.searchParams.get('code_challenge')).toHaveLength(43)
    await created.disconnect()
  })

  it('composes current CMS and learning routes but denies guest and malformed fresh entry', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    expect(
      created.app.routes.some((route) =>
        route.path.startsWith('/api/v1/admin/questions')
      )
    ).toBe(true)
    expect(
      created.app.routes.some((route) => route.path.includes('dashboard'))
    ).toBe(true)
    const guest = await created.app.request('/api/v1/admin/questions')
    expect(guest.status).toBe(401)
    const fresh = await created.app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:4200'
      },
      body: JSON.stringify({
        purpose: 'ADMIN_FRESH',
        provider: 'google',
        callbackURL: '/admin/'
      })
    })
    expect(fresh.status).toBe(401)
    expect(f.query).not.toHaveBeenCalled()
    await created.disconnect()
  })

  it('keeps the existing stable actor when sign-in isolation is not selected', async () => {
    const created = await createSsoBrowserApiTestFixture(options())
    const input = {
      code: 'sso-browser-test-code',
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(86)
    }
    expect(await provider().exchange(input)).toEqual(
      await provider().exchange({ ...input, nonce: 'm'.repeat(43) })
    )
    await created.disconnect()
  })

  it('isolates Real journey identities across sign-ins while preserving a repeated callback identity', async () => {
    const created = await createSsoBrowserApiTestFixture({
      ...options(),
      isolateSignIns: true
    })
    const input = {
      code: 'sso-browser-test-code',
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(86)
    }
    const first = await provider().exchange(input)
    const repeated = await provider().exchange(input)
    const next = await provider().exchange({ ...input, nonce: 'm'.repeat(43) })
    expect(first).toEqual(repeated)
    expect(first?.accountId).not.toBe(next?.accountId)
    expect(first?.email).not.toBe(next?.email)
    const caseChanged = await provider().exchange({
      ...input,
      nonce: 'N'.repeat(43)
    })
    expect(first?.email.toLowerCase()).not.toBe(
      caseChanged?.email.toLowerCase()
    )
    expect(first?.provider).toBe('google')
    expect(first).not.toHaveProperty('role')
    expect(first).not.toHaveProperty('token')
    expect(await provider().exchange({ ...input, code: 'unknown' })).toBeNull()
    expect(await provider().exchange({ ...input, nonce: '' })).toBeNull()
    expect(f.ownerQuery).not.toHaveBeenCalled()
    await created.disconnect()
  })

  it('composes the existing USER learning contract without CMS routes or fixture writes', async () => {
    const created = await createSsoBrowserApiTestFixture(options())
    const expectedRoutes = [
      ['GET', '/api/v1/study-sessions'],
      ['POST', '/api/v1/study-sessions'],
      ['GET', '/api/v1/study-sessions/:sessionId'],
      ['GET', '/api/v1/study-sessions/:sessionId/draft-answers'],
      ['PUT', '/api/v1/study-sessions/:sessionId/draft-answers'],
      ['POST', '/api/v1/study-sessions/:sessionId/submission'],
      ['GET', '/api/v1/study-sessions/:sessionId/result'],
      ['POST', '/api/v1/study-sessions/:sessionId/retry'],
      ['GET', '/api/v1/dashboard'],
      ['GET', '/api/v1/dashboard/insights'],
      ['GET', '/api/v1/bookmarks'],
      ['PUT', '/api/v1/bookmarks/:questionId'],
      ['DELETE', '/api/v1/bookmarks/:questionId'],
      ['GET', '/api/v1/review-list'],
      ['GET', '/api/v1/wrong-notes/:questionId'],
      ['GET', '/api/v1/wrong-notes/:questionId/review-events'],
      ['GET', '/api/v1/wrong-notes/:questionId/memo'],
      ['PUT', '/api/v1/wrong-notes/:questionId/memo'],
      ['POST', '/api/v1/wrong-notes/:questionId/review-session']
    ] as const
    for (const [method, path] of expectedRoutes) {
      expect(
        created.app.routes.filter(
          (route) => route.method === method && route.path === path
        ),
        method + ' ' + path
      ).toHaveLength(1)
    }
    expect(
      created.app.routes.some((route) => route.path.startsWith('/api/v1/admin'))
    ).toBe(false)
    expect(f.ownerQuery).not.toHaveBeenCalled()
    expect(f.query).not.toHaveBeenCalled()
    await created.disconnect()
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.gatewayDisconnect).not.toHaveBeenCalled()
  })

  // JLP-823: saving (records, wrong notes, bookmarks, target level) is for
  // members; a visitor without a session gets 401 on every one of them.
  const questionId = '4ed52fae-8952-44df-9ec1-2298c893e061'
  const writeInit = {
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:4200'
    }
  }
  it.each([
    ['GET', '/api/v1/dashboard', undefined],
    ['GET', '/api/v1/dashboard/insights', undefined],
    ['GET', '/api/v1/bookmarks', undefined],
    ['PUT', `/api/v1/bookmarks/${questionId}`, {}],
    ['DELETE', `/api/v1/bookmarks/${questionId}`, undefined],
    ['GET', '/api/v1/review-list', undefined],
    ['GET', `/api/v1/wrong-notes/${questionId}`, undefined],
    ['PUT', '/api/v1/me/target-level', { targetLevel: 'N3' }]
  ] as const)(
    'keeps the member route %s %s authenticated',
    async (method, path, body) => {
      const created = await createSsoBrowserApiTestFixture(options())
      const response = await created.app.request(path, {
        method,
        ...(method === 'GET' ? {} : writeInit),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.json()).toMatchObject({
        code: 'AUTHENTICATION_REQUIRED'
      })
      expect(f.ownerQuery).not.toHaveBeenCalled()
      expect(f.query).not.toHaveBeenCalled()
      await created.disconnect()
    }
  )

  it('retains the original CMS-disabled single-USER fixture without seeding or changing its provider', async () => {
    const created = await createSsoBrowserApiTestFixture(options())
    expect(f.ownerQuery).not.toHaveBeenCalled()
    expect(await exchange('original-controlled-code')).toEqual(
      created.expectedIdentity
    )
    expect(
      created.app.routes.some((route) =>
        route.path.startsWith('/api/v1/admin/questions')
      )
    ).toBe(false)
    await created.disconnect()
  })

  it.each([
    'production',
    'deployment',
    'provider',
    'missingOwner',
    'otherTarget',
    'wrongRole',
    'wrongSchema',
    'externalOrigin'
  ] as const)('rejects %s before any DB construction or seed', async (kind) => {
    const input = options()
    if (kind === 'production') input.environment.NODE_ENV = 'production'
    if (kind === 'deployment')
      input.environment = {
        ...input.environment,
        DEPLOYMENT_ENVIRONMENT: 'PRODUCTION'
      }
    if (kind === 'provider')
      input.environment.GOOGLE_CLIENT_ID = 'forbidden-test-provider-override'
    if (kind === 'missingOwner')
      Reflect.deleteProperty(input, 'adminDatabaseUrl')
    if (kind === 'otherTarget')
      input.adminDatabaseUrl = input.adminDatabaseUrl.replace(
        'nihongo_test?',
        'other_test?'
      )
    if (kind === 'wrongRole') {
      input.databaseUrl = url('wrong_app')
      input.environment.DATABASE_URL = input.databaseUrl
    }
    if (kind === 'wrongSchema') {
      input.databaseUrl = input.databaseUrl.replace(schema, 'public')
      input.environment.DATABASE_URL = input.databaseUrl
    }
    if (kind === 'externalOrigin')
      input.environment.TRUSTED_ORIGINS = ['https://example.test']
    await expect(createSsoAdminBrowserApiFixture(input)).rejects.toThrow()
    expect(createDatabaseRuntime).not.toHaveBeenCalled()
    expect(f.connect).not.toHaveBeenCalled()
  })

  it('rolls back failed actor preparation and closes the private owner and app connections', async () => {
    f.ownerQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO "Account"'))
        throw new Error('controlled seed failure')
      return { rows: [], rowCount: 1 }
    })
    await expect(createSsoAdminBrowserApiFixture(options())).rejects.toThrow(
      'controlled seed failure'
    )
    expect(f.ownerQuery.mock.calls.at(-1)).toEqual(['ROLLBACK'])
    expect(f.end).toHaveBeenCalledOnce()
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(f.gatewayDisconnect).not.toHaveBeenCalled()
  })
})

describe('SSO CMS lifecycle persistence postcondition', () => {
  const snapshot = (reauthentications = 0, cmsAudits = 0) => ({
    account: 10,
    audit: 8 + cmsAudits + reauthentications,
    importApply: 0,
    operationIntent: 0,
    option: cmsAudits ? 52 : 40,
    question: cmsAudits ? 12 : 10,
    reauthenticationFinalized: reauthentications,
    reauthenticationIntent: reauthentications,
    report: cmsAudits ? 1 : 0,
    review: cmsAudits ? 12 : 0,
    user: 10,
    version: cmsAudits ? 13 : 10,
    versionTag: cmsAudits ? 13 : 10
  })
  const persistedCompletions = (author: string, reviewer: string) =>
    [author, author, reviewer, author, reviewer, author].map((userId) => ({
      userId,
      finalized: true,
      proof: true,
      audit: true,
      proofCount: 6
    }))

  it('requires the whole acceptance sequence, not just the canonical three completions', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    f.ownerQuery.mockResolvedValueOnce({ rows: [snapshot()] })
    const before = await created.database.snapshot()
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [snapshot(6, 24)] })
      .mockResolvedValueOnce({
        rows: persistedCompletions(
          created.fixture.author.userId,
          created.fixture.reviewer.userId
        )
      })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).resolves.toBeUndefined()
    expect(f.ownerQuery.mock.calls.at(-1)?.[1]).toEqual([
      created.fixture.author.userId,
      created.fixture.reviewer.userId
    ])
    await created.database.disconnect()
  })

  it.each([1, 2, 3, 5, 7])(
    'rejects %i rotations even with matching intent/finalization totals',
    async (count) => {
      const created = await createSsoAdminBrowserApiFixture(options())
      f.ownerQuery.mockResolvedValueOnce({ rows: [snapshot(count, 24)] })
      await expect(
        created.database.assertExpectedLifecycleDelta(snapshot())
      ).rejects.toThrow('delta mismatch')
      await created.database.disconnect()
    }
  )

  it.each(['finalized', 'proof', 'audit'] as const)(
    'fails closed for an unbound or missing %s despite correct aggregate totals',
    async (key) => {
      const created = await createSsoAdminBrowserApiFixture(options())
      const rows = persistedCompletions(
        created.fixture.author.userId,
        created.fixture.reviewer.userId
      )
      rows[2]![key] = false
      f.ownerQuery
        .mockResolvedValueOnce({ rows: [snapshot(6, 24)] })
        .mockResolvedValueOnce({ rows })
      await expect(
        created.database.assertExpectedLifecycleDelta(snapshot())
      ).rejects.toThrow('actor-bound reauthentication lifecycle')
      await created.database.disconnect()
    }
  )

  it('rejects using an author completion in place of the distinct reviewer', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    const rows = persistedCompletions(
      created.fixture.author.userId,
      created.fixture.reviewer.userId
    )
    rows[2]!.userId = created.fixture.author.userId
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [snapshot(6, 24)] })
      .mockResolvedValueOnce({ rows })
    await expect(
      created.database.assertExpectedLifecycleDelta(snapshot())
    ).rejects.toThrow('actor-bound reauthentication lifecycle')
    await created.database.disconnect()
  })

  it.each([0, 5, 7])(
    'rejects %i retained proofs rather than accepting erased or extra evidence',
    async (proofCount) => {
      const created = await createSsoAdminBrowserApiFixture(options())
      const rows = persistedCompletions(
        created.fixture.author.userId,
        created.fixture.reviewer.userId
      )
      rows[0]!.proofCount = proofCount
      f.ownerQuery
        .mockResolvedValueOnce({ rows: [snapshot(6, 24)] })
        .mockResolvedValueOnce({ rows })
      await expect(
        created.database.assertExpectedLifecycleDelta(snapshot())
      ).rejects.toThrow('actor-bound reauthentication lifecycle')
      await created.database.disconnect()
    }
  )

  it('rejects a missing completion receipt with unchanged global counters', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    const rows = persistedCompletions(
      created.fixture.author.userId,
      created.fixture.reviewer.userId
    ).slice(1)
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [snapshot(6, 24)] })
      .mockResolvedValueOnce({ rows })
    await expect(
      created.database.assertExpectedLifecycleDelta(snapshot())
    ).rejects.toThrow('actor-bound reauthentication lifecycle')
    await created.database.disconnect()
  })

  it('keeps legacy credential lifecycle expectations at one rotation and 25 audits', async () => {
    const created = await createBrowserFixture(options().adminDatabaseUrl)
    f.ownerQuery.mockResolvedValueOnce({ rows: [snapshot(1, 24)] })
    const queriesBefore = f.ownerQuery.mock.calls.length
    await expect(
      created.database.assertExpectedLifecycleDelta(snapshot())
    ).resolves.toBeUndefined()
    expect(f.ownerQuery.mock.calls.length - queriesBefore).toBe(1)
    await created.database.disconnect()
  })
})

describe('explicit A1-A8 SSO administrator lifecycle profile', () => {
  const before = {
    user: 10,
    account: 10,
    question: 10,
    version: 10,
    option: 40,
    versionTag: 10,
    review: 0,
    audit: 8,
    importApply: 0,
    reauthenticationIntent: 0,
    reauthenticationFinalized: 0,
    operationIntent: 0,
    report: 0
  }
  const after = {
    ...before,
    question: 11,
    version: 11,
    option: 44,
    versionTag: 11,
    review: 1,
    audit: 12,
    reauthenticationIntent: 1,
    reauthenticationFinalized: 1
  }
  const completion = (userId: string) => ({
    userId,
    finalized: true,
    proof: true,
    audit: true,
    proofCount: 1
  })
  const commands = () => ({
    state: true,
    create: true,
    update: true,
    archive: true,
    review: true
  })

  it('accepts one owned DRAFT create/PATCH/archive and one bound fresh completion', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({
        rows: [completion(created.fixture.author.userId)]
      })
      .mockResolvedValueOnce({ rows: [commands()] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).resolves.toBeUndefined()
    expect(f.ownerQuery.mock.calls.at(-1)?.[1]).toEqual([
      created.fixture.author.userId
    ])
    await created.database.disconnect()
  })

  it('accepts one trailing admin import as a separate owned DRAFT question (#527)', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({
        rows: [
          {
            ...after,
            question: 12,
            version: 12,
            option: 48,
            versionTag: 12,
            audit: 14,
            importApply: 1
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [completion(created.fixture.author.userId)]
      })
      .mockResolvedValueOnce({ rows: [commands()] })
      .mockResolvedValueOnce({ rows: [{ state: true, audit: true }] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).resolves.toBeUndefined()
    expect(f.ownerQuery.mock.calls.at(-1)?.[1]).toEqual([
      created.fixture.author.userId
    ])
    await created.database.disconnect()
  })

  it.each([
    ['a missing', []],
    ['an unbound', [{ state: true, audit: false }]],
    ['a published', [{ state: false, audit: true }]]
  ] as const)('rejects %s imported question', async (_label, rows) => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({
        rows: [
          {
            ...after,
            question: 12,
            version: 12,
            option: 48,
            versionTag: 12,
            audit: 14,
            importApply: 1
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [completion(created.fixture.author.userId)]
      })
      .mockResolvedValueOnce({ rows: [commands()] })
      .mockResolvedValueOnce({ rows: [...rows] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('A1-A8 imported question lifecycle failed.')
    await created.database.disconnect()
  })

  it('rejects more than one import in the A1-A8 profile', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery.mockResolvedValueOnce({
      rows: [{ ...after, importApply: 2 }]
    })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('delta mismatch for importApply')
    await created.database.disconnect()
  })

  it('requires explicit selection instead of silently relaxing the default full lifecycle', async () => {
    const created = await createSsoAdminBrowserApiFixture(options())
    f.ownerQuery.mockResolvedValueOnce({ rows: [after] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('delta mismatch')
    await created.database.disconnect()
  })

  it('rejects the old full-lifecycle deltas in the A1-A8 profile', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery.mockResolvedValueOnce({
      rows: [
        {
          ...before,
          question: 12,
          version: 13,
          option: 52,
          versionTag: 13,
          review: 12,
          audit: 38,
          reauthenticationIntent: 6,
          reauthenticationFinalized: 6,
          report: 1
        }
      ]
    })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('delta mismatch')
    await created.database.disconnect()
  })

  it.each([
    ['review', 0],
    ['review', 2],
    ['audit', 11],
    ['audit', 13],
    ['report', 1],
    ['versionTag', 12],
    ['option', 45],
    ['reauthenticationIntent', 0],
    ['operationIntent', 1]
  ] as const)('rejects an unexpected %s total of %i', async (key, value) => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery.mockResolvedValueOnce({ rows: [{ ...after, [key]: value }] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('delta mismatch')
    await created.database.disconnect()
  })

  it.each(['finalized', 'proof', 'audit'] as const)(
    'rejects an unbound %s even when all A1-A8 totals match',
    async (key) => {
      const created = await createSsoAdminBrowserApiFixture(
        options(),
        'admin-a1-a8'
      )
      const row = completion(created.fixture.author.userId)
      row[key] = false
      f.ownerQuery
        .mockResolvedValueOnce({ rows: [after] })
        .mockResolvedValueOnce({ rows: [row] })
      await expect(
        created.database.assertExpectedLifecycleDelta(before)
      ).rejects.toThrow('actor-bound reauthentication lifecycle')
      await created.database.disconnect()
    }
  )

  it('does not substitute the reviewer proof for the author archive proof', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({
        rows: [completion(created.fixture.reviewer.userId)]
      })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('actor-bound reauthentication lifecycle')
    await created.database.disconnect()
  })

  it.each([0, 2])('rejects %i retained fresh proofs', async (proofCount) => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({
        rows: [{ ...completion(created.fixture.author.userId), proofCount }]
      })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('actor-bound reauthentication lifecycle')
    await created.database.disconnect()
  })

  it.each(['state', 'create', 'update', 'archive', 'review'] as const)(
    'rejects wrong owned %s evidence despite correct counts',
    async (key) => {
      const created = await createSsoAdminBrowserApiFixture(
        options(),
        'admin-a1-a8'
      )
      const row = commands()
      row[key] = false
      f.ownerQuery
        .mockResolvedValueOnce({ rows: [after] })
        .mockResolvedValueOnce({
          rows: [completion(created.fixture.author.userId)]
        })
        .mockResolvedValueOnce({ rows: [row] })
      await expect(
        created.database.assertExpectedLifecycleDelta(before)
      ).rejects.toThrow('A1-A8 owned command lifecycle')
      await created.database.disconnect()
    }
  )

  it('rejects a missing owned aggregate instead of accepting audit counts alone', async () => {
    const created = await createSsoAdminBrowserApiFixture(
      options(),
      'admin-a1-a8'
    )
    f.ownerQuery
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({
        rows: [completion(created.fixture.author.userId)]
      })
      .mockResolvedValueOnce({ rows: [] })
    await expect(
      created.database.assertExpectedLifecycleDelta(before)
    ).rejects.toThrow('A1-A8 owned command lifecycle')
    await created.database.disconnect()
  })

  it('rejects an unknown profile before creating or seeding any database client', async () => {
    await expect(
      createSsoAdminBrowserApiFixture(options(), 'unknown' as never)
    ).rejects.toThrow('Unknown SSO admin lifecycle profile')
    expect(f.connect).not.toHaveBeenCalled()
    expect(f.ownerQuery).not.toHaveBeenCalled()
  })
})
