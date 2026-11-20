import { z } from 'zod'
import { jlptLevelSchema } from '@nihongo/contracts/common/enum'

// #1043: the rush's server shapes (be-design.md §2). The pair list and the
// best scores are members only; swap for the contracts once the API lands.
export const RUSH_MODE = 'KANJI_RUSH_30S'

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

const rushBestEntrySchema = z.object({
  mode: z.string(),
  level: jlptLevelSchema,
  best: z.number().int().nonnegative(),
  achievedAt: z.string()
})

export const rushBestResponseSchema = z.object({
  bests: z.array(rushBestEntrySchema)
})

export const submitRushScoreResponseSchema = z.object({
  best: rushBestEntrySchema,
  isNewBest: z.boolean()
})

export type RushPair = z.output<typeof rushPairsResponseSchema>['pairs'][number]
export type RushBests = z.output<typeof rushBestResponseSchema>
