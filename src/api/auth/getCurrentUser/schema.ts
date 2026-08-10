import { userSchema } from '@api/schema'
import { z } from 'zod'

export const getCurrentUserRequestSchema = z.object({}).strict()
export const getCurrentUserResponseSchema = userSchema.nullable()

export type GetCurrentUserRequest = z.infer<typeof getCurrentUserRequestSchema>
export type GetCurrentUserResponse = z.infer<
  typeof getCurrentUserResponseSchema
>
