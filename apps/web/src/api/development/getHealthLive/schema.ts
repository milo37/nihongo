import { z } from 'zod'

export const healthLiveSchema = z.strictObject({ status: z.literal('ok') })
export type HealthLive = z.infer<typeof healthLiveSchema>
