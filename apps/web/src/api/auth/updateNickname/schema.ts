import { z } from 'zod'
import type { UpdateNicknameResponse } from '@nihongo/contracts/auth/update-nickname'

// Kept here, not imported from the contract module (see getSignupConsent).
export const updateNicknameResponseSchema = z.object({
  nickname: z.string()
}) satisfies z.ZodType<UpdateNicknameResponse>
