import { z } from 'zod'
import { passwordResetRequestSchema } from '@common/schemas/auth'

export const requestPasswordResetRequestSchema = passwordResetRequestSchema
export const requestPasswordResetResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type RequestPasswordResetRequest = z.input<
  typeof requestPasswordResetRequestSchema
>
export type RequestPasswordResetResponse = z.output<
  typeof requestPasswordResetResponseSchema
>
