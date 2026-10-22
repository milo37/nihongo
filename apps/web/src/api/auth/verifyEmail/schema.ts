import { z } from 'zod'

export const verifyEmailRequestSchema = z
  .object({
    token: z.string().min(1).max(4_096)
  })
  .strict()

export const verifyEmailResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type VerifyEmailRequest = z.input<typeof verifyEmailRequestSchema>
export type VerifyEmailResponse = z.output<typeof verifyEmailResponseSchema>
