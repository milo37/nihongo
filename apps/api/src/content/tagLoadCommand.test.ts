import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { runTagLoadCommand } from './tagLoadCommand.js'

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

const TAG_LIST_FILE = fileURLToPath(
  new URL('../../test/fixtures/content/tags.v2.sample.json', import.meta.url)
)
const target = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_test_migration_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_tag_test&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_app:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_tag_test',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:unit-only@production.invalid:5432/nihongo_production?schema=public',
  TAG_LIST_FILE
})
const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_production_migration_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_production_app_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require',
  PRODUCTION_DATABASE_URL:
    'postgresql://nihongo_production_app_login:unit-only@postgres:5432/nihongo?schema=public&sslmode=require',
  TAG_LIST_FILE
})
const confirm = { TAG_LOAD_CONFIRM: 'LOAD_TAG_LIST' }
const existing = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'grammar.sample',
  label: '예시 문법',
  normalizedName: '예시 문법',
  subject: 'GRAMMAR',
  status: 'ACTIVE',
  labelJa: null
}

let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>
let rows: unknown[]
const originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks()
  process.exitCode = undefined
  rows = [existing]
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  db.connect.mockResolvedValue(undefined)
  db.end.mockResolvedValue(undefined)
  db.query.mockImplementation(async (sql) =>
    sql.trimStart().startsWith('SELECT "id"')
      ? { rows }
      : { rows: [], rowCount: /^(INSERT|UPDATE)/u.test(sql) ? 1 : 0 }
  )
})
afterEach(() => {
  process.exitCode = originalExit
  vi.restoreAllMocks()
})
const line = (stream: MockInstance<typeof process.stdout.write>) =>
  JSON.parse(String(stream.mock.calls[0]?.[0])) as Record<string, unknown>
const statements = () => db.query.mock.calls.map(([sql]) => sql)
const writes = () => statements().filter((sql) => /^(INSERT|UPDATE)/u.test(sql))

describe('tag load operator CLI', () => {
  it('reports the plan without writing by default', async () => {
    await runTagLoadCommand(target())
    expect(process.exitCode).toBeUndefined()
    expect(line(stdout)).toEqual({
      event: 'tag_list_dry_run',
      environment: 'TEST',
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      tagCount: 3,
      created: 2,
      updated: 0,
      claimed: 0,
      unchanged: 1,
      notInFile: 0,
      unkeyed: 0,
      conflicts: []
    })
    expect(writes()).toEqual([])
    expect(statements().at(-1)).toBe('ROLLBACK')
  })

  it('writes as the table owner after the capability check', async () => {
    await runTagLoadCommand({ ...target(), ...confirm })
    expect(process.exitCode).toBeUndefined()
    expect(line(stdout)).toMatchObject({
      event: 'tag_list_loaded',
      created: 2,
      unchanged: 1,
      occurredAt: expect.any(String)
    })
    expect(stdout).toHaveBeenCalledTimes(1)
    const sql = statements()
    expect(sql.indexOf('SET LOCAL ROLE nihongo_owner')).toBeLessThan(
      sql.findIndex((value) => value.includes('require_database_capability'))
    )
    expect(db.query).toHaveBeenCalledWith(
      'SELECT "require_database_capability"($1::"AdminAuditEnvironment")',
      ['TEST']
    )
    expect(writes()).toHaveLength(2)
    expect(sql.at(-1)).toBe('COMMIT')
  })

  it('refuses to commit when a name belongs to another key', async () => {
    rows = [{ ...existing, key: 'grammar.other' }]
    await runTagLoadCommand({ ...target(), ...confirm })
    expect(process.exitCode).toBe(1)
    expect(line(stderr)).toMatchObject({
      event: 'tag_list_load_failed',
      conflicts: ['grammar.sample']
    })
    expect(writes()).toEqual([])
    expect(statements().at(-1)).toBe('ROLLBACK')
  })

  it('rolls back when a write does not touch one row', async () => {
    db.query.mockImplementation(async (sql) =>
      sql.trimStart().startsWith('SELECT "id"')
        ? { rows }
        : { rows: [], rowCount: 0 }
    )
    await runTagLoadCommand({ ...target(), ...confirm })
    expect(process.exitCode).toBe(1)
    expect(line(stderr)).toEqual({ event: 'tag_list_load_failed' })
    expect(statements()).not.toContain('COMMIT')
  })

  it.each([
    ['PRODUCTION', 'PRODUCTION'],
    ['STAGING', 'PRODUCTION']
  ])(
    'loads on a %s deployment as the %s environment',
    async (deployment, environment) => {
      await runTagLoadCommand({
        ...production(),
        DEPLOYMENT_ENVIRONMENT: deployment
      })
      expect(line(stdout)).toMatchObject({
        event: 'tag_list_dry_run',
        environment,
        created: 2
      })
      expect(writes()).toEqual([])
      expect(statements().at(-1)).toBe('ROLLBACK')

      vi.clearAllMocks()
      await runTagLoadCommand({
        ...production(),
        DEPLOYMENT_ENVIRONMENT: deployment,
        ...confirm
      })
      expect(process.exitCode).toBeUndefined()
      expect(line(stdout)).toMatchObject({
        event: 'tag_list_loaded',
        environment,
        created: 2
      })
      expect(db.query).toHaveBeenCalledWith(
        'SELECT "require_database_capability"($1::"AdminAuditEnvironment")',
        [environment]
      )
      expect(writes()).toHaveLength(2)
      expect(statements().at(-1)).toBe('COMMIT')
    }
  )

  it.each([
    ['a missing file setting', () => ({ ...target(), TAG_LIST_FILE: '' })],
    [
      'an unreadable file',
      () => ({ ...target(), TAG_LIST_FILE: `${TAG_LIST_FILE}.missing` })
    ],
    [
      'an unknown confirmation',
      () => ({ ...target(), TAG_LOAD_CONFIRM: 'YES' })
    ],
    [
      'a test target on a staging deployment',
      () => ({ ...target(), DEPLOYMENT_ENVIRONMENT: 'STAGING' })
    ],
    [
      'production without a deployment',
      () => ({ ...production(), DEPLOYMENT_ENVIRONMENT: undefined })
    ],
    [
      'production on a test deployment',
      () => ({ ...production(), DEPLOYMENT_ENVIRONMENT: 'TEST' })
    ],
    [
      'an unconfirmed load value on staging',
      () => ({
        ...production(),
        DEPLOYMENT_ENVIRONMENT: 'STAGING',
        TAG_LOAD_CONFIRM: 'YES'
      })
    ]
  ])('rejects %s before connecting', async (_label, input) => {
    await runTagLoadCommand({ ...confirm, ...input() })
    expect(process.exitCode).toBe(1)
    expect(line(stderr)).toEqual({ event: 'tag_list_load_failed' })
    expect(db.construct).not.toHaveBeenCalled()
  })
})
