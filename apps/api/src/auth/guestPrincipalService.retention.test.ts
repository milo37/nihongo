import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createGuestPrincipalService } from './guestPrincipalService.js'

const now = new Date('2026-10-30T00:00:00.000Z')
const dayMs = 24 * 60 * 60 * 1_000

afterEach(() => vi.useRealTimers())

describe('guest principal retention', () => {
  it('does not delete an expired principal while resolving its credential', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const findUnique = vi.fn()
    const deleteMany = vi.fn()
    const client = {
      guestPrincipal: { findUnique, deleteMany }
    } as unknown as PrismaClient
    const service = createGuestPrincipalService({
      client,
      secret: 'test-secret'
    })
    const prepared = service.prepareCredential()
    findUnique.mockResolvedValue({
      ...prepared,
      expiresAt: new Date(now.getTime() - 1)
    })

    await expect(
      service.resolveExisting(prepared.cookieValue)
    ).resolves.toBeNull()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('selects and rechecks unreferenced principals at the seven-day cutoff', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const findMany = vi.fn().mockResolvedValue([{ id: 'expired' }])
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const client = {
      guestPrincipal: { findMany, deleteMany }
    } as unknown as PrismaClient
    const service = createGuestPrincipalService({
      client,
      secret: 'test-secret'
    })
    const threshold = new Date(now.getTime() - 7 * dayMs)

    await expect(service.deleteExpired(1)).resolves.toBe(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { lte: threshold }, studySessions: { none: {} } },
        take: 1
      })
    )
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: threshold },
        id: { in: ['expired'] },
        studySessions: { none: {} }
      }
    })
  })
})
