import { z } from 'zod'
import type { PushConfigResponse } from '@nihongo/contracts/notification/web-push'

// #1046: kept here, not imported from the contract module (see studyGoal).
export const pushConfigResponseSchema = z
  .object({
    // null while the server has push off: the page hides the switch.
    publicKey: z.string().nullable()
  })
  .strict() satisfies z.ZodType<PushConfigResponse>

// PUT and DELETE answer 204 with no body. The http helper turns a DELETE 204
// into undefined, but a PUT 204 arrives as the empty string.
export const pushNoContentSchema = z
  .union([z.undefined(), z.literal('')])
  .transform(() => undefined)
