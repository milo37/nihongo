import { describe, expect, it, vi } from 'vitest'
import { createPrismaBookmarkRepository } from '../bookmark/bookmarkRepository.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'

const USER_ID = '00000000-0000-4000-8000-000000000001'

const captureQuestionListQuery = async (
  migrationProfile: 'current' | 'pre-phase7'
): Promise<unknown> => {
  const findMany = vi.fn().mockResolvedValue([])
  const client = {
    question: {
      count: vi.fn().mockResolvedValue(0),
      findMany
    }
  } as unknown as PrismaClient

  await createPrismaQuestionRepository(client, {
    migrationProfile
  }).listPublished({
    normalizedTag: 'grammar-choice',
    page: 1,
    pageSize: 20
  })

  return findMany.mock.calls[0]?.[0]
}

const captureBookmarkListQuery = async (
  migrationProfile: 'current' | 'pre-phase7'
): Promise<unknown> => {
  const findMany = vi.fn().mockResolvedValue([])
  const transaction = {
    bookmark: {
      count: vi.fn().mockResolvedValue(1),
      findMany
    }
  }
  const client = {
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        await operation(transaction)
    )
  } as unknown as PrismaClient

  await createPrismaBookmarkRepository(client, {
    migrationProfile
  }).listOwned({ page: 1, pageSize: 20, userId: USER_ID })

  return findMany.mock.calls[0]?.[0]
}

describe('pre-Phase-7 repository compatibility', () => {
  it('uses the exact-27 Tag relation instead of the Phase 7 snapshot column', async () => {
    const query = await captureQuestionListQuery('pre-phase7')

    expect(query).toMatchObject({
      where: {
        currentPublishedVersion: {
          is: {
            tags: {
              some: { tag: { normalizedName: 'grammar-choice' } }
            }
          }
        }
      }
    })
    expect(JSON.stringify(query)).not.toContain('normalizedNameSnapshot')
  })

  it('keeps snapshot filtering for the current technical schema', async () => {
    const query = await captureQuestionListQuery('current')

    expect(query).toMatchObject({
      where: {
        currentPublishedVersion: {
          is: {
            tags: {
              some: { normalizedNameSnapshot: 'grammar-choice' }
            }
          }
        }
      }
    })
  })

  it('does not reference retirementKind in exact-27 bookmark reads', async () => {
    const query = await captureBookmarkListQuery('pre-phase7')

    expect(query).toMatchObject({
      select: {
        question: {
          select: {
            versions: {
              where: {
                status: { in: ['PUBLISHED', 'RETIRED'] }
              }
            }
          }
        }
      }
    })
    expect(JSON.stringify(query)).not.toContain('retirementKind')
  })

  it('keeps publication provenance filtering for the current schema', async () => {
    const query = await captureBookmarkListQuery('current')

    expect(query).toMatchObject({
      select: {
        question: {
          select: {
            versions: {
              where: {
                OR: [
                  { status: 'PUBLISHED' },
                  {
                    retirementKind: 'PUBLISHED_RETIREMENT',
                    status: 'RETIRED'
                  }
                ],
                publishedAt: { not: null }
              }
            }
          }
        }
      }
    })
  })
})
