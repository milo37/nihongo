import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { DATABASE_CAPABILITY_SQL } from './databaseCapability.js'
import { runRegisterDatabaseCapabilityCommand } from './registerDatabaseCapabilityCommand.js'

const db = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  query:
    vi.fn<
      (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: unknown[]; rowCount?: number }>
    >(),
  end: vi.fn<() => Promise<void>>(),
  construct: vi.fn()
}))
vi.mock('pg', () => ({
  Client: class {
    connect = db.connect
    query = db.query
    end = db.end
    constructor(options: unknown) {
      db.construct(options)
    }
  }
}))

const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_production_migration_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_production_app_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require',
  PRODUCTION_DATABASE_URL:
    'postgresql://nihongo_production_app_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require'
})
const test = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_test_migration_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_capability_test&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_app:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_capability_test',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:unit-only@production.invalid:5432/nihongo_production?schema=public'
})
const development = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DEPLOYMENT_ENVIRONMENT: 'LOCAL',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_development_migration_login:unit-only@127.0.0.1:5432/nihongo_dev?schema=public&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_app:unit-only@127.0.0.1:5432/nihongo_dev?schema=public',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:unit-only@production.invalid:5432/nihongo_production?schema=public'
})
const staging = (): NodeJS.ProcessEnv => ({
  ...production(),
  DEPLOYMENT_ENVIRONMENT: 'STAGING'
})
const confirm = { DATABASE_CAPABILITY_CONFIRM: 'REGISTER_DATABASE_CAPABILITY' }

let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>
const originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks()
  process.exitCode = undefined
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  db.connect.mockResolvedValue(undefined)
  db.end.mockResolvedValue(undefined)
  db.query.mockImplementation(async (sql) =>
    sql.startsWith('SELECT')
      ? { rows: [{ environment: 'TEST' }] }
      : { rows: [], rowCount: sql.startsWith('INSERT') ? 1 : 0 }
  )
})
afterEach(() => {
  process.exitCode = originalExit
  vi.restoreAllMocks()
})
const printed = () =>
  JSON.parse(String(stdout.mock.calls[0]?.[0])) as Record<string, unknown>
const statements = () => db.query.mock.calls.map(([sql]) => sql)
const expectFailure = () => {
  expect(process.exitCode).toBe(1)
  expect(stdout).not.toHaveBeenCalled()
  expect(stderr).toHaveBeenCalledExactlyOnceWith(
    '{"event":"database_capability_register_failed"}\n'
  )
}

describe('database capability operator CLI', () => {
  it.each([
    ['TEST', test],
    ['PRODUCTION', production]
  ])('reports the %s row without writing', async (environment, input) => {
    await runRegisterDatabaseCapabilityCommand(input())
    expect(process.exitCode).toBeUndefined()
    expect(printed()).toEqual({
      event: 'database_capability_dry_run',
      environment,
      registered: 'TEST'
    })
    expect(statements().at(-1)).toBe('ROLLBACK')
    expect(statements()).not.toContain(DATABASE_CAPABILITY_SQL)
  })

  it.each([
    ['TEST', test],
    ['DEVELOPMENT', development],
    ['PRODUCTION', production],
    ['PRODUCTION', staging]
  ])('registers the confirmed %s row', async (environment, input) => {
    await runRegisterDatabaseCapabilityCommand({ ...input(), ...confirm })
    expect(process.exitCode).toBeUndefined()
    expect(db.query).toHaveBeenCalledWith(DATABASE_CAPABILITY_SQL, [
      environment
    ])
    expect(statements().at(-1)).toBe('COMMIT')
    expect(printed()).toEqual({
      event: 'database_capability_registered',
      environment,
      previous: 'TEST',
      occurredAt: expect.any(String)
    })
    expect(db.construct.mock.calls[0]?.[0]).toMatchObject({
      options: expect.stringContaining('-c role=nihongo_migration')
    })
  })

  it('rolls back when the target does not match the requested environment', async () => {
    db.query.mockImplementation(async (sql) =>
      sql.startsWith('SELECT') ? { rows: [] } : { rows: [], rowCount: 0 }
    )
    await runRegisterDatabaseCapabilityCommand({ ...production(), ...confirm })
    expectFailure()
    expect(statements()).toContain('ROLLBACK')
    expect(statements()).not.toContain('COMMIT')
  })

  it.each<[string, () => NodeJS.ProcessEnv]>([
    [
      'wrong confirmation',
      () => ({ ...test(), DATABASE_CAPABILITY_CONFIRM: 'YES' })
    ],
    [
      'production without production deployment',
      () => ({ ...production(), DEPLOYMENT_ENVIRONMENT: undefined })
    ],
    [
      'production on a test deployment',
      () => ({ ...production(), DEPLOYMENT_ENVIRONMENT: 'TEST' })
    ],
    [
      'test on a staging deployment',
      () => ({ ...test(), DEPLOYMENT_ENVIRONMENT: 'STAGING' })
    ],
    [
      'development on a staging deployment',
      () => ({ ...development(), DEPLOYMENT_ENVIRONMENT: 'STAGING' })
    ],
    [
      'production with the app login',
      () => ({
        ...production(),
        MIGRATION_DATABASE_URL: production().PRODUCTION_DATABASE_URL
      })
    ],
    [
      'production target other than PRODUCTION_DATABASE_URL',
      () => ({
        ...production(),
        PRODUCTION_DATABASE_URL:
          'postgresql://nihongo_production_app_login:unit-only@other.invalid:5432/nihongo?schema=public&sslmode=require'
      })
    ],
    [
      'test without runtime proof',
      () => ({ ...test(), DATABASE_URL: undefined })
    ]
  ])('rejects %s before connecting', async (_label, input) => {
    await runRegisterDatabaseCapabilityCommand({ ...confirm, ...input() })
    expectFailure()
    expect(db.construct).not.toHaveBeenCalled()
  })

  it('redacts database failures and still closes', async () => {
    db.query.mockRejectedValue(
      new Error('postgresql://secret:private@postgres/nihongo')
    )
    await runRegisterDatabaseCapabilityCommand({ ...production(), ...confirm })
    expectFailure()
    expect(db.end).toHaveBeenCalledOnce()
  })
})
