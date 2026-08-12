import { get as rawGet, safeGet } from '@api/http'
import { responseSchema } from '@api/example/getBroken/schema'

const unusedValidatedRequest = safeGet(responseSchema)
void unusedValidatedRequest
export const getBroken = async () => rawGet()
