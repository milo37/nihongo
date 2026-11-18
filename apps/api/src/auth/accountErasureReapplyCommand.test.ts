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
  parseReapplyUserIds,
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
const ids = async () => `${first}\n\n ${second} \r\n`

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
  it('reads one id per line and rejects anything else', () => {
    expect(parseReapplyUserIds(`${first}\n${second}\n`)).toEqual([
      first,
      second
    ])
    expect(() => parseReapplyUserIds(`${first}\nnot-an-id\n`)).toThrow()
  })

  it('only reports without the confirmation', async () => {
    await expect(runAccountErasureReapplyCommand(input(), ids)).resolves.toBe(0)
    expect(reapply).toHaveBeenCalledWith({}, [first, second], 'TEST', false)
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
    expect(reapply).toHaveBeenCalledWith({}, [first, second], 'TEST', true)
    expect(lines()).toEqual([
      {
        event: 'auth.account_erasure.requested',
        userId: first,
        occurredAt: expect.any(String),
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
