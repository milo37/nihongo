import { z } from 'zod'
import { emailSignInSchema } from '@common/schemas/auth'

export const signInUserRequestSchema = emailSignInSchema

export const signInUserResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type SignInUserRequest = z.input<typeof signInUserRequestSchema>
export type SignInUserResponse = z.output<typeof signInUserResponseSchema>
