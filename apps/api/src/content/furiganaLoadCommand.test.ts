import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { md5 } from './furiganaPassageList.js'
import { runFuriganaLoadCommand } from './furiganaLoadCommand.js'

const db = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  query:
    vi.fn<
      (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: unknown[]; rowCount?: number }>
    >(),
  end: vi.fn<() => Promise<void>>()
}))
vi.mock('pg', () => ({
  Client: class {
    connect = db.connect
    query = db.query
    end = db.end
  }
}))

const FURIGANA_LIST_FILE = join(
  mkdtempSync(join(tmpdir(), 'furigana-load-')),
  'reading-passages.v1.json'
)
writeFileSync(
  FURIGANA_LIST_FILE,
  JSON.stringify({
    schemaVersion: 1,
    generator: 'test',
    passages: [
      {
        level: 'N4',
        subject: 'READING',
        textMd5: md5('雨です。'),
        ruby: '{雨|あめ}です。',
        reviewedBy: 'content',
        reviewedAt: '2026-11-21'
      }
    ]
  })
)
const target = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  MIGRATION_DATABASE_URL:
    'postgresql://nihongo_test_migration_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_furigana_test&options=-c+role%3Dnihongo_migration',
  DATABASE_URL:
    'postgresql://nihongo_app:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_furigana_test',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:unit-only@production.invalid:5432/nihongo_production?schema=public',
  FURIGANA_LIST_FILE
})
const confirm = { FURIGANA_LOAD_CONFIRM: 'LOAD_FURIGANA' }
const passages = [
  {
    passageId: '00000000-0000-4000-8000-000000000001',
    level: 'N4',
    subject: 'READING',
    textMd5: md5('雨です。'),
    furiganaId: null,
    segments: null,
    reviewedBy: null,
    reviewedAt: null
  },
  {
    passageId: '00000000-0000-4000-8000-000000000002',
    level: 'N4',
    subject: 'READING',
    textMd5: md5('雪です。'),
    furiganaId: '00000000-0000-4000-8000-000000000003',
    segments: [{ start: 0, length: 1, reading: 'ゆき' }],
    reviewedBy: 'content',
    reviewedAt: '2026-11-20'
  }
]

let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>
let rowCount: number
const originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks()
  process.exitCode = undefined
  rowCount = 1
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  db.connect.mockResolvedValue(undefined)
  db.end.mockResolvedValue(undefined)
  db.query.mockImplementation(async (sql) =>
    sql.trimStart().startsWith('SELECT passage.')
      ? { rows: passages }
      : {
          rows: [],
          rowCount: /^(INSERT|UPDATE|DELETE)/u.test(sql) ? rowCount : 0
        }
  )
})
afterEach(() => {
  process.exitCode = originalExit
  vi.restoreAllMocks()
})
const line = (stream: MockInstance<typeof process.stdout.write>) =>
  JSON.parse(String(stream.mock.calls[0]?.[0])) as Record<string, unknown>
const statements = () => db.query.mock.calls.map(([sql]) => sql)
const writes = () =>
  statements().filter((sql) => /^(INSERT|UPDATE|DELETE)/u.test(sql))

describe('furigana load operator CLI (#1182)', () => {
  it('reports the plan without writing by default', async () => {
    await runFuriganaLoadCommand(target())
    expect(process.exitCode).toBeUndefined()
    expect(line(stdout)).toEqual({
      event: 'furigana_list_dry_run',
      environment: 'TEST',
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      passageCount: 1,
      reviewed: 1,
      missingPassage: 0,
      created: 1,
      updated: 0,
      deleted: 1,
      unchanged: 0
    })
    expect(writes()).toEqual([])
    expect(statements().at(-1)).toBe('ROLLBACK')
  })

  it('writes as the table owner after the capability check and commits', async () => {
    await runFuriganaLoadCommand({ ...target(), ...confirm })
    expect(process.exitCode).toBeUndefined()
    expect(line(stdout)).toMatchObject({
      event: 'furigana_list_loaded',
      created: 1,
      deleted: 1,
      occurredAt: expect.any(String)
    })
    const sql = statements()
    expect(sql.indexOf('SET LOCAL ROLE nihongo_owner')).toBeLessThan(
      sql.findIndex((value) => value.includes('require_database_capability'))
    )
    expect(writes()).toHaveLength(2)
    expect(writes()[0]).toMatch(/^DELETE/u)
    expect(sql.at(-1)).toBe('COMMIT')
  })

  it('rolls back when a write does not touch one row', async () => {
    rowCount = 0
    await runFuriganaLoadCommand({ ...target(), ...confirm })
    expect(process.exitCode).toBe(1)
    expect(line(stderr)).toEqual({ event: 'furigana_list_load_failed' })
    expect(statements()).not.toContain('COMMIT')
  })

  it('refuses an invalid file before connecting', async () => {
    await runFuriganaLoadCommand({
      ...target(),
      FURIGANA_LIST_FILE: fileURLToPath(import.meta.url)
    })
    expect(process.exitCode).toBe(1)
    expect(line(stderr)).toEqual({ event: 'furigana_list_load_failed' })
    expect(db.connect).not.toHaveBeenCalled()
  })
})
