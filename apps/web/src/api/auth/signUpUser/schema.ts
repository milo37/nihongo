import { z } from 'zod'
import { emailSignUpSchema } from '@common/schemas/auth'

export const signUpUserRequestSchema = emailSignUpSchema

export const signUpUserResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type SignUpUserRequest = z.input<typeof signUpUserRequestSchema>
export type SignUpUserResponse = z.output<typeof signUpUserResponseSchema>
