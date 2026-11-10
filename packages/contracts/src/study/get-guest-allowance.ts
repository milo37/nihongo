import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from './guest-limits.js'

export const getGuestAllowanceOperationId = 'study.getGuestAllowance' as const

/** The read takes no query; any query part is refused. */
export const getGuestAllowanceQuerySchema = z.object({}).strict()

/**
 * What a guest may still start today (#737; planning S2, S3). Only fixed
 * values: the browser turns `resetsAt` (the next midnight Korea time) into
 * its own wording, so the response does not change from one read to the
 * next unless the guest starts a session.
 */
const guestAllowanceSchema = z
  .object({
    kind: z.literal('GUEST'),
    sessionQuestionCount: z.number().int().min(1),
    dailyLimit: z.number().int().min(1),
    remaining: z.number().int().min(0),
    resetsAt: isoDateTimeSchema
  })
  .strict()

export const getGuestAllowanceResponseSchema = z
  .discriminatedUnion('kind', [
    guestAllowanceSchema,
    z.object({ kind: z.literal('USER') }).strict()
  ])
  .refine(
    (allowance) =>
      allowance.kind === 'USER' || allowance.remaining <= allowance.dailyLimit,
    { path: ['remaining'], message: 'remaining은 dailyLimit 이하여야 합니다.' }
  )

export type GetGuestAllowanceResponse = z.output<
  typeof getGuestAllowanceResponseSchema
>

const exampleResetsAt = '2026-11-08T15:00:00.000Z'

/** Shared example responses for browser mocks and server tests. */
export const guestAllowanceExamples = {
  full: {
    kind: 'GUEST',
    sessionQuestionCount: GUEST_SESSION_QUESTION_LIMIT,
    dailyLimit: GUEST_DAILY_SESSION_LIMIT,
    remaining: GUEST_DAILY_SESSION_LIMIT,
    resetsAt: exampleResetsAt
  },
  one: {
    kind: 'GUEST',
    sessionQuestionCount: GUEST_SESSION_QUESTION_LIMIT,
    dailyLimit: GUEST_DAILY_SESSION_LIMIT,
    remaining: 1,
    resetsAt: exampleResetsAt
  },
  none: {
    kind: 'GUEST',
    sessionQuestionCount: GUEST_SESSION_QUESTION_LIMIT,
    dailyLimit: GUEST_DAILY_SESSION_LIMIT,
    remaining: 0,
    resetsAt: exampleResetsAt
  },
  member: { kind: 'USER' }
} as const satisfies Record<string, GetGuestAllowanceResponse>
