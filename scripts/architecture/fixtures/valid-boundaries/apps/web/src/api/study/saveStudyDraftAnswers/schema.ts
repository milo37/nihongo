import { z } from 'zod'

export const responseSchema = z.object({ revision: z.number() })
