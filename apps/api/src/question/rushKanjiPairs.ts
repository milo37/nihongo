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
 * #1043: the rush words the operator loaded from content/rush into
 * "RushKanjiWord" (dictionary forms, no conjugation tail).
 */
export const createPrismaRushKanjiPairsRepository = (
  client: Pick<PrismaClient, '$queryRaw'>
): RushKanjiPairsRepository => ({
  listPairs: async (levels) => {
    try {
      return await client.$queryRaw<RushKanjiPairRecord[]>(Prisma.sql`
        SELECT word."id"::text AS "id", word."level"::text AS "level",
          word."word", word."reading" AS "answer", word."wrong"
        FROM "RushKanjiWord" AS word
        WHERE word."level"::text IN (${Prisma.join([...levels])})
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
