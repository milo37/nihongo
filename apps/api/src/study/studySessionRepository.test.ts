import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrismaStudySessionRepository,
  StudySessionRepositoryUnavailableError
} from './studySessionRepository.js'

const input = {
  expiresAt: new Date('2026-08-15T00:00:00.000Z'),
  level: 'N5' as const,
  owner: { kind: 'USER' as const, userId: crypto.randomUUID() },
  requestedCount: 1,
  startedAt: new Date('2026-08-14T00:00:00.000Z'),
  subject: 'VOCABULARY' as const
}

const created = {
  issuedGuestCredential: null,
  session: {
    actualCount: 1,
    durationSec: null,
    expiresAt: input.expiresAt,
    fallbackReason: null,
    guestPrincipalId: null,
    id: crypto.randomUUID(),
    level: input.level,
    mode: 'RANDOM' as const,
    questions: [],
    requestedCount: 1,
    startedAt: input.startedAt,
    status: 'IN_PROGRESS' as const,
    subject: input.subject,
    submittedAt: null,
    usedFallback: false,
    userId: input.owner.userId
  }
}

describe('createPrismaStudySessionRepository', () => {
  const conflict = new Prisma.PrismaClientKnownRequestError(
    'serialization conflict',
    { code: 'P2034', clientVersion: '7.9.1' }
  )

  it('일시 P2034를 short jitter 뒤 재시도해 성공한다', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(created)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaStudySessionRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 3 }
    )

    await expect(repository.createRandom(input)).resolves.toBe(created)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(retryDelay).toHaveBeenCalledOnce()
    expect(retryDelay).toHaveBeenCalledWith(8)
  })

  it('P2034 retry delay를 attempt별 short jitter 범위로 제한한다', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(created)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const jitterMilliseconds = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
    const repository = createPrismaStudySessionRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds }
    )

    await expect(repository.createRandom(input)).resolves.toBe(created)
    expect(retryDelay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
      [5, 15]
    )
  })

  it('P2034 serialization conflict를 총 세 번 시도한 뒤 unavailable로 닫는다', async () => {
    const transaction = vi.fn().mockRejectedValue(conflict)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaStudySessionRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 0 }
    )

    await expect(repository.createRandom(input)).rejects.toBeInstanceOf(
      StudySessionRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(retryDelay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
      [5, 10]
    )
  })

  it('non-P2034 Prisma 오류는 지연이나 재시도 없이 전파한다', async () => {
    const nonRetryable = new Prisma.PrismaClientKnownRequestError(
      'unique conflict',
      { code: 'P2002', clientVersion: '7.9.1' }
    )
    const transaction = vi.fn().mockRejectedValue(nonRetryable)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaStudySessionRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 0 }
    )

    await expect(repository.createRandom(input)).rejects.toBe(nonRetryable)
    expect(transaction).toHaveBeenCalledOnce()
    expect(retryDelay).not.toHaveBeenCalled()
  })
})
