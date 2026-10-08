import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createPrismaWrongNoteReviewQueueRepository,
  WrongNoteReviewQueueRepositoryIntegrityError
} from './wrongNoteReviewQueueRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003'
const OBSERVED_AT = new Date('2026-08-22T12:00:00.000Z')

const query = {
  userId: USER_ID,
  observedAt: OBSERVED_AT,
  page: 1,
  pageSize: 20,
  view: 'DUE' as const,
  sort: 'NEXT_REVIEW' as const
}

const createClient = () => {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn()
  }
  const client = {
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction)
    )
  }
  return { client: client as unknown as PrismaClient, transaction }
}

describe('Prisma WrongNote review queue repository', () => {
  it('count·facet·items를 한 read-only RepeatableRead snapshot에서 읽는다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([{ observedAt: OBSERVED_AT }])
      .mockResolvedValueOnce([
        {
          due: 1n,
          unreviewed: 1n,
          repeated: 0n,
          solved: 0n,
          selectedTotal: 1n
        }
      ])
      .mockResolvedValueOnce([{ label: '한자 읽기' }])
      .mockResolvedValueOnce([
        {
          questionId: QUESTION_ID,
          currentQuestionVersionId: VERSION_ID,
          level: 'N5',
          subject: 'VOCABULARY',
          questionType: 'KANJI_READING',
          questionPreview: '「川」の読み方はどれですか。',
          tags: ['한자 읽기'],
          status: 'NEW',
          wrongCount: 1,
          correctStreak: 0,
          lastWrongAt: new Date('2026-08-21T12:00:00.000Z'),
          lastReviewedAt: null,
          nextReviewAt: OBSERVED_AT,
          hasMemo: false
        }
      ])
    const afterCountsLoaded = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaWrongNoteReviewQueueRepository(client, {
      afterCountsLoaded
    })

    await expect(repository.listOwned(query)).resolves.toMatchObject({
      total: 1,
      observedAt: OBSERVED_AT,
      counts: { due: 1, unreviewed: 1, repeated: 0, solved: 0 },
      availableTags: ['한자 읽기'],
      items: [
        {
          questionId: QUESTION_ID,
          currentQuestionVersionId: VERSION_ID,
          nextReviewAt: OBSERVED_AT
        }
      ]
    })
    expect(transaction.$executeRaw).toHaveBeenCalledOnce()
    expect(
      (transaction.$executeRaw.mock.calls[0]?.[0] as readonly string[]).join(
        ' '
      )
    ).toContain('SET TRANSACTION READ ONLY')
    expect(vi.mocked(client.$transaction)).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' }
    )
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(4)
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      afterCountsLoaded.mock.invocationCallOrder[0]!
    )
    expect(afterCountsLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[2]!
    )
  })

  it('offset이 total 이상이면 expensive items query를 생략한다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([{ observedAt: OBSERVED_AT }])
      .mockResolvedValueOnce([
        {
          due: 1n,
          unreviewed: 1n,
          repeated: 0n,
          solved: 0n,
          selectedTotal: 1n
        }
      ])
      .mockResolvedValueOnce([{ label: '한자 읽기' }])
    const repository = createPrismaWrongNoteReviewQueueRepository(client)

    await expect(
      repository.listOwned({ ...query, page: Number.MAX_SAFE_INTEGER })
    ).resolves.toMatchObject({ total: 1, items: [] })
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('PostgreSQL bigint count가 safe integer를 넘으면 fail closed한다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([{ observedAt: OBSERVED_AT }])
      .mockResolvedValueOnce([
        {
          due: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          unreviewed: 0n,
          repeated: 0n,
          solved: 0n,
          selectedTotal: 0n
        }
      ])
    const repository = createPrismaWrongNoteReviewQueueRepository(client)

    await expect(repository.listOwned(query)).rejects.toBeInstanceOf(
      WrongNoteReviewQueueRepositoryIntegrityError
    )
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2)
  })
})
