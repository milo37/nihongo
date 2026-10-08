import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaWrongNoteReviewCenterRepository } from './wrongNoteReviewCenterRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const WRONG_NOTE_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1'
const MEMO_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10e1'
const CREATED_AT = new Date('2026-08-22T01:00:00.000Z')
const OBSERVED_AT = new Date('2026-08-22T03:00:00.000Z')

const createClient = () => {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn(),
    userMemo: {
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn()
    }
  }
  const client = {
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction)
    )
  }

  return {
    client: client as unknown as PrismaClient,
    transaction
  }
}

describe('Prisma WrongNote review-center repository', () => {
  it('parent note lock 뒤 fresh memo statement를 실행해 create timestamp를 동결한다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          wrongNoteId: WRONG_NOTE_ID,
          questionId: QUESTION_ID,
          observedAt: OBSERVED_AT
        }
      ])
      .mockResolvedValueOnce([])
    transaction.userMemo.create.mockResolvedValue({
      id: MEMO_ID,
      text: 'memo',
      createdAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT
    })
    const afterOwnedWrongNoteLocked = vi.fn().mockResolvedValue(undefined)
    const repository = createPrismaWrongNoteReviewCenterRepository(client, {
      afterOwnedWrongNoteLocked,
      createId: () => MEMO_ID
    })

    await expect(
      repository.updateOwnedMemo({
        userId: USER_ID,
        questionId: QUESTION_ID,
        memo: 'memo'
      })
    ).resolves.toEqual({
      found: true,
      memo: {
        questionId: QUESTION_ID,
        text: 'memo',
        createdAt: OBSERVED_AT,
        updatedAt: OBSERVED_AT
      }
    })

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2)
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      afterOwnedWrongNoteLocked.mock.invocationCallOrder[0]!
    )
    expect(afterOwnedWrongNoteLocked.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[1]!
    )
    expect(transaction.userMemo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: MEMO_ID,
          wrongNoteId: WRONG_NOTE_ID,
          createdAt: OBSERVED_AT,
          updatedAt: OBSERVED_AT
        })
      })
    )
  })

  it('same-value는 write 0이고 delete는 locked row만 제거한다', async () => {
    const { client, transaction } = createClient()
    const existing = {
      memoId: MEMO_ID,
      text: 'same',
      createdAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT
    }
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          wrongNoteId: WRONG_NOTE_ID,
          questionId: QUESTION_ID,
          observedAt: new Date('2026-08-22T04:00:00.000Z')
        }
      ])
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([
        {
          wrongNoteId: WRONG_NOTE_ID,
          questionId: QUESTION_ID,
          observedAt: new Date('2026-08-22T05:00:00.000Z')
        }
      ])
      .mockResolvedValueOnce([existing])
    transaction.userMemo.delete.mockResolvedValue(existing)
    const repository = createPrismaWrongNoteReviewCenterRepository(client)

    await expect(
      repository.updateOwnedMemo({
        userId: USER_ID,
        questionId: QUESTION_ID,
        memo: 'same'
      })
    ).resolves.toMatchObject({
      found: true,
      memo: { text: 'same', updatedAt: OBSERVED_AT }
    })
    expect(transaction.userMemo.create).not.toHaveBeenCalled()
    expect(transaction.userMemo.update).not.toHaveBeenCalled()

    await expect(
      repository.updateOwnedMemo({
        userId: USER_ID,
        questionId: QUESTION_ID,
        memo: null
      })
    ).resolves.toEqual({ found: true, memo: null })
    expect(transaction.userMemo.delete).toHaveBeenCalledWith({
      where: { id: MEMO_ID }
    })
  })

  it('different-value updatedAt은 observed/existing clock의 최댓값으로 고정한다', async () => {
    const earlier = new Date('2026-08-22T02:00:00.000Z')
    const later = new Date('2026-08-22T04:00:00.000Z')

    for (const [observedAt, existingUpdatedAt] of [
      [earlier, later],
      [later, earlier]
    ] as const) {
      const { client, transaction } = createClient()
      transaction.$queryRaw
        .mockResolvedValueOnce([
          {
            wrongNoteId: WRONG_NOTE_ID,
            questionId: QUESTION_ID,
            observedAt
          }
        ])
        .mockResolvedValueOnce([
          {
            memoId: MEMO_ID,
            text: 'before',
            createdAt: CREATED_AT,
            updatedAt: existingUpdatedAt
          }
        ])
      transaction.userMemo.update.mockResolvedValue({
        id: MEMO_ID,
        text: 'after',
        createdAt: CREATED_AT,
        updatedAt: later
      })
      const repository = createPrismaWrongNoteReviewCenterRepository(client)

      await expect(
        repository.updateOwnedMemo({
          userId: USER_ID,
          questionId: QUESTION_ID,
          memo: 'after'
        })
      ).resolves.toMatchObject({
        found: true,
        memo: { text: 'after', createdAt: CREATED_AT, updatedAt: later }
      })
      expect(transaction.userMemo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MEMO_ID },
          data: { text: 'after', updatedAt: later }
        })
      )
      expect(vi.mocked(client.$transaction)).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'ReadCommitted' }
      )
    }
  })

  it('history는 read-only snapshot에서 owner note를 먼저 derive한다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([
        { wrongNoteId: WRONG_NOTE_ID, questionId: QUESTION_ID }
      ])
      .mockResolvedValueOnce([])
    const repository = createPrismaWrongNoteReviewCenterRepository(client)

    await expect(
      repository.listOwnedReviewEvents({
        userId: USER_ID,
        questionId: QUESTION_ID,
        cursor: null,
        limit: 21
      })
    ).resolves.toEqual({ found: true, items: [] })

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
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2)
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.$queryRaw.mock.invocationCallOrder[1]!
    )
  })
})
