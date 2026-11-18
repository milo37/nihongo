import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

const database = vi.hoisted(() => ({
  create: vi.fn(),
  disconnect: vi.fn<() => Promise<void>>()
}))
const reapply = vi.hoisted(() => vi.fn())

vi.mock('../db/database.js', () => ({
  createRoleDatabaseRuntime: database.create
}))
vi.mock('./accountErasureAuthority.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./accountErasureAuthority.js')>()),
  reapplyAccountErasures: reapply
}))

import {
  parseReapplyEntries,
  runAccountErasureReapplyCommand
} from './accountErasureReapplyCommand.js'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const input = (confirm?: string): NodeJS.ProcessEnv => ({
  DATABASE_URL:
    'postgresql://worker:secret@127.0.0.1:5432/nihongo_test?schema=app',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:secret@production.invalid:5432/nihongo?schema=app',
  ACCOUNT_ERASURE_ENVIRONMENT: 'TEST',
  ...(confirm === undefined ? {} : { ACCOUNT_ERASURE_REAPPLY_CONFIRM: confirm })
})
// Within the 31 days the parser accepts, whatever day the test runs.
const firstAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
const secondAt = new Date(Date.now() - 9 * 86_400_000).toISOString()
const ids = async () => `${first} ${firstAt}\n\n ${second}\t${secondAt} \r\n`
const entries = [
  { userId: first, requestedAt: firstAt },
  { userId: second, requestedAt: secondAt }
]

let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>

beforeEach(() => {
  vi.resetAllMocks()
  database.create.mockReturnValue({
    client: {},
    disconnect: database.disconnect
  })
  database.disconnect.mockResolvedValue()
  reapply.mockResolvedValue({
    requestedUserIds: [first],
    skippedUserIds: [second],
    failedUserIds: []
  })
  stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

const lines = () =>
  stdout.mock.calls.map(([line]) => JSON.parse(String(line)) as object)

describe('#702 account erasure re-apply command', () => {
  it('reads one id and its original request time per line and rejects anything else', () => {
    const now = Date.parse('2026-11-19T00:00:00Z')
    expect(
      parseReapplyEntries(
        `${first} 2026-11-12T03:04:05.678Z\n${second} 2026-10-20T09:00:00+09:00\n`,
        now
      )
    ).toEqual([
      { userId: first, requestedAt: '2026-11-12T03:04:05.678Z' },
      { userId: second, requestedAt: '2026-10-20T00:00:00.000Z' }
    ])
    for (const bad of [
      first,
      `${first} not-a-time`,
      `not-an-id 2026-11-12T00:00:00Z`,
      `${first} 2026-11-12T00:00:00Z extra`,
      // A future time, and one older than 31 days.
      `${first} 2026-11-19T00:00:01Z`,
      `${first} 2026-10-18T23:59:59Z`
    ])
      expect(() =>
        parseReapplyEntries(`${second} 2026-11-12T00:00:00Z\n${bad}\n`, now)
      ).toThrow()
  })

  it('only reports without the confirmation', async () => {
    await expect(runAccountErasureReapplyCommand(input(), ids)).resolves.toBe(0)
    expect(reapply).toHaveBeenCalledWith({}, entries, 'TEST', false)
    expect(database.disconnect).toHaveBeenCalledOnce()
    expect(lines()).toEqual([
      {
        event: 'auth.account_erasure.reapply',
        dryRun: true,
        listed: 2,
        requested: 1,
        skipped: [second],
        failed: []
      }
    ])
  })

  it('applies with the confirmation and logs each request for a later restore', async () => {
    await expect(
      runAccountErasureReapplyCommand(input('REAPPLY_ACCOUNT_ERASURE'), ids)
    ).resolves.toBe(0)
    expect(reapply).toHaveBeenCalledWith({}, entries, 'TEST', true)
    expect(lines()).toEqual([
      {
        event: 'auth.account_erasure.requested',
        userId: first,
        // The original time, so a later restore keeps the same deadline.
        occurredAt: firstAt,
        reason: 'REAPPLY'
      },
      expect.objectContaining({ dryRun: false, requested: 1 })
    ])
  })

  it('exits 1 on a failed user, a wrong confirmation or a bad list', async () => {
    reapply.mockResolvedValueOnce({
      requestedUserIds: [],
      skippedUserIds: [],
      failedUserIds: [first]
    })
    await expect(runAccountErasureReapplyCommand(input(), ids)).resolves.toBe(1)
    for (const [env, read] of [
      [input('yes'), ids],
      [input(), async () => 'nope']
    ] as const)
      await expect(runAccountErasureReapplyCommand(env, read)).resolves.toBe(1)
    expect(reapply).toHaveBeenCalledOnce()
    expect(stderr).toHaveBeenCalledTimes(2)
  })
})
