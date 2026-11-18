import { z } from 'zod'
import type { StudyGoal } from '@nihongo/contracts/auth/study-goal'

// #1090: the result screen reads only these two values of the study goal,
// with its own module so it shares no chunk with the study goal page.
export const todayGoalResponseSchema = z.object({
  dailyGoal: z.number().int().nullable(),
  todayAnsweredCount: z.number().int().nonnegative()
}) satisfies z.ZodType<Pick<StudyGoal, 'dailyGoal' | 'todayAnsweredCount'>>
