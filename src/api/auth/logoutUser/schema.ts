import { successResponseSchema } from '@api/schema'
import { z } from 'zod'

export const logoutUserRequestSchema = z.object({}).strict()
export const logoutUserResponseSchema = successResponseSchema

export type LogoutUserRequest = z.infer<typeof logoutUserRequestSchema>
export type LogoutUserResponse = z.infer<typeof logoutUserResponseSchema>
