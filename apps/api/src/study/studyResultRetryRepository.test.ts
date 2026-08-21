import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrismaStudyResultRetryRepository,
  hashStudyResultRetryCommand,
  StudyResultRetryRepositoryUnavailableError,
  type CreateResultRetryAtomicInput
} from './studyResultRetryRepository.js'

const input: CreateResultRetryAtomicInput = {
  idempotencyKey: randomUUID(),
  observedAt: new Date('2026-08-21T15:00:00.000Z'),
  owner: { kind: 'USER', userId: randomUUID() },
  sourceSessionId: randomUUID()
}

const created = {
  replayed: false,
  response: {
    session: {
      id: randomUUID(),
      level: 'N5' as const,
      subject: 'VOCABULARY' as const,
      mode: 'WRONG_NOTE' as const,
      status: 'IN_PROGRESS' as const,
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null,
      startedAt: '2026-08-21T15:00:00.000Z',
      expiresAt: '2026-08-22T15:00:00.000Z',
      submittedAt: null,
      durationSec: null,
      practiceContractVersion: 2 as const
    },
    questions: []
  }
}

describe('study result retry repository', () => {
  it('source와 command version을 묶은 고정 hash를 만들고 다른 source를 구분한다', () => {
    expect(hashStudyResultRetryCommand(input.sourceSessionId)).toMatch(
      /^[0-9a-f]{64}$/u
    )
    expect(hashStudyResultRetryCommand(input.sourceSessionId)).toBe(
      hashStudyResultRetryCommand(input.sourceSessionId)
    )
    expect(hashStudyResultRetryCommand(randomUUID())).not.toBe(
      hashStudyResultRetryCommand(input.sourceSessionId)
    )
  })

  it.each([
    new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: '7.9.1'
    }),
    new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `40P01`',
      {
        code: 'P2010',
        clientVersion: '7.9.1',
        meta: { code: '40P01' }
      }
    )
  ])('Serializable conflict를 bounded jitter 뒤 재시도한다', async (error) => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(created)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaStudyResultRetryRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 2 }
    )

    await expect(repository.createAtomic(input)).resolves.toBe(created)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(retryDelay).toHaveBeenCalledWith(7)
  })

  it('세 번 충돌하면 retryable repository unavailable로 닫는다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: '7.9.1' }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaStudyResultRetryRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 0 }
    )

    await expect(repository.createAtomic(input)).rejects.toBeInstanceOf(
      StudyResultRetryRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(retryDelay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
      [5, 10]
    )
  })
})
