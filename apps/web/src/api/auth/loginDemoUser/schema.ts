import { userSchema } from '@api/schema'
import { z } from 'zod'

export const loginDemoUserRequestSchema = z.object({}).strict()
export const loginDemoUserResponseSchema = userSchema

export type LoginDemoUserRequest = z.infer<typeof loginDemoUserRequestSchema>
export type LoginDemoUserResponse = z.infer<typeof loginDemoUserResponseSchema>
