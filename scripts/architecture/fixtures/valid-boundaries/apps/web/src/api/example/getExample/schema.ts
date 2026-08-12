import { z } from 'zod'
export const responseSchema = z.object({ value: z.string() })
export type Example = z.infer<typeof responseSchema>
