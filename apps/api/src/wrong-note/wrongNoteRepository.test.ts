import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaWrongNoteRepository } from './wrongNoteRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'

const createClient = (total: number) => {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    wrongNote: {
      count: vi.fn().mockResolvedValue(total),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([])
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

describe('Prisma WrongNote repository pagination', () => {
  it('count를 먼저 읽고 MAX_SAFE beyond-last page에는 items query를 생략한다', async () => {
    const { client, transaction } = createClient(1)
    const repository = createPrismaWrongNoteRepository(client)

    await expect(
      repository.listOwned({
        userId: USER_ID,
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 100,
        sort: 'RECENT'
      })
    ).resolves.toEqual({
      items: [],
      total: 1,
      availableTagLabels: []
    })

    expect(transaction.wrongNote.count).toHaveBeenCalledOnce()
    expect(transaction.wrongNote.findMany).not.toHaveBeenCalled()
  })

  it('total 안의 정상 page에만 safe Number offset으로 items를 조회한다', async () => {
    const { client, transaction } = createClient(1)
    const repository = createPrismaWrongNoteRepository(client)

    await repository.listOwned({
      userId: USER_ID,
      page: 1,
      pageSize: 20,
      sort: 'RECENT'
    })

    expect(transaction.wrongNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    )
    expect(
      transaction.wrongNote.count.mock.invocationCallOrder[0]
    ).toBeLessThan(transaction.wrongNote.findMany.mock.invocationCallOrder[0]!)
  })
})
