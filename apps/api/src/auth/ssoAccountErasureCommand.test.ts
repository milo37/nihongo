import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

const database = vi.hoisted(() => ({
  create: vi.fn(),
  disconnect: vi.fn<() => Promise<void>>()
}))
const erasure = vi.hoisted(() => ({
  createWorker: vi.fn(),
  runBatch: vi.fn()
}))

vi.mock('../db/database.js', () => ({
  createRoleDatabaseRuntime: database.create
}))
vi.mock('./ssoAccountRepository.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./ssoAccountRepository.js')>()
  return {
    ...original,
    createSsoAccountErasureWorker: erasure.createWorker,
    runSsoAccountErasureBatch: erasure.runBatch
  }
})

import {
  parseSsoAccountErasureCommandInput,
  runSsoAccountErasureCommand
} from './ssoAccountErasureCommand.js'

const id = '11111111-1111-4111-8111-111111111111'
const input = (
  environment: 'TEST' | 'DEVELOPMENT' | 'PRODUCTION' = 'TEST'
): NodeJS.ProcessEnv => {
  if (environment === 'PRODUCTION')
    return {
      ERASURE_WORKER_DATABASE_URL:
        'postgresql://worker:secret@db.internal:5432/nihongo?schema=app',
      PRODUCTION_DATABASE_URL:
        'postgresql://runtime:secret@db.internal:5432/nihongo?schema=app',
      ACCOUNT_ERASURE_ENVIRONMENT: environment,
      ACCOUNT_ERASURE_CONFIRM: 'ERASE_DELETION_PENDING_ACCOUNTS'
    }
  const suffix = environment === 'TEST' ? 'test' : 'dev'
  return {
    ERASURE_WORKER_DATABASE_URL: `postgresql://worker:secret@127.0.0.1:5432/nihongo_${suffix}?schema=app`,
    PRODUCTION_DATABASE_URL:
      'postgresql://runtime:secret@production.invalid:5432/nihongo?schema=app',
    ACCOUNT_ERASURE_ENVIRONMENT: environment,
    ACCOUNT_ERASURE_CONFIRM: 'ERASE_DELETION_PENDING_ACCOUNTS'
  }
}

let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>

beforeEach(() => {
  vi.resetAllMocks()
  database.disconnect.mockResolvedValue(undefined)
  database.create.mockReturnValue({
    client: {},
    disconnect: database.disconnect
  })
  erasure.createWorker.mockReturnValue({})
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SSO account erasure one-shot command', () => {
  it.each(['TEST', 'DEVELOPMENT', 'PRODUCTION'] as const)(
    'accepts a guarded %s target and bounded defaults',
    (environment) => {
      expect(parseSsoAccountErasureCommandInput(input(environment))).toEqual({
        databaseUrl: input(environment).ERASURE_WORKER_DATABASE_URL,
        productionDatabaseUrl: input(environment).PRODUCTION_DATABASE_URL,
        environment,
        batchSize: 20,
        confirmation: 'ERASE_DELETION_PENDING_ACCOUNTS'
      })
    }
  )

  it.each([
    [
      'missing proof',
      () => ({ ...input('PRODUCTION'), PRODUCTION_DATABASE_URL: undefined })
    ],
    [
      'different host',
      () => ({
        ...input('PRODUCTION'),
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@other.internal:5432/nihongo?schema=app'
      })
    ],
    [
      'different database',
      () => ({
        ...input('PRODUCTION'),
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@db.internal:5432/other?schema=app'
      })
    ],
    [
      'different schema',
      () => ({
        ...input('PRODUCTION'),
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@db.internal:5432/nihongo?schema=other'
      })
    ],
    [
      'connection override',
      () => ({
        ...input('PRODUCTION'),
        ERASURE_WORKER_DATABASE_URL:
          input('PRODUCTION').ERASURE_WORKER_DATABASE_URL +
          '&host=other.internal'
      })
    ],
    [
      'implicit database names',
      () => ({
        ...input('PRODUCTION'),
        ERASURE_WORKER_DATABASE_URL:
          'postgresql://worker:secret@db.internal:5432?schema=app',
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@db.internal:5432?schema=app'
      })
    ]
  ] as const)('rejects production %s before connecting', (_label, source) => {
    expect(() => parseSsoAccountErasureCommandInput(source())).toThrow()
    expect(database.create).not.toHaveBeenCalled()
  })

  it('passes PRODUCTION to the worker and returns zero only with no unfinished request', async () => {
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [id],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(
      runSsoAccountErasureCommand(input('PRODUCTION'))
    ).resolves.toBe(0)
    expect(database.create).toHaveBeenCalledWith(
      input('PRODUCTION').ERASURE_WORKER_DATABASE_URL,
      'nihongo_erasure_worker'
    )
    expect(erasure.runBatch).toHaveBeenCalledWith({}, 'PRODUCTION', 20)
    expect(database.disconnect).toHaveBeenCalledOnce()
    expect(stderr).not.toHaveBeenCalled()
  })

  it.each([
    {
      completedIds: [],
      providerCleanupPendingIds: [id],
      failedIds: [],
      batchLimitReached: false
    },
    {
      completedIds: [],
      providerCleanupPendingIds: [],
      failedIds: [id],
      batchLimitReached: false
    },
    {
      completedIds: [id],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: true
    }
  ])(
    'returns one for unfinished or possibly truncated work',
    async (result) => {
      erasure.runBatch.mockResolvedValueOnce(result)
      await expect(runSsoAccountErasureCommand(input())).resolves.toBe(1)
      expect(database.disconnect).toHaveBeenCalledOnce()
      expect(stdout).toHaveBeenCalledOnce()
      expect(stderr).not.toHaveBeenCalled()
    }
  )

  it('fails closed without exposing connection details', async () => {
    erasure.runBatch.mockRejectedValueOnce(new Error('secret connection'))
    await expect(runSsoAccountErasureCommand(input())).resolves.toBe(1)
    expect(database.disconnect).toHaveBeenCalledOnce()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      '{"event":"auth.account_erasure.failed"}\n'
    )
  })
})
