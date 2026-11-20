import { z } from 'zod'
import { jlptLevelSchema } from '@nihongo/contracts/common/enum'
import type {
  RushBestResponse,
  SubmitRushScoreResponse
} from '@nihongo/contracts/study/rush-best'

// #1043: the rush's server shapes. The best score ones are checked against
// the contract (BE #1158) by type only: importing its module would split a
// shared chunk off, and the bundle has no file to spare.
export const RUSH_SCORE_MAX = 60

const rushBestEntrySchema = z.object({
  mode: z.literal('KANJI_RUSH_30S'),
  level: jlptLevelSchema,
  best: z.number().int().min(0).max(RUSH_SCORE_MAX),
  achievedAt: z.string()
})

export const rushBestResponseSchema = z.object({
  bests: z.array(rushBestEntrySchema)
}) satisfies z.ZodType<RushBestResponse>

export const submitRushScoreResponseSchema = z.object({
  best: rushBestEntrySchema,
  isNewBest: z.boolean()
}) satisfies z.ZodType<SubmitRushScoreResponse>

// The pair list (BE #1159); swap for its contract once merged.
export const rushPairsResponseSchema = z.object({
  level: jlptLevelSchema,
  pairs: z.array(
    z.object({
      id: z.string(),
      word: z.string(),
      answer: z.string(),
      wrong: z.array(z.string()).length(3)
    })
  )
})

export type RushPair = z.output<typeof rushPairsResponseSchema>['pairs'][number]
export type RushBests = z.output<typeof rushBestResponseSchema>
