import { z } from 'zod'

export const responseSchema = z.object({ replayed: z.boolean() })
