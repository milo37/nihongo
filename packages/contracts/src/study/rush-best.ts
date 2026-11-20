import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { jlptLevelSchema } from '../common/enum.js'

/**
 * #1043: the member's best score in a 30-second rush, one per mode and
 * level. Members only; guests keep no rush record, on the server or in the
 * browser. Only the best is stored, never each round.
 */
export const RUSH_BEST_PATH = '/api/v1/me/rush-best'

export const RUSH_MODES = ['KANJI_RUSH_30S'] as const
export const RUSH_SECONDS = 30
/** Two answers a second for 30 seconds: a light cap on impossible scores. */
export const RUSH_SCORE_MAX = 60

export const rushModeSchema = z.enum(RUSH_MODES)
export const rushScoreSchema = z.number().int().min(0).max(RUSH_SCORE_MAX)

export const rushBestEntrySchema = z
  .object({
    mode: rushModeSchema,
    level: jlptLevelSchema,
    best: rushScoreSchema,
    achievedAt: z.iso.datetime()
  })
  .strict()

/** GET: every mode and level the member has a record for; [] when none. */
export const rushBestResponseSchema = z
  .object({ bests: z.array(rushBestEntrySchema) })
  .strict()

/** PUT: one round's score; stored only when it beats the best. */
export const submitRushScoreBodySchema = z
  .object({
    mode: rushModeSchema,
    level: jlptLevelSchema,
    score: rushScoreSchema
  })
  .strict()

export const submitRushScoreResponseSchema = z
  .object({
    // The best after this round.
    best: rushBestEntrySchema,
    // true when this round raised the best (or was the first).
    isNewBest: z.boolean()
  })
  .strict()

export const rushBestErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  // fieldErrors.mode, fieldErrors.level or fieldErrors.score.
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const rushBestErrorSchema = createApiFailureSchema(
  rushBestErrorCodeSchema
)

export type RushMode = z.output<typeof rushModeSchema>
export type RushBestEntry = z.output<typeof rushBestEntrySchema>
export type RushBestResponse = z.output<typeof rushBestResponseSchema>
export type SubmitRushScoreBody = z.input<typeof submitRushScoreBodySchema>
export type SubmitRushScoreResponse = z.output<
  typeof submitRushScoreResponseSchema
>
export type RushBestError = z.output<typeof rushBestErrorSchema>
