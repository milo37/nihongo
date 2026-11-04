import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  getSerializableRetryDelayMs,
  SERIALIZABLE_MAX_ATTEMPTS,
  SERIALIZABLE_RETRY_JITTER_MAX_MS
} from './serializableRetryPolicy.js'
import {
  createPrismaStudySubmissionRepository,
  StudySubmissionRepositoryUnavailableError
} from './studySubmissionRepository.js'

const serializationConflict = () =>
  new Prisma.PrismaClientKnownRequestError('serialization conflict', {
    code: 'P2034',
    clientVersion: 'test'
  })

describe('Serializable retry policy', () => {
  it('allows five attempts with 10/20/40/80 ms backoff', () => {
    expect(SERIALIZABLE_MAX_ATTEMPTS).toBe(5)
    expect(
      [1, 2, 3, 4].map((attempt) => getSerializableRetryDelayMs(attempt, 0))
    ).toEqual([10, 20, 40, 80])
  })

  it('keeps the total wait under 200 ms with maximum jitter', () => {
    const total = [1, 2, 3, 4]
      .map((attempt) =>
        getSerializableRetryDelayMs(attempt, SERIALIZABLE_RETRY_JITTER_MAX_MS)
      )
      .reduce((sum, value) => sum + value, 0)
    expect(total).toBe(170)
  })

  it('makes submission try five times, then report unavailable', async () => {
    const transaction = vi.fn(async () => {
      throw serializationConflict()
    })
    const delays: number[] = []
    const repository = createPrismaStudySubmissionRepository(
      { $transaction: transaction } as unknown as PrismaClient,
      {
        delay: async (milliseconds) => {
          delays.push(milliseconds)
        },
        jitterMilliseconds: () => 0
      }
    )
    await expect(
      repository.submitAtomic({ practiceContractVersion: 2 } as never)
    ).rejects.toBeInstanceOf(StudySubmissionRepositoryUnavailableError)
    expect(transaction).toHaveBeenCalledTimes(5)
    expect(delays).toEqual([10, 20, 40, 80])
  })
})
