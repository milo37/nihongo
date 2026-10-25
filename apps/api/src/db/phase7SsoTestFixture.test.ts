import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPhase7SsoTestEnvironment } from '../e2e/phase10ApiIntegrationExecution.js'
import { createSsoDbHarness } from './phase7SsoTestFixture.js'

const db = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
  options: [] as Array<{ options: string }>
}))
vi.mock('pg', () => ({
  Client: class {
    constructor(options: { options: string }) {
      db.options.push(options)
    }
    connect = db.connect
    end = db.end
    query = db.query
  }
}))
const schema = 'phase7_fixture_unit_test'
const url = (user: string) =>
  `postgresql://${user}:unused@127.0.0.1:5432/nihongo_fixture_unit_test?schema=${schema}`
const calls = (name: string) =>
  db.query.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes(name)
  )
const setup = (rows: unknown[] = [{ id: 1, legacyIssuerDisabled: false }]) => {
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('current_database()')) {
      return {
        rows: [
          {
            name: 'nihongo_fixture_unit_test',
            address: '127.0.0.1',
            port: 5432
          }
        ]
      }
    }
    if (sql.includes('FROM "AuthIssuerActivation"')) return { rows }
    return { rows: [] }
  })
}
const connected = async (assertions: () => Promise<void>) => {
  const h = createSsoDbHarness()
  try {
    await h.connect()
    await assertions()
  } finally {
    await h.close()
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  db.options.length = 0
  const environment = createPhase7SsoTestEnvironment({
    DATABASE_URL: url('nihongo_test_app_login'),
    AUTH_GATEWAY_DATABASE_URL: url('nihongo_test_auth_gateway_login'),
    PHASE7_ADMIN_DATABASE_URL: url('fixture_owner')
  })
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value)
  vi.stubEnv(
    'PRODUCTION_DATABASE_URL',
    url('fixture_owner').replace(
      'nihongo_fixture_unit_test',
      'nihongo_production_guard_sentinel'
    )
  )
  setup()
})
afterEach(() => vi.unstubAllEnvs())

describe('SSO TEST fixture activation ownership', () => {
  it('activates fresh state once after registering the exact endpoint capability', async () => {
    await connected(async () => {
      expect(calls('phase7_register_database_capability')[0]?.[1]).toEqual([
        'nihongo_fixture_unit_test',
        '127.0.0.1',
        5432
      ])
      expect(calls('phase7_activate_v1_issuer')).toHaveLength(1)
      const sql = db.query.mock.calls.map(([value]) => String(value))
      expect(
        sql.findIndex((value) =>
          value.includes('phase7_register_database_capability')
        )
      ).toBeLessThan(
        sql.findIndex((value) => value.includes('FROM "AuthIssuerActivation"'))
      )
      expect(
        sql.findIndex((value) => value.includes('FROM "AuthIssuerActivation"'))
      ).toBeLessThan(
        sql.findIndex((value) => value.includes('phase7_activate_v1_issuer'))
      )
    })
  })
  it('reuses already-active state while retaining endpoint registration and role/namespace options', async () => {
    setup([{ id: 1, legacyIssuerDisabled: true }])
    await connected(async () => {
      expect(calls('phase7_register_database_capability')).toHaveLength(1)
      expect(calls('phase7_activate_v1_issuer')).toHaveLength(0)
      expect(db.connect).toHaveBeenCalledTimes(4)
      expect(db.options).toHaveLength(4)
      expect(
        db.options.every((value) =>
          value.options.includes(`search_path=${schema}`)
        )
      ).toBe(true)
      expect(
        db.options.filter((value) =>
          value.options.includes('role=nihongo_auth_gateway')
        )
      ).toHaveLength(2)
      expect(
        db.options.filter((value) => value.options.includes('role=nihongo_app'))
      ).toHaveLength(1)
    })
  })
  it.each(
    [
      [],
      [
        { id: 1, legacyIssuerDisabled: false },
        { id: 1, legacyIssuerDisabled: true }
      ],
      [{ id: 2, legacyIssuerDisabled: true }],
      [{ id: 1, legacyIssuerDisabled: null }],
      [{ id: 1, legacyIssuerDisabled: 'true' }],
      [{ id: 1 }]
    ].map((rows) => ({ rows }))
  )(
    'fails closed for invalid activation singleton rows: %j',
    async ({ rows }) => {
      setup(rows)
      const h = createSsoDbHarness()
      try {
        await expect(h.connect()).rejects.toThrow(
          'Phase 7 issuer activation singleton is invalid.'
        )
        expect(calls('phase7_activate_v1_issuer')).toHaveLength(0)
      } finally {
        await h.close()
      }
    }
  )
  it('rejects an unavailable endpoint before registration or activation', async () => {
    db.query.mockResolvedValue({ rows: [] })
    const h = createSsoDbHarness()
    try {
      await expect(h.connect()).rejects.toThrow(
        'Phase 7 DB endpoint identity is unavailable.'
      )
      expect(calls('phase7_register_database_capability')).toHaveLength(0)
      expect(calls('phase7_activate_v1_issuer')).toHaveLength(0)
    } finally {
      await h.close()
    }
  })
  it.each(['phase7_register_database_capability', 'phase7_activate_v1_issuer'])(
    'propagates %s failure instead of silently continuing',
    async (command) => {
      const normal = db.query.getMockImplementation()!
      const failure = new Error('synthetic command failure')
      db.query.mockImplementation(async (sql: string) => {
        if (sql.includes(command)) throw failure
        return normal(sql)
      })
      const h = createSsoDbHarness()
      try {
        await expect(h.connect()).rejects.toBe(failure)
        if (command.includes('register'))
          expect(calls('phase7_activate_v1_issuer')).toHaveLength(0)
      } finally {
        await h.close()
      }
    }
  )
  it('preserves the isolated schema boundary before any connection', () => {
    vi.stubEnv(
      'PHASE7_ADMIN_DATABASE_URL',
      url('fixture_owner').replace(schema, 'phase7_other_test')
    )
    expect(() => createSsoDbHarness()).toThrow(
      'SSO integration requires the existing isolated Phase 7 TEST harness.'
    )
    expect(db.connect).toHaveBeenCalledTimes(0)
  })
  it('requires production-target mismatch proof before connecting', () => {
    vi.stubEnv('PRODUCTION_DATABASE_URL', undefined)
    expect(() => createSsoDbHarness()).toThrow(
      'Technical admin CMS mode requires PRODUCTION_DATABASE_URL mismatch proof.'
    )
    expect(db.connect).toHaveBeenCalledTimes(0)
  })
  it('preserves the explicit TEST-only boundary', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => createSsoDbHarness()).toThrow()
    expect(db.connect).toHaveBeenCalledTimes(0)
  })
})
