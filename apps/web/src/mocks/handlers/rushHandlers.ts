import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import { jlptLevelSchema } from '@nihongo/contracts/common/enum'
import { rushPairsByLevel } from '@mocks/data/rushPairs'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  MockHttpError,
  parseJsonBody,
  toErrorResponse
} from '@mocks/handlers/shared'

// #1043: the rush pair list and best scores (be-design.md), members only.
const bests = new Map<string, { best: number; achievedAt: string }>()
const submitSchema = z
  .object({
    mode: z.literal('KANJI_RUSH_30S'),
    level: jlptLevelSchema,
    score: z.number().int().min(0).max(60)
  })
  .strict()
const noStore = { headers: { 'Cache-Control': 'private, no-store' } }

const requireMemberId = (): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user)
    throw new MockHttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      '로그인이 필요해요.'
    )
  return user.id
}

const entriesOf = (userId: string) =>
  [...bests]
    .filter(([key]) => key.startsWith(`${userId}|`))
    .map(([key, row]) => ({
      mode: 'KANJI_RUSH_30S',
      level: jlptLevelSchema.parse(key.split('|')[1]),
      ...row
    }))

/** For tests: forget every best score. */
export const resetRushBests = (): void => bests.clear()

export const rushHandlers = [
  http.get('*/api/v1/rush/kanji-pairs', ({ request }) => {
    try {
      requireMemberId()
      const level = jlptLevelSchema.parse(
        new URL(request.url).searchParams.get('level')
      )
      const pairs = (rushPairsByLevel[level] ?? []).map(
        ([word, answer, ...wrong], index) => ({
          id: `${level}-rush-${index}`,
          word: word!,
          answer: answer!,
          wrong
        })
      )
      return HttpResponse.json({ level, pairs }, noStore)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.get('*/api/v1/me/rush-best', () => {
    try {
      return HttpResponse.json({ bests: entriesOf(requireMemberId()) }, noStore)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.put('*/api/v1/me/rush-best', async ({ request }) => {
    try {
      const userId = requireMemberId()
      const input = await parseJsonBody(request, submitSchema)
      const key = `${userId}|${input.level}`
      const old = bests.get(key)
      const isNewBest = !old || input.score > old.best
      if (isNewBest)
        bests.set(key, {
          best: input.score,
          achievedAt: new Date().toISOString()
        })
      const best = entriesOf(userId).find((row) => row.level === input.level)!
      return HttpResponse.json({ best, isNewBest }, noStore)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]
