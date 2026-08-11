import { userSchema } from '@api/schema'
import { z } from 'zod'

export const loginDemoAdminRequestSchema = z.object({}).strict()
export const loginDemoAdminResponseSchema = userSchema

export type LoginDemoAdminRequest = z.infer<typeof loginDemoAdminRequestSchema>
export type LoginDemoAdminResponse = z.infer<
  typeof loginDemoAdminResponseSchema
>
