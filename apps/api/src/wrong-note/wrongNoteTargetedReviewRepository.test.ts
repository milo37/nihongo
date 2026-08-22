import { randomUUID } from 'node:crypto'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrismaWrongNoteTargetedReviewRepository,
  hashTargetedReviewCommand,
  WrongNoteTargetedReviewRepositoryUnavailableError,
  type CreateTargetedReviewAtomicInput
} from './wrongNoteTargetedReviewRepository.js'

const input: CreateTargetedReviewAtomicInput = {
  idempotencyKey: randomUUID(),
  observedAt: new Date('2026-08-22T12:00:00.000Z'),
  questionId: reviewCenterConformanceFixture.targetedQuestionId,
  userId: randomUUID()
}

const created = {
  replayed: false,
  response: reviewCenterConformanceFixture.targetedSession
}

describe('wrong-note targeted review repository', () => {
  it('canonical question path material의 lowercase SHA-256을 고정한다', () => {
    expect(hashTargetedReviewCommand(input.questionId)).toBe(
      reviewCenterConformanceFixture.targetedSha256
    )
    expect(hashTargetedReviewCommand(randomUUID())).not.toBe(
      reviewCenterConformanceFixture.targetedSha256
    )
  })

  it.each([
    new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: '7.9.1'
    }),
    new Prisma.PrismaClientKnownRequestError('Code: `40001`', {
      code: 'P2010',
      clientVersion: '7.9.1',
      meta: { code: '40001' }
    }),
    new Prisma.PrismaClientKnownRequestError('Code: `40P01`', {
      code: 'P2010',
      clientVersion: '7.9.1',
      meta: { code: '40P01' }
    })
  ])('Serializable conflict를 bounded jitter 뒤 재시도한다', async (error) => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(created)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaWrongNoteTargetedReviewRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 2 }
    )

    await expect(repository.createAtomic(input)).resolves.toBe(created)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(retryDelay).toHaveBeenCalledWith(7)
  })

  it('세 번 충돌하면 retryable unavailable로 닫는다', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: '7.9.1' }
    )
    const transaction = vi.fn().mockRejectedValue(conflict)
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaWrongNoteTargetedReviewRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      { delay: retryDelay, jitterMilliseconds: () => 0 }
    )

    await expect(repository.createAtomic(input)).rejects.toBeInstanceOf(
      WrongNoteTargetedReviewRepositoryUnavailableError
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(retryDelay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
      [5, 10]
    )
  })
})
