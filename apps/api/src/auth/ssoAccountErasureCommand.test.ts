import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

const database = vi.hoisted(() => ({
  create: vi.fn(),
  disconnect: vi.fn<() => Promise<void>>()
}))
const erasure = vi.hoisted(() => ({
  createWorker: vi.fn(),
  requestInactive: vi.fn(),
  runBatch: vi.fn(),
  runRevoke: vi.fn()
}))
const worker = { requestInactive: erasure.requestInactive }
const noInactiveWork = {
  requestedUserIds: [],
  failedUserIds: [],
  limitReached: false
}
const noProviderWork = {
  revoked: 0,
  notHeld: 0,
  failed: 0,
  unavailable: 0,
  deferred: 0,
  claimLimitReached: false
}

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
vi.mock('./ssoProviderRevoke.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./ssoProviderRevoke.js')>()
  return { ...original, runSsoProviderRevokeBatch: erasure.runRevoke }
})

import {
  parseSsoAccountErasureCommandInput,
  runSsoAccountErasureCommand
} from './ssoAccountErasureCommand.js'
import { tokenlessSsoProviderRevokeAdapter } from './ssoProviderRevoke.js'

const id = '11111111-1111-4111-8111-111111111111'
const input = (
  environment: 'TEST' | 'DEVELOPMENT' | 'PRODUCTION' = 'TEST'
): NodeJS.ProcessEnv => {
  if (environment === 'PRODUCTION')
    return {
      DATABASE_URL:
        'postgresql://worker:secret@db.internal:5432/nihongo?schema=app',
      PRODUCTION_DATABASE_URL:
        'postgresql://runtime:secret@db.internal:5432/nihongo?schema=app',
      ACCOUNT_ERASURE_ENVIRONMENT: environment,
      ACCOUNT_ERASURE_CONFIRM: 'ERASE_DELETION_PENDING_ACCOUNTS'
    }
  const suffix = environment === 'TEST' ? 'test' : 'dev'
  return {
    DATABASE_URL: `postgresql://worker:secret@127.0.0.1:5432/nihongo_${suffix}?schema=app`,
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
  erasure.createWorker.mockReturnValue(worker)
  erasure.requestInactive.mockResolvedValue(noInactiveWork)
  erasure.runRevoke.mockResolvedValue(noProviderWork)
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
        databaseUrl: input(environment).DATABASE_URL,
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
        DATABASE_URL: input('PRODUCTION').DATABASE_URL + '&host=other.internal'
      })
    ],
    [
      'implicit database names',
      () => ({
        ...input('PRODUCTION'),
        DATABASE_URL: 'postgresql://worker:secret@db.internal:5432?schema=app',
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@db.internal:5432?schema=app'
      })
    ]
  ] as const)('rejects production %s before connecting', (_label, source) => {
    expect(() => parseSsoAccountErasureCommandInput(source())).toThrow()
    expect(database.create).not.toHaveBeenCalled()
  })

  it('runs PRODUCTION with the tokenless adapter by default (#670)', async () => {
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [id],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(
      runSsoAccountErasureCommand(input('PRODUCTION'))
    ).resolves.toBe(0)
    expect(erasure.runRevoke).toHaveBeenCalledWith(
      worker,
      tokenlessSsoProviderRevokeAdapter,
      'PRODUCTION',
      20,
      300
    )
    expect(erasure.runBatch).toHaveBeenCalledWith(worker, 'PRODUCTION', 20)
    expect(stderr).not.toHaveBeenCalled()
  })

  it('runs on a STAGING host as PRODUCTION, like its database capability (#670)', async () => {
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [id],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(
      runSsoAccountErasureCommand({
        ...input('PRODUCTION'),
        DEPLOYMENT_ENVIRONMENT: 'STAGING'
      })
    ).resolves.toBe(0)
    expect(erasure.runBatch).toHaveBeenCalledWith(worker, 'PRODUCTION', 20)
  })

  it('passes PRODUCTION and the injected adapter to the worker and returns zero only with no unfinished request', async () => {
    const revoke = vi.fn()
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [id],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(
      runSsoAccountErasureCommand(input('PRODUCTION'), revoke)
    ).resolves.toBe(0)
    expect(database.create).toHaveBeenCalledWith(
      input('PRODUCTION').DATABASE_URL,
      'nihongo_app'
    )
    expect(erasure.runRevoke).toHaveBeenCalledWith(
      worker,
      revoke,
      'PRODUCTION',
      20,
      300
    )
    expect(erasure.runBatch).toHaveBeenCalledWith(worker, 'PRODUCTION', 20)
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

  it.each([
    { ...noProviderWork, failed: 1 },
    { ...noProviderWork, unavailable: 1 },
    { ...noProviderWork, deferred: 1 },
    { ...noProviderWork, claimLimitReached: true }
  ])('returns one for unfinished provider revoke work', async (providers) => {
    erasure.runRevoke.mockResolvedValueOnce(providers)
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(runSsoAccountErasureCommand(input())).resolves.toBe(1)
    expect(stdout).toHaveBeenCalledOnce()
  })

  it('JLP-852: requests the erasure of inactive members first and logs each one', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    erasure.requestInactive.mockResolvedValueOnce({
      requestedUserIds: [id, other],
      failedUserIds: [],
      limitReached: false
    })
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(runSsoAccountErasureCommand(input())).resolves.toBe(0)
    expect(erasure.requestInactive).toHaveBeenCalledWith(20, 'TEST')
    expect(erasure.requestInactive.mock.invocationCallOrder[0]).toBeLessThan(
      erasure.runRevoke.mock.invocationCallOrder[0]!
    )
    const lines = stdout.mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(lines).toEqual([
      {
        event: 'auth.account_erasure.requested',
        userId: id,
        occurredAt: expect.any(String),
        reason: 'INACTIVE'
      },
      {
        event: 'auth.account_erasure.requested',
        userId: other,
        occurredAt: expect.any(String),
        reason: 'INACTIVE'
      },
      expect.objectContaining({
        event: 'auth.account_erasure.ran',
        inactive: { requested: 2, failed: 0, limitReached: false }
      })
    ])
  })

  it.each([
    { ...noInactiveWork, failedUserIds: [id] },
    { ...noInactiveWork, limitReached: true }
  ])('JLP-852: returns one for unfinished inactive work', async (inactive) => {
    erasure.requestInactive.mockResolvedValueOnce(inactive)
    erasure.runBatch.mockResolvedValueOnce({
      completedIds: [],
      providerCleanupPendingIds: [],
      failedIds: [],
      batchLimitReached: false
    })
    await expect(runSsoAccountErasureCommand(input())).resolves.toBe(1)
  })

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
