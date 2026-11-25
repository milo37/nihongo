import { z } from 'zod'
import type { PushConfigResponse } from '@nihongo/contracts/notification/web-push'

// #1046: kept here, not imported from the contract module (see studyGoal).
export const pushConfigResponseSchema = z
  .object({
    // null while the server has push off: the page hides the switch.
    publicKey: z.string().nullable()
  })
  .strict() satisfies z.ZodType<PushConfigResponse>

// PUT and DELETE answer 204 with no body.
export const pushNoContentSchema = z.undefined()
