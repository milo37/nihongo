import type { GetDailyQuestionResponse } from '@nihongo/contracts/question/get-daily-question'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'
import { guestDayKey, nextGuestDayStart } from '../study/guestDay.js'
import { toPublicPracticeQuestion } from './questionMapper.js'
import {
  QuestionRepositoryUnavailableError,
  type PublishedQuestionDetailRecord
} from './questionRepository.js'

type Level = GetDailyQuestionResponse['level']

export interface DailyQuestionRecord extends PublishedQuestionDetailRecord {
  correctOptionId: string
  explanationKo: string
  explanationJa: string | null
}

export interface DailyQuestionRepository {
  /**
   * The `dayNumber % count`-th learner-visible vocabulary or grammar question
   * of the level, ordered by md5(question id); null when there is none.
   */
  findDaily: (
    level: Level,
    dayNumber: number
  ) => Promise<DailyQuestionRecord | null>
}

export interface DailyQuestionReader {
  getDailyQuestion: (
    level: Level,
    now: Date
  ) => Promise<{ response: GetDailyQuestionResponse; maxAgeSeconds: number }>
}

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_AGE_SECONDS = 3_600
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

/** Days since 1970-01-01 of the Korea-time date, e.g. `2026-11-10`. */
export const toDayNumber = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`) / DAY_MS

export const createPrismaDailyQuestionRepository = (
  client: PrismaClient
): DailyQuestionRepository => ({
  findDaily: async (level, dayNumber) => {
    try {
      // Learner-visible: ACTIVE with a PUBLISHED current version (JLP-816).
      const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
        WITH candidates AS (
          SELECT q."id",
                 row_number() OVER (ORDER BY md5(q."id"::text), q."id") - 1 AS position,
                 count(*) OVER () AS total
          FROM "Question" q
          JOIN "QuestionVersion" v ON v."id" = q."currentPublishedVersionId"
          WHERE q."lifecycleStatus" = 'ACTIVE'
            AND v."status" = 'PUBLISHED'
            AND v."level"::text = ${level}
            AND v."subject"::text IN ('VOCABULARY', 'GRAMMAR')
        )
        SELECT "id"::text AS "id" FROM candidates
        WHERE position = ${dayNumber}::bigint % total`)
      const id = rows[0]?.id
      if (!id) return null
      const question = await client.question.findFirst({
        where: {
          id,
          lifecycleStatus: 'ACTIVE',
          currentPublishedVersion: { is: { status: 'PUBLISHED' } }
        },
        select: {
          id: true,
          currentPublishedVersion: {
            select: {
              id: true,
              level: true,
              subject: true,
              questionType: true,
              passage: true,
              questionText: true,
              difficulty: true,
              correctOptionId: true,
              explanationKo: true,
              explanationJa: true,
              options: {
                orderBy: { ordinal: 'asc' },
                select: { id: true, label: true, text: true }
              },
              tags: {
                orderBy: { tag: { label: 'asc' } },
                select: {
                  tagId: true,
                  tag: { select: { label: true, labelJa: true } }
                }
              }
            }
          }
        }
      })
      const version = question?.currentPublishedVersion
      // Unpublished between the two reads: no question today until retry.
      if (!question || !version) return null
      return {
        id: question.id,
        questionVersionId: version.id,
        level: version.level,
        subject: version.subject,
        questionType: version.questionType,
        passage: version.passage,
        questionText: version.questionText,
        difficulty: version.difficulty,
        options: version.options,
        tags: version.tags.map(({ tag, tagId }) => ({
          id: tagId,
          label: tag.label,
          labelJa: tag.labelJa
        })),
        correctOptionId: version.correctOptionId,
        explanationKo: version.explanationKo,
        explanationJa: version.explanationJa
      }
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          UNAVAILABLE_PRISMA_CODES.has(error.code))
      ) {
        throw new QuestionRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

/** Today's question (JLP-815): chosen by the Korea-time date, never stored. */
export const createDailyQuestionService = (
  repository: DailyQuestionRepository
): DailyQuestionReader => ({
  getDailyQuestion: async (level, now) => {
    const date = guestDayKey(now)
    let record: DailyQuestionRecord | null
    try {
      record = await repository.findDaily(level, toDayNumber(date))
    } catch (error: unknown) {
      if (error instanceof QuestionRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '오늘의 문제 저장소에 연결할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    if (!record) {
      throw new ApplicationError({
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: '이 급수에는 오늘의 문제가 없습니다.',
        retryable: false
      })
    }
    const secondsToMidnight = Math.ceil(
      (nextGuestDayStart(now).getTime() - now.getTime()) / 1_000
    )
    return {
      response: {
        date,
        level,
        question: {
          ...toPublicPracticeQuestion(record),
          correctOptionId: record.correctOptionId,
          explanationKo: record.explanationKo,
          explanationJa: record.explanationJa
        }
      },
      maxAgeSeconds: Math.max(0, Math.min(MAX_AGE_SECONDS, secondsToMidnight))
    }
  }
})
