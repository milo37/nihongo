import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getFakeSchema/schema'

export const getFakeSchema = safeGet(responseSchema)
