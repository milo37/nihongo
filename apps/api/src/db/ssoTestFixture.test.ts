import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSsoTestEnvironment } from '../e2e/apiIntegrationExecution.js'
import { createSsoDbHarness } from './ssoTestFixture.js'

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
const setup = (capabilityRows = 1) => {
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO "DatabaseCapability"'))
      return { rows: [], rowCount: capabilityRows }
    return { rows: [], rowCount: 0 }
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
  const environment = createSsoTestEnvironment({
    DATABASE_URL: url('nihongo_test_app_login'),
    PHASE7_AUTH_GATEWAY_FIXTURE_DATABASE_URL: url('nihongo_test_app_login'),
    ADMIN_DATABASE_URL: url('fixture_owner')
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

describe('SSO learning fixture versions', () => {
  it('pairs historical submitted V1 and its V1 record while retaining an editable V2 draft', async () => {
    const normal = db.query.getMockImplementation()!
    db.query.mockImplementation(async (sql: string, ...values: unknown[]) => {
      if (sql.includes('SELECT q.id AS "questionId"')) {
        return {
          rows: [
            {
              questionId: 'question',
              versionId: 'version',
              level: 'N5',
              subject: 'VOCABULARY'
            }
          ]
        }
      }
      return normal(sql, ...values)
    })
    const harness = createSsoDbHarness()
    await harness.learningFixture('user')
    const sessions = calls('INSERT INTO "StudySession"')
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.[0]).toContain('"practiceContractVersion"')
    expect(sessions[0]?.[0]).toContain(
      "'IN_PROGRESS',1,1,false,1,transaction_timestamp()"
    )
    expect(sessions[1]?.[0]).toContain(
      "'IN_PROGRESS',1,1,false,2,transaction_timestamp()"
    )
    const records = calls('INSERT INTO "IdempotencyRecord"')
    expect(records).toHaveLength(1)
    expect(records[0]?.[0]).toContain("repeat('a',64),1,'PROCESSING'")
    expect(records[0]?.[1]?.[3]).toBe(sessions[0]?.[1]?.[0])
    expect(calls('INSERT INTO "StudyDraft"')).toHaveLength(1)
    expect(calls('INSERT INTO "StudyDraftAnswer"')).toHaveLength(1)
    expect(calls('SET CONSTRAINTS ALL IMMEDIATE')).toHaveLength(1)
  })
})

// #504 P8-1: the baseline starts with V1 issuance active; the fixture only
// registers the capability row as the migration role.
describe('SSO TEST fixture capability registration', () => {
  it('registers the capability row once as the migration role', async () => {
    await connected(async () => {
      expect(calls('INSERT INTO "DatabaseCapability"')).toHaveLength(1)
      expect(calls('INSERT INTO "DatabaseCapability"')[0]?.[1]).toEqual([
        'TEST'
      ])
      expect(calls('activate_v1_issuer')).toHaveLength(0)
      const sql = db.query.mock.calls.map(([value]) => String(value))
      const register = sql.findIndex((value) =>
        value.includes('INSERT INTO "DatabaseCapability"')
      )
      expect(sql[register - 1]).toBe('SET ROLE "nihongo_migration"')
      expect(sql[register + 1]).toBe('RESET ROLE')
    })
  })
  it('fails closed when the capability row does not match the target', async () => {
    setup(0)
    const h = createSsoDbHarness()
    try {
      await expect(h.connect()).rejects.toThrow(
        'Database capability does not match the safe target.'
      )
    } finally {
      await h.close()
    }
  })
  it('preserves the isolated schema boundary before any connection', () => {
    vi.stubEnv(
      'ADMIN_DATABASE_URL',
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
