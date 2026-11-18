import { z } from 'zod'
import type { StudyGoal } from '@nihongo/contracts/auth/study-goal'

// #1090: kept here, not imported from the contract module (see
// getSignupConsent). The server checks the 10~150 rule on PUT.
export const studyGoalResponseSchema = z.object({
  targetLevel: z.enum(['N5', 'N4', 'N3', 'N2', 'N1']).nullable(),
  dailyGoal: z.number().int().nullable(),
  goalSetAt: z.string().nullable(),
  skippedAt: z.string().nullable(),
  onboardingRequired: z.boolean(),
  todayAnsweredCount: z.number().int().nonnegative(),
  // #1094: this Asia/Seoul month's stamp days, ascending YYYY-MM-DD.
  monthStampDates: z.array(z.iso.date()).max(31)
}) satisfies z.ZodType<StudyGoal>
