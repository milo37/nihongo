import { z } from 'zod'

export const logoutUserRequestSchema = z.object({}).strict()
export const logoutUserResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

export type LogoutUserRequest = z.infer<typeof logoutUserRequestSchema>
export type LogoutUserResponse = z.infer<typeof logoutUserResponseSchema>
