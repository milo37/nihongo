import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  verifyRole: vi.fn()
}))

vi.mock('../db/database.js', () => ({
  createRoleDatabaseRuntime: mocks.createDatabase
}))
vi.mock('./studyGuestCleanupRole.js', () => ({
  verifyStudyGuestCleanupRole: mocks.verifyRole
}))

import { runStudyGuestCleanupCommand } from './studyGuestCleanupCommand.js'

const source = {
  GUEST_CLEANUP_DATABASE_URL:
    'postgresql://worker@localhost/nihongo_test?schema=test',
  GUEST_CLEANUP_ENVIRONMENT: 'TEST'
}

const setupDatabase = (result: {
  deletedCount: bigint
  eligibleCount: bigint
  hasMore: boolean
}) => {
  const query = vi.fn().mockResolvedValue([result])
  const disconnect = vi.fn().mockResolvedValue(undefined)
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback({ $queryRaw: query })
  )
  mocks.createDatabase.mockReturnValue({
    client: { $transaction: transaction },
    disconnect
  })
  mocks.verifyRole.mockResolvedValue(undefined)
  return { query, disconnect }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('guest cleanup command', () => {
  it('uses the guarded preview without printing database credentials', async () => {
    const { query, disconnect } = setupDatabase({
      deletedCount: 0n,
      eligibleCount: 3n,
      hasMore: true
    })
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await expect(runStudyGuestCleanupCommand(source)).resolves.toBe(0)
    expect(mocks.createDatabase).toHaveBeenCalledWith(
      source.GUEST_CLEANUP_DATABASE_URL,
      'nihongo_guest_cleanup_worker'
    )
    expect(mocks.verifyRole).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.at(-1)).toBe(true)
    expect(String(output.mock.calls[0]?.[0])).not.toContain(
      source.GUEST_CLEANUP_DATABASE_URL
    )
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('stops before a batch if role verification fails', async () => {
    const { query, disconnect } = setupDatabase({
      deletedCount: 0n,
      eligibleCount: 0n,
      hasMore: false
    })
    mocks.verifyRole.mockRejectedValue(new Error('restricted details'))
    const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(runStudyGuestCleanupCommand(source)).resolves.toBe(1)
    expect(query).not.toHaveBeenCalled()
    expect(String(error.mock.calls[0]?.[0])).not.toContain('restricted details')
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
