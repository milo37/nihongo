import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import { buildQuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import { toStableSeedUuid } from '../../prisma/seed-data/id.js'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import {
  buildAllQuestionSeeds,
  seedQuestionCatalog
} from '../../prisma/seedQuestionCatalog.js'

const EXPECTED_SUBJECT_COUNTS = {
  VOCABULARY: 5,
  GRAMMAR: 5,
  READING: 3
} as const

describe('question seed catalog', () => {
  it('65문제와 급수별 5·5·3 분포를 고정한다', () => {
    const aggregates = buildAllQuestionSeeds()

    expect(aggregates).toHaveLength(65)

    for (const level of ['N5', 'N4', 'N3', 'N2', 'N1'] as const) {
      for (const subject of ['VOCABULARY', 'GRAMMAR', 'READING'] as const) {
        expect(
          aggregates.filter(
            (question) =>
              question.level === level && question.subject === subject
          )
        ).toHaveLength(EXPECTED_SUBJECT_COUNTS[subject])
      }
    }
  })

  it('전역 ID와 문항 불변식을 만족한다', () => {
    const aggregates = buildAllQuestionSeeds()
    const questionIds = new Set<string>()
    const versionIds = new Set<string>()
    const optionIds = new Set<string>()

    for (const question of aggregates) {
      expect(questionIds.has(question.questionId)).toBe(false)
      expect(versionIds.has(question.versionId)).toBe(false)
      questionIds.add(question.questionId)
      versionIds.add(question.versionId)
      expect(question.options).toHaveLength(4)
      expect(question.tags.length).toBeGreaterThan(0)
      expect(
        question.options.some(({ id }) => id === question.correctOptionId)
      ).toBe(true)

      if (question.subject === 'READING') {
        expect(question.passage?.trim().length).toBeGreaterThan(0)
      }

      question.options.forEach((option, index) => {
        expect(option.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(option.label).toBe(String(index + 1))
        expect(optionIds.has(option.id)).toBe(false)
        optionIds.add(option.id)
      })
    }

    expect(optionIds.size).toBe(260)
  })

  it('내용 변경은 logical ID를 유지하고 version과 option ID를 바꾼다', () => {
    const source = originalQuestionSeeds[0]

    if (!source) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const first = buildQuestionAggregateSeed(source, toStableSeedUuid)
    const second = buildQuestionAggregateSeed(
      { ...source, questionText: source.questionText + ' 수정' },
      toStableSeedUuid
    )

    expect(second.questionId).toBe(first.questionId)
    expect(second.versionId).not.toBe(first.versionId)
    expect(second.options.map(({ id }) => id)).not.toEqual(
      first.options.map(({ id }) => id)
    )
  })

  it('뒤쪽 canonical drift를 모든 insert보다 먼저 거부한다', async () => {
    const seeds = buildAllQuestionSeeds()
    const lateSeed = seeds.at(-1)

    if (!lateSeed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const findUnique = vi.fn(
      async ({
        where,
        include
      }: {
        readonly where: { readonly id: string }
        readonly include?: unknown
      }) => {
        if (where.id !== lateSeed.questionId) {
          return null
        }

        return include === undefined
          ? { id: lateSeed.questionId }
          : { id: lateSeed.questionId, versions: [] }
      }
    )
    const writeTransaction = vi.fn()
    const client = {
      question: { findUnique },
      $transaction: writeTransaction
    } as unknown as PrismaClient

    await expect(seedQuestionCatalog(client)).rejects.toThrow(
      `Question seed is partially present: ${lateSeed.legacyId}`
    )
    expect(writeTransaction).not.toHaveBeenCalled()
  })

  it('insert 실패 시 missing catalog 전체를 rollback한다', async () => {
    const committedQuestionIds: string[] = []
    const writeTransaction = vi.fn(
      async (
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>
      ) => {
        const stagedQuestionIds: string[] = []
        let questionCreateCount = 0
        const transaction = {
          question: {
            create: vi.fn(async (input: unknown) => {
              questionCreateCount += 1

              if (questionCreateCount === 2) {
                throw new Error('simulated catalog insert failure')
              }

              const { data } = input as {
                readonly data: { readonly id: string }
              }
              stagedQuestionIds.push(data.id)
              return data
            }),
            update: vi.fn().mockResolvedValue({})
          },
          questionVersion: {
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({})
          },
          questionOption: {
            createMany: vi.fn().mockResolvedValue({ count: 4 })
          },
          tag: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({})
          },
          questionVersionTag: {
            createMany: vi.fn().mockResolvedValue({ count: 0 })
          }
        } as unknown as Prisma.TransactionClient

        await operation(transaction)
        committedQuestionIds.push(...stagedQuestionIds)
      }
    )
    const client = {
      question: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: writeTransaction
    } as unknown as PrismaClient

    await expect(seedQuestionCatalog(client)).rejects.toThrow(
      'simulated catalog insert failure'
    )
    expect(writeTransaction).toHaveBeenCalledOnce()
    expect(committedQuestionIds).toEqual([])
  })
})
