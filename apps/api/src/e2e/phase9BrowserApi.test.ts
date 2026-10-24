import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serve } from '@hono/node-server'
import {
  createPhase9BrowserApi,
  createPhase9GoogleTestProvider,
  parsePhase9BrowserEnvironment,
  preparePhase9BrowserActors
} from './phase9BrowserApi.js'

const pg = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  failInsert: false,
  wrongRole: false,
  users: new Map<string, string>()
}))
const runtime = vi.hoisted(() => ({
  app: {
    client: { $queryRawUnsafe: vi.fn() },
    checkReadiness: vi.fn(),
    checkV1Compatibility: vi.fn(),
    disconnect: vi.fn()
  },
  gateway: { client: { $queryRawUnsafe: vi.fn() }, disconnect: vi.fn() }
}))
vi.mock('../db/database.js', () => ({
  createDatabaseRuntime: vi.fn(() => runtime.app),
  createRoleDatabaseRuntime: vi.fn(() => runtime.gateway)
}))
vi.mock('@hono/node-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hono/node-server')>()),
  serve: vi.fn()
}))
vi.mock('pg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pg')>()),
  Client: class {
    connect = pg.connect
    query = pg.query
    end = pg.end
  }
}))

const schema = `phase7_${'a'.repeat(32)}_test`
const url = (login: string) =>
  `postgresql://${login}:unused@127.0.0.1:5432/nihongo_phase9_test?schema=${schema}`
const source = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  ADMIN_CMS_MODE: 'technical',
  PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
  HOST: '127.0.0.1',
  PORT: '58101',
  BETTER_AUTH_URL: 'http://127.0.0.1:58101',
  TRUSTED_ORIGINS: 'http://127.0.0.1:58102',
  DATABASE_URL: url('nihongo_test_app_login'),
  AUTH_GATEWAY_DATABASE_URL: url('nihongo_test_auth_gateway_login'),
  PRODUCTION_DATABASE_URL:
    'postgresql://production:unused@production.example.invalid/production',
  BETTER_AUTH_SECRET: 'phase9-unit-auth-secret-at-least-32-characters',
  GUEST_COOKIE_SECRET: 'phase9-unit-guest-secret-at-least-32-characters'
})
const ownerUrl = url('phase9_test_owner')
const makeIdentities = () =>
  Object.fromEntries(
    [
      ['author', 'ADMIN', 'N3', 'author'],
      ['reviewer', 'ADMIN', 'N3', 'reviewer'],
      ['learner', 'USER', 'N3', 'learner'],
      ['insightsLearner', 'USER', 'N2', 'insights'],
      ['journeyLearner', 'USER', 'N5', 'journey']
    ].map(([key, role, targetLevel, code], index) => [
      key!,
      {
        actor: {
          userId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          role,
          targetLevel,
          callbackCode: `phase7-test-google-${code}`
        },
        identity: {
          provider: 'google',
          accountId: `test-subject-${key}`,
          email: `${key}@example.test`,
          name: `TEST ${key}`
        }
      }
    ])
  )

beforeEach(() => {
  vi.clearAllMocks()
  pg.failInsert = false
  pg.wrongRole = false
  pg.users.clear()
  pg.connect.mockResolvedValue(undefined)
  pg.end.mockResolvedValue(undefined)
  pg.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('WITH actor AS')) {
      if (pg.failInsert) throw new Error('fixture-write-failed')
      pg.users.set(String(values[0]), String(values[3]))
      return { rows: [{ userId: values[0] }] }
    }
    if (sql.startsWith('UPDATE "User"')) {
      return {
        rows: [
          {
            id: values[0],
            targetLevel: values[1],
            role: pg.wrongRole ? 'USER' : pg.users.get(String(values[0]))
          }
        ]
      }
    }
    return { rows: [] }
  })
})

describe('Phase9 isolated TEST SSO bootstrap', () => {
  it('imports without listening or opening a database connection', () => {
    expect(serve).not.toHaveBeenCalled()
    expect(pg.connect).not.toHaveBeenCalled()
    expect(parsePhase9BrowserEnvironment(source())).toMatchObject({
      NODE_ENV: 'test',
      ADMIN_CMS_MODE: 'technical'
    })
  })

  it('assembles the current learner/report/admin routes without querying or listening and disconnects once', async () => {
    const fixture = await createPhase9BrowserApi({
      environment: source(),
      identities: makeIdentities()
    })
    const paths = fixture.app.routes.map((route) => route.path)
    for (const prefix of [
      '/api/v1/me',
      '/api/v1/study-sessions',
      '/api/v1/wrong-notes',
      '/api/v1/question-reports',
      '/api/v1/admin/questions'
    ]) {
      expect(paths.some((path) => path.startsWith(prefix))).toBe(true)
    }
    expect(runtime.app.client.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(runtime.gateway.client.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(serve).not.toHaveBeenCalled()
    await Promise.all([fixture.disconnect(), fixture.disconnect()])
    expect(runtime.app.disconnect).toHaveBeenCalledTimes(1)
    expect(runtime.gateway.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([
    { NODE_ENV: 'production' },
    { DEPLOYMENT_ENVIRONMENT: 'LOCAL' },
    { ADMIN_CMS_MODE: 'disabled' },
    { PRACTICE_CONTRACT_RUNTIME: 'v1-compatible' },
    { GOOGLE_CLIENT_ID: 'real-provider' },
    { APPLE_CLIENT_SECRET: 'real-provider' },
    { TRUSTED_ORIGINS: 'https://outside.example.test' },
    { BETTER_AUTH_URL: 'http://127.0.0.1:58103' },
    { DATABASE_URL: url('nihongo_test_auth_gateway_login') },
    {
      AUTH_GATEWAY_DATABASE_URL: url('nihongo_test_auth_gateway_login').replace(
        'nihongo_phase9_test',
        'another_test'
      )
    },
    { DATABASE_URL: url('nihongo_test_app_login') + '&schema=other' },
    {
      DATABASE_URL:
        url('nihongo_test_app_login') + '&options=-c%20role=postgres'
    },
    { DATABASE_URL: url('nihongo_test_app_login').replace(schema, 'public') },
    { PRODUCTION_DATABASE_URL: url('nihongo_test_app_login') }
  ])('rejects non-owned TEST configuration before connecting: %j', (change) => {
    expect(() =>
      parsePhase9BrowserEnvironment({ ...source(), ...change })
    ).toThrow()
    expect(pg.connect).not.toHaveBeenCalled()
  })

  it('preserves Google authorization state, nonce and S256 PKCE without a network exchange', async () => {
    const provider = createPhase9GoogleTestProvider(source(), makeIdentities())
    const authorization = new URL(
      await provider.authorizationURL({
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(86)
      })
    )
    expect(authorization.origin).toBe('https://accounts.google.com')
    expect(authorization.searchParams.get('state')).toBe('s'.repeat(43))
    expect(authorization.searchParams.get('nonce')).toBe('n'.repeat(43))
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/u
    )
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:58101/api/auth/callback/google'
    )
  })

  it('returns only the exact allowlisted identity, never a caller-supplied role/session', async () => {
    const identities = makeIdentities()
    const provider = createPhase9GoogleTestProvider(source(), identities)
    const input = {
      code: 'phase7-test-google-author',
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(86)
    }
    const identity = await provider.exchange(input)
    expect(identity).toEqual(identities.author!.identity)
    expect(identity).not.toHaveProperty('role')
    expect(identity).not.toHaveProperty('token')
    expect(
      await provider.exchange({ ...input, code: 'phase7-test-google-learner' })
    ).toEqual(identities.learner!.identity)
    for (const code of [
      '',
      'unknown',
      'phase7-test-google-author-extra',
      'PHASE7-TEST-GOOGLE-AUTHOR',
      '__proto__'
    ]) {
      expect(await provider.exchange({ ...input, code })).toBeNull()
    }
    identities.author!.identity.accountId =
      'changed-after-provider-construction'
    expect(await provider.exchange(input)).toEqual(identity)
  })

  it.each([
    'role',
    'callbackCode',
    'duplicate-user',
    'duplicate-subject',
    'extra-field'
  ])('rejects mismatched private actor authority: %s', (kind) => {
    const value = makeIdentities()
    if (kind === 'role') value.learner!.actor.role = 'ADMIN'
    if (kind === 'callbackCode')
      value.learner!.actor.callbackCode = 'phase7-test-google-author'
    if (kind === 'duplicate-user')
      value.learner!.actor.userId = value.author!.actor.userId
    if (kind === 'duplicate-subject')
      value.learner!.identity.accountId = value.author!.identity.accountId
    if (kind === 'extra-field')
      Object.assign(value.author!.identity, { role: 'ADMIN' })
    expect(() => createPhase9GoogleTestProvider(source(), value)).toThrow()
  })

  it('prepares five Google Account-bound actors atomically and confirms the stored DB roles', async () => {
    const result = await preparePhase9BrowserActors({
      adminDatabaseUrl: ownerUrl,
      environment: source()
    })
    expect(Object.keys(result.fixture)).toHaveLength(5)
    expect(result.fixture.author).toMatchObject({
      role: 'ADMIN',
      targetLevel: 'N3'
    })
    expect(result.fixture.learner).toMatchObject({
      role: 'USER',
      targetLevel: 'N3'
    })
    expect(result.fixture.insightsLearner.targetLevel).toBe('N2')
    expect(result.fixture.journeyLearner.targetLevel).toBe('N5')
    expect(
      new Set(Object.values(result.fixture).map((actor) => actor.userId)).size
    ).toBe(5)
    expect(
      Object.values(result.fixture).some(
        (actor) =>
          'password' in actor || 'email' in actor || 'identity' in actor
      )
    ).toBe(false)
    expect(pg.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(pg.query).toHaveBeenLastCalledWith('COMMIT')
    expect(
      pg.query.mock.calls.filter(([sql]) =>
        String(sql).startsWith('WITH actor AS')
      )
    ).toHaveLength(5)
    expect(
      pg.query.mock.calls.filter(([sql]) =>
        String(sql).startsWith('UPDATE "User"')
      )
    ).toHaveLength(5)
    expect(
      pg.query.mock.calls.some(([sql]) =>
        /INSERT INTO "Session"|credential/u.test(String(sql))
      )
    ).toBe(false)
    expect(pg.end).toHaveBeenCalledTimes(1)
  })

  it.each(['write', 'role'])(
    'rolls back and closes the owner after fixture %s failure',
    async (kind) => {
      pg.failInsert = kind === 'write'
      pg.wrongRole = kind === 'role'
      await expect(
        preparePhase9BrowserActors({
          adminDatabaseUrl: ownerUrl,
          environment: source()
        })
      ).rejects.toThrow(
        kind === 'write'
          ? 'fixture-write-failed'
          : 'PHASE9_DATABASE_ACTOR_AUTHORITY_MISMATCH'
      )
      expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK')
      expect(pg.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false)
      expect(pg.end).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    url('nihongo_test_app_login'),
    ownerUrl.replace('nihongo_phase9_test', 'another_test')
  ])(
    'rejects a runtime or foreign owner before connecting',
    async (adminDatabaseUrl) => {
      await expect(
        preparePhase9BrowserActors({ adminDatabaseUrl, environment: source() })
      ).rejects.toThrow()
      expect(pg.connect).not.toHaveBeenCalled()
    }
  )
})
