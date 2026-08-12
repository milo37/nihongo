import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getUnchecked/schema'

const unusedValidatedRequest = safeGet(responseSchema)
void unusedValidatedRequest

export const getUnchecked = async () => ({ value: 'unchecked' })
