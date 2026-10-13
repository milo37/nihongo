import { z } from 'zod'
import { passwordResetConfirmSchema } from '@common/schemas/auth'

export const resetPasswordRequestSchema = passwordResetConfirmSchema
export const resetPasswordResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>
export type ResetPasswordResponse = z.output<typeof resetPasswordResponseSchema>
