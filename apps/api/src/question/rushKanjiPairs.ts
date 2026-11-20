import {
  RUSH_PAIRS_MAX,
  RUSH_PAIRS_MIN,
  type RushKanjiPair,
  type RushKanjiPairsResponse
} from '@nihongo/contracts/study/rush-pairs'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

type Level = RushKanjiPairsResponse['level']

export interface RushKanjiPairRecord extends RushKanjiPair {
  level: Level
}

export interface RushKanjiPairsRepository {
  /** Every playable pair of these levels, in random order. */
  listPairs: (levels: readonly Level[]) => Promise<RushKanjiPairRecord[]>
}

export interface RushKanjiPairsReader {
  read: (level: Level) => Promise<RushKanjiPairsResponse>
}

export class RushKanjiPairsRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Rush kanji pairs repository is unavailable.', options)
    this.name = 'RushKanjiPairsRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

/** Easiest first; a level's easier levels come before it. */
const LEVELS: readonly Level[] = ['N5', 'N4', 'N3', 'N2', 'N1']

/**
 * Learner-visible (ACTIVE with a PUBLISHED current version, JLP-816) kanji
 * reading questions with one word in 「」 and exactly four options.
 */
export const createPrismaRushKanjiPairsRepository = (
  client: PrismaClient
): RushKanjiPairsRepository => ({
  listPairs: async (levels) => {
    try {
      return await client.$queryRaw<RushKanjiPairRecord[]>(Prisma.sql`
        SELECT pair."id", pair."level", pair."word", pair."answer",
          pair."wrong"
        FROM (
          SELECT q."id"::text AS "id", v."level"::text AS "level",
            btrim(substring(v."questionText" FROM '「([^」]+)」')) AS "word",
            correct."text" AS "answer",
            ARRAY(
              SELECT wrong."text" FROM "QuestionOption" AS wrong
              WHERE wrong."questionVersionId" = v."id"
                AND wrong."id" <> v."correctOptionId"
              ORDER BY wrong."ordinal"
            ) AS "wrong"
          FROM "Question" AS q
          JOIN "QuestionVersion" AS v ON v."id" = q."currentPublishedVersionId"
          JOIN "QuestionOption" AS correct
            ON correct."questionVersionId" = v."id"
            AND correct."id" = v."correctOptionId"
          WHERE q."lifecycleStatus" = 'ACTIVE'
            AND v."status" = 'PUBLISHED'
            AND v."questionType" = 'KANJI_READING'
            AND v."level"::text IN (${Prisma.join([...levels])})
        ) AS pair
        WHERE pair."word" <> '' AND cardinality(pair."wrong") = 3
        ORDER BY random()
      `)
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new RushKanjiPairsRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

const shuffle = <T>(items: T[]): T[] => {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[items[index], items[other]] = [items[other] as T, items[index] as T]
  }
  return items
}

/**
 * Up to RUSH_PAIRS_MAX pairs of the level. With fewer than RUSH_PAIRS_MIN,
 * pairs of the nearest easier levels fill up to RUSH_PAIRS_MIN.
 */
export const createRushKanjiPairsReader = (
  repository: RushKanjiPairsRepository
): RushKanjiPairsReader => ({
  read: async (level) => {
    const easier = LEVELS.slice(0, LEVELS.indexOf(level)).reverse()
    let records: RushKanjiPairRecord[]
    try {
      records = await repository.listPairs([level, ...easier])
    } catch (error: unknown) {
      if (error instanceof RushKanjiPairsRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '러시 문제를 불러올 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    const own = records
      .filter((record) => record.level === level)
      .slice(0, RUSH_PAIRS_MAX)
    const fill = easier
      .flatMap((easierLevel) =>
        records.filter((record) => record.level === easierLevel)
      )
      .slice(0, Math.max(0, RUSH_PAIRS_MIN - own.length))
    return {
      level,
      pairs: shuffle([...own, ...fill]).map(({ id, word, answer, wrong }) => ({
        id,
        word,
        answer,
        wrong
      }))
    }
  }
})
