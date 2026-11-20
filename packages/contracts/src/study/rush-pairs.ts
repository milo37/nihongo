import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { jlptLevelSchema } from '../common/enum.js'

/**
 * #1043: the word and reading pairs a 30-second kanji rush plays, made from
 * the published kanji reading questions. Members only. Each pair is one
 * question: the word in 「」 of its text, the right reading and the three
 * wrong ones. The web shuffles the four choices.
 */
export const RUSH_KANJI_PAIRS_PATH = '/api/v1/rush/kanji-pairs'

/** Below this many pairs the server adds pairs from the easier levels. */
export const RUSH_PAIRS_MIN = 20
/** At most one pair per possible answer in a round (the score cap). */
export const RUSH_PAIRS_MAX = 60

export const rushKanjiPairsQuerySchema = z
  .object({ level: jlptLevelSchema })
  .strict()

export const rushKanjiPairSchema = z
  .object({
    // The question id.
    id: z.uuid(),
    word: z.string().min(1),
    answer: z.string().min(1),
    wrong: z.array(z.string().min(1)).length(3)
  })
  .strict()

export const rushKanjiPairsResponseSchema = z
  .object({
    // Always the requested level, even when easier pairs were added.
    level: jlptLevelSchema,
    pairs: z.array(rushKanjiPairSchema).max(RUSH_PAIRS_MAX)
  })
  .strict()

export const rushKanjiPairsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  // fieldErrors.level.
  'INVALID_REQUEST',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const rushKanjiPairsErrorSchema = createApiFailureSchema(
  rushKanjiPairsErrorCodeSchema
)

export type RushKanjiPairsQuery = z.input<typeof rushKanjiPairsQuerySchema>
export type RushKanjiPair = z.output<typeof rushKanjiPairSchema>
export type RushKanjiPairsResponse = z.output<
  typeof rushKanjiPairsResponseSchema
>
export type RushKanjiPairsError = z.output<typeof rushKanjiPairsErrorSchema>
