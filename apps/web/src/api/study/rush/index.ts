import { safeGet, safePut } from '@nihongo/browser/api/http'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import {
  RUSH_MODE,
  rushBestResponseSchema,
  rushPairsResponseSchema,
  submitRushScoreResponseSchema
} from '@api/study/rush/schema'
const readPairs = safeGet(rushPairsResponseSchema)
const readBest = safeGet(rushBestResponseSchema)
const writeBest = safePut(submitRushScoreResponseSchema)
// #1043: members only; the server keeps one best score per level.
export const getRushPairs = (level: JlptLevel) =>
  readPairs('/v1/rush/kanji-pairs', { level })
export const getRushBest = () => readBest('/v1/me/rush-best')
export const submitRushScore = (level: JlptLevel, score: number) =>
  writeBest('/v1/me/rush-best', { mode: RUSH_MODE, level, score })
