import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrismaStudySubmissionRepository,
  FreshTransactionRetry,
  StudySubmissionRepositoryUnavailableError,
  type SubmitStudySessionAtomicInput
} from './studySubmissionRepository.js'

const input: SubmitStudySessionAtomicInput = {
  sessionId: randomUUID(),
  owner: { kind: 'USER', userId: randomUUID() },
  idempotencyKey: randomUUID(),
  requestHash: 'a'.repeat(64),
  answers: [
    {
      studySessionQuestionId: randomUUID(),
      selectedOptionId: null,
      elapsedSec: 1
    }
  ],
  durationSec: 1,
  observedAt: new Date('2026-08-15T01:00:00.000Z')
}

const createRepository = (transaction: ReturnType<typeof vi.fn>) => {
  const retryDelay = vi.fn().mockResolvedValue(undefined)
  const repository = createPrismaStudySubmissionRepository(
    { $transaction: transaction } as unknown as PrismaClient,
    { delay: retryDelay, jitterMilliseconds: () => 0 }
  )
  return { repository, retryDelay }
}

describe('study submission repository retry policy', () => {
  it('same-key loser fresh snapshot retry를 세 번 소진하면 retryable unavailable로 닫는다', async () => {
    const transaction = vi.fn().mockRejectedValue(new FreshTransactionRetry())
    const { repository, retryDelay } = createRepository(transaction)

    await expect(repository.submitAtomic(input)).rejects.toBeInstanceOf(
      StudySubmissionRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(retryDelay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
      [5, 10]
    )
  })

  it('P2034를 세 번 소진하면 unavailable로 닫는다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: '7.9.1' }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const { repository } = createRepository(transaction)

    await expect(repository.submitAtomic(input)).rejects.toBeInstanceOf(
      StudySubmissionRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
  })

  it('raw reservation의 PostgreSQL 40001도 Serializable conflict로 재시도한다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'raw serialization conflict',
      {
        code: 'P2010',
        clientVersion: '7.9.1',
        meta: {
          code: '40001',
          message: 'could not serialize access due to concurrent update'
        }
      }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const { repository } = createRepository(transaction)

    await expect(repository.submitAtomic(input)).rejects.toBeInstanceOf(
      StudySubmissionRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
  })

  it('정확한 WrongNote user/question P2002만 fresh transaction으로 재시도한다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'wrong note unique conflict',
      {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: {
          modelName: 'WrongNote',
          target: ['userId', 'questionId']
        }
      }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const { repository } = createRepository(transaction)

    await expect(repository.submitAtomic(input)).rejects.toBeInstanceOf(
      StudySubmissionRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
  })

  it('다른 P2002는 지연이나 재시도 없이 그대로 전파한다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'other unique conflict',
      {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { modelName: 'StudyAnswer', target: ['id'] }
      }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const { repository, retryDelay } = createRepository(transaction)

    await expect(repository.submitAtomic(input)).rejects.toBe(conflict)
    expect(transaction).toHaveBeenCalledOnce()
    expect(retryDelay).not.toHaveBeenCalled()
  })
})
